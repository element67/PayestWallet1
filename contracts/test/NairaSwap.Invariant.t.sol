// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapRouter} from "../NairaSwapRouter.sol";
import {NairaSwapFactory} from "../NairaSwapFactory.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";

/// @dev Drives the router with bounded random actions across two pools (A/B and B/C) and tracks ghost state.
contract NairaSwapHandler is Test {
    NairaSwapRouter public router;
    NairaSwapFactory public factory;
    address public tokenA;
    address public tokenB;
    address public tokenC;
    address[] public actors;

    bool public kDecreasedOnSwap;
    uint256 public swapCount;
    uint256 public addCount;
    uint256 public removeCount;

    constructor(NairaSwapRouter r, address a, address b, address c, address[] memory actors_) {
        router = r;
        factory = NairaSwapFactory(r.factory());
        tokenA = a;
        tokenB = b;
        tokenC = c;
        actors = actors_;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _k(address x, address y) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = INairaSwapPair(factory.getPair(x, y)).getReserves();
        return uint256(r0) * r1;
    }

    function _path(uint256 mode) internal view returns (address[] memory p) {
        if (mode % 4 == 0) {
            p = new address[](2);
            (p[0], p[1]) = (tokenA, tokenB);
        } else if (mode % 4 == 1) {
            p = new address[](2);
            (p[0], p[1]) = (tokenB, tokenA);
        } else if (mode % 4 == 2) {
            p = new address[](3);
            (p[0], p[1], p[2]) = (tokenA, tokenB, tokenC);
        } else {
            p = new address[](3);
            (p[0], p[1], p[2]) = (tokenC, tokenB, tokenA);
        }
    }

    function swapExactIn(uint256 actorSeed, uint256 mode, uint256 amountIn) external {
        address who = _actor(actorSeed);
        address[] memory path = _path(mode);
        amountIn = bound(amountIn, 1e3, 1e22);
        uint256 kAB = _k(tokenA, tokenB);
        uint256 kBC = _k(tokenB, tokenC);
        vm.prank(who);
        try router.swapExactTokensForTokens(amountIn, 0, path, who, block.timestamp + 1) {
            swapCount++;
            if (_k(tokenA, tokenB) < kAB || _k(tokenB, tokenC) < kBC) kDecreasedOnSwap = true;
        } catch {}
    }

    function swapExactOut(uint256 actorSeed, uint256 mode, uint256 amountOut) external {
        address who = _actor(actorSeed);
        address[] memory path = _path(mode);
        amountOut = bound(amountOut, 1e3, 1e21);
        uint256 kAB = _k(tokenA, tokenB);
        uint256 kBC = _k(tokenB, tokenC);
        vm.prank(who);
        try router.swapTokensForExactTokens(amountOut, type(uint256).max, path, who, block.timestamp + 1) {
            swapCount++;
            if (_k(tokenA, tokenB) < kAB || _k(tokenB, tokenC) < kBC) kDecreasedOnSwap = true;
        } catch {}
    }

    function addLiq(uint256 actorSeed, uint256 pool, uint256 amtA, uint256 amtB) external {
        address who = _actor(actorSeed);
        (address x, address y) = pool % 2 == 0 ? (tokenA, tokenB) : (tokenB, tokenC);
        amtA = bound(amtA, 1e6, 1e22);
        amtB = bound(amtB, 1e6, 1e22);
        vm.prank(who);
        try router.addLiquidity(x, y, amtA, amtB, 0, 0, who, block.timestamp + 1) {
            addCount++;
        } catch {}
    }

    function removeLiq(uint256 actorSeed, uint256 pool, uint256 fraction) external {
        address who = _actor(actorSeed);
        (address x, address y) = pool % 2 == 0 ? (tokenA, tokenB) : (tokenB, tokenC);
        INairaSwapPair p = INairaSwapPair(factory.getPair(x, y));
        uint256 bal = p.balanceOf(who);
        if (bal == 0) return;
        uint256 liq = bound(fraction, 1, bal);
        vm.startPrank(who);
        p.approve(address(router), liq);
        try router.removeLiquidity(x, y, liq, 0, 0, who, block.timestamp + 1) {
            removeCount++;
        } catch {}
        vm.stopPrank();
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 1 days));
    }
}

contract NairaSwapInvariantTest is NairaSwapTestBase {
    NairaSwapHandler internal handler;
    INairaSwapPair internal pAB;
    INairaSwapPair internal pBC;
    address[] internal actorList;

    function setUp() public override {
        super.setUp();
        _add(alice, address(tokenA), address(tokenB), 1_000_000 * ONE, 1_000_000 * ONE);
        _add(alice, address(tokenB), address(tokenC), 1_000_000 * ONE, 1_000_000 * ONE);
        pAB = _pairOf(address(tokenA), address(tokenB));
        pBC = _pairOf(address(tokenB), address(tokenC));
        actorList.push(alice);
        actorList.push(bob);
        actorList.push(carol);
        handler = new NairaSwapHandler(router, address(tokenA), address(tokenB), address(tokenC), actorList);
        // actors are pre-funded and have approved the router in the base fixture
        targetContract(address(handler));
    }

    function _checkBalancesMatchReserves(INairaSwapPair p) internal view {
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(IERC20(p.token0()).balanceOf(address(p)), r0, "reserve0 == balance0");
        assertEq(IERC20(p.token1()).balanceOf(address(p)), r1, "reserve1 == balance1");
    }

    function _checkSupply(INairaSwapPair p) internal view {
        uint256 sum = p.balanceOf(address(0xdead)) + p.balanceOf(address(treasury)) + p.balanceOf(address(router))
            + p.balanceOf(address(p));
        for (uint256 i; i < actorList.length; i++) {
            sum += p.balanceOf(actorList[i]);
        }
        assertEq(p.totalSupply(), sum, "totalSupply == sum of tracked balances");
        assertEq(p.balanceOf(address(0xdead)), 1000, "MINIMUM_LIQUIDITY permanently locked");
    }

    /// PROPERTY: with no donations, reserves always equal actual pair balances after any router operation.
    function invariant_ReservesMatchBalances() public view {
        _checkBalancesMatchReserves(pAB);
        _checkBalancesMatchReserves(pBC);
    }

    /// PROPERTY: LP supply is fully accounted for by holders (actors, treasury fee recipient, locked dust).
    function invariant_LpSupplyConsistent() public view {
        _checkSupply(pAB);
        _checkSupply(pBC);
    }

    /// PROPERTY: no swap (single or multi-hop) ever reduced k of any pool it touched.
    function invariant_KNeverDecreasesOnSwap() public view {
        assertFalse(handler.kDecreasedOnSwap());
    }

    /// PROPERTY: the router never keeps tokens or LP between transactions.
    function invariant_RouterHoldsNothing() public view {
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(tokenC.balanceOf(address(router)), 0);
        assertEq(pAB.balanceOf(address(router)), 0);
        assertEq(pBC.balanceOf(address(router)), 0);
    }

    /// PROPERTY: pools stay solvent: reserves non-zero while LP supply exists.
    function invariant_ReservesNonZero() public view {
        (uint112 a0, uint112 a1,) = pAB.getReserves();
        (uint112 b0, uint112 b1,) = pBC.getReserves();
        assertGt(a0, 0);
        assertGt(a1, 0);
        assertGt(b0, 0);
        assertGt(b1, 0);
    }
}
