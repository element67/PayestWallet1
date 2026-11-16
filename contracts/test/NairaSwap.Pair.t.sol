// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapPair} from "../NairaSwapPair.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";
import {MockERC20, HookERC20, MockFactory} from "../test-helpers/NairaSwapMocks.sol";

contract NairaSwapPairTest is NairaSwapTestBase {
    INairaSwapPair internal p;
    address internal t0;
    address internal t1;

    function setUp() public override {
        super.setUp();
        p = INairaSwapPair(factory.createPair(address(tokenA), address(tokenB)));
        t0 = p.token0();
        t1 = p.token1();
    }

    function _fund(INairaSwapPair pp, uint256 a0, uint256 a1) internal {
        vm.startPrank(alice);
        if (a0 != 0) IERC20(pp.token0()).transfer(address(pp), a0);
        if (a1 != 0) IERC20(pp.token1()).transfer(address(pp), a1);
        vm.stopPrank();
    }

    function _seed(uint256 a0, uint256 a1) internal returns (uint256 liq) {
        _fund(p, a0, a1);
        vm.prank(alice);
        liq = p.mint(alice);
    }

    function _out(uint256 amountIn, bool zeroForOne) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = p.getReserves();
        return zeroForOne ? router.getAmountOut(amountIn, r0, r1) : router.getAmountOut(amountIn, r1, r0);
    }

    // ------------------------------------------------------------- initialize

    function test_Initialize_OnlyFactory() public {
        vm.prank(alice);
        vm.expectRevert(NairaSwapPair.Forbidden.selector);
        p.initialize(address(1), address(2));
    }

    function test_Initialize_OnlyOnce() public {
        vm.prank(address(factory));
        vm.expectRevert(NairaSwapPair.AlreadyInitialized.selector);
        p.initialize(address(1), address(2));
    }

    function test_Initialize_ValidatesTokensAndEmits() public {
        NairaSwapPair raw = new NairaSwapPair(); // this test contract is its factory
        assertEq(raw.factory(), address(this));
        vm.expectRevert(NairaSwapPair.InvalidTokens.selector);
        raw.initialize(address(0), address(2));
        vm.expectRevert(NairaSwapPair.InvalidTokens.selector);
        raw.initialize(address(3), address(2));
        vm.expectRevert(NairaSwapPair.InvalidTokens.selector);
        raw.initialize(address(2), address(2));
        vm.expectEmit(true, true, false, false, address(raw));
        emit INairaSwapPair.Initialized(address(2), address(3));
        raw.initialize(address(2), address(3));
        assertEq(raw.token0(), address(2));
        assertEq(raw.token1(), address(3));
    }

    function test_LpTokenMetadata() public view {
        assertEq(p.name(), "NairaSwap LP");
        assertEq(p.symbol(), "NSWAP-LP");
        assertEq(p.MINIMUM_LIQUIDITY(), 1000);
    }

    // ------------------------------------------------------------------- mint

    function test_Mint_First_LocksMinimumLiquidity() public {
        _fund(p, 4000 * ONE, 1000 * ONE);
        vm.expectEmit(true, false, false, true, address(p));
        emit INairaSwapPair.Mint(alice, 4000 * ONE, 1000 * ONE);
        vm.prank(alice);
        uint256 liq = p.mint(bob);
        assertEq(liq, 2000 * ONE - 1000);
        assertEq(p.balanceOf(bob), liq);
        assertEq(p.balanceOf(address(0xdead)), 1000, "MINIMUM_LIQUIDITY locked");
        assertEq(p.totalSupply(), 2000 * ONE);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(r0, 4000 * ONE);
        assertEq(r1, 1000 * ONE);
    }

    function test_Mint_EmitsSync() public {
        _fund(p, 100 * ONE, 100 * ONE);
        vm.expectEmit(false, false, false, true, address(p));
        emit INairaSwapPair.Sync(uint112(100 * ONE), uint112(100 * ONE));
        p.mint(alice);
    }

    function test_RevertMint_FirstBelowMinimum() public {
        _fund(p, 1000, 1000); // sqrt == 1000, not > MINIMUM_LIQUIDITY
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientLiquidity.selector, 1000, 1000));
        p.mint(alice);
    }

    function test_Mint_Subsequent_ProportionalAndMinOfBothSides() public {
        _seed(1000 * ONE, 1000 * ONE);
        uint256 supply = p.totalSupply();
        // balanced deposit
        _fund(p, 100 * ONE, 100 * ONE);
        vm.prank(alice);
        assertEq(p.mint(bob), supply * 100 * ONE / (1000 * ONE));
        // imbalanced deposit: credited at the lesser side, excess is donated to LPs
        supply = p.totalSupply();
        _fund(p, 100 * ONE, 10 * ONE);
        vm.prank(alice);
        uint256 liq = p.mint(carol);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(liq, supply * 10 * ONE / (uint256(r1) - 10 * ONE));
        assertGt(r0, 1000 * ONE);
    }

    function test_RevertMint_NoNewDeposit() public {
        _seed(1000 * ONE, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientLiquidity.selector, 0, 1));
        p.mint(alice);
    }

    function test_RevertMint_InvalidTo() public {
        _fund(p, 100 * ONE, 100 * ONE);
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.mint(address(0));
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.mint(address(p));
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.mint(t0);
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.mint(t1);
    }

    // ------------------------------------------------------------------- burn

    function test_Burn_ReturnsProRataAndEmits() public {
        uint256 liq = _seed(1000 * ONE, 4000 * ONE);
        uint256 supply = p.totalSupply();
        vm.prank(alice);
        p.transfer(address(p), liq / 2);
        uint256 e0 = (liq / 2) * (1000 * ONE) / supply;
        uint256 e1 = (liq / 2) * (4000 * ONE) / supply;
        vm.expectEmit(true, true, false, true, address(p));
        emit INairaSwapPair.Burn(bob, e0, e1, carol);
        vm.prank(bob);
        (uint256 a0, uint256 a1) = p.burn(carol);
        assertEq(a0, e0);
        assertEq(a1, e1);
        assertEq(IERC20(t0).balanceOf(carol), FUND + e0);
        assertEq(IERC20(t1).balanceOf(carol), FUND + e1);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(r0, 1000 * ONE - e0);
        assertEq(r1, 4000 * ONE - e1);
    }

    function test_RevertBurn_NothingToBurn() public {
        _seed(1000 * ONE, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientLiquidity.selector, 0, 1));
        p.burn(alice);
    }

    function test_RevertBurn_InvalidTo() public {
        _seed(1000 * ONE, 1000 * ONE);
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.burn(address(0));
    }

    function test_MinimumLiquidityCannotBeWithdrawn() public {
        uint256 liq = _seed(1000 * ONE, 1000 * ONE);
        vm.prank(alice);
        p.transfer(address(p), liq);
        p.burn(alice);
        assertEq(p.totalSupply(), 1000);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertGt(r0, 0);
        assertGt(r1, 0);
    }

    // ------------------------------------------------------------------- swap

    function test_Swap_ExactFee_OutputAtBoundaryAcceptedAndOneMoreRejected() public {
        _seed(1000 * ONE, 1000 * ONE);
        uint256 amountIn = 10 * ONE;
        uint256 out = _out(amountIn, true);
        // 0.30%: out = in*997*R1 / (R0*1000 + in*997)
        assertEq(out, amountIn * 997 * 1000 * ONE / (1000 * ONE * 1000 + amountIn * 997));
        _fund(p, amountIn, 0);
        uint256 snap = vm.snapshotState();
        p.swap(0, out, bob, "");
        assertEq(IERC20(t1).balanceOf(bob), FUND + out);
        vm.revertToState(snap);
        vm.expectRevert(NairaSwapPair.InvariantViolation.selector);
        p.swap(0, out + 1, bob, "");
    }

    function test_Swap_FeeIsThirtyBps_NotLess() public {
        _seed(1000 * ONE, 1000 * ONE);
        // output that would be valid with a 0.25% fee must be rejected under 0.30%
        uint256 amountIn = 100 * ONE;
        uint256 outFee25 = amountIn * 9975 * 1000 * ONE / (1000 * ONE * 10_000 + amountIn * 9975);
        uint256 outFee30 = _out(amountIn, true);
        assertGt(outFee25, outFee30);
        _fund(p, amountIn, 0);
        vm.expectRevert(NairaSwapPair.InvariantViolation.selector);
        p.swap(0, outFee25, bob, "");
    }

    function test_Swap_EmitsSwapAndSync() public {
        _seed(1000 * ONE, 1000 * ONE);
        uint256 out = _out(10 * ONE, true);
        _fund(p, 10 * ONE, 0);
        // pair emits Sync (inside _update) before Swap
        vm.expectEmit(false, false, false, true, address(p));
        emit INairaSwapPair.Sync(uint112(1010 * ONE), uint112(1000 * ONE - out));
        vm.expectEmit(true, true, false, true, address(p));
        emit INairaSwapPair.Swap(alice, 10 * ONE, 0, 0, out, bob);
        vm.prank(alice);
        p.swap(0, out, bob, "");
    }

    function test_RevertSwap_NoOutput() public {
        _seed(1000 * ONE, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientOutputAmount.selector, 0, 0));
        p.swap(0, 0, bob, "");
    }

    function test_RevertSwap_NoInput() public {
        _seed(1000 * ONE, 1000 * ONE);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientInputAmount.selector, 0, 0));
        p.swap(0, 1, bob, "");
    }

    function test_RevertSwap_OutputExceedsReserves() public {
        _seed(1000 * ONE, 1000 * ONE);
        _fund(p, 1000 * ONE, 0);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.InsufficientLiquidity.selector, 1000 * ONE, 1000 * ONE));
        p.swap(0, 1000 * ONE, bob, "");
    }

    function test_RevertSwap_NonEmptyData() public {
        _seed(1000 * ONE, 1000 * ONE);
        _fund(p, 10 * ONE, 0);
        vm.expectRevert(NairaSwapPair.NonEmptyData.selector);
        p.swap(0, 1 * ONE, bob, hex"01");
    }

    function test_RevertSwap_InvalidTo() public {
        _seed(1000 * ONE, 1000 * ONE);
        _fund(p, 10 * ONE, 0);
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.swap(0, 1 * ONE, t0, "");
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.swap(0, 1 * ONE, t1, "");
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.swap(0, 1 * ONE, address(p), "");
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.swap(0, 1 * ONE, address(0), "");
    }

    function test_Swap_KNeverDecreasesAfterSwap() public {
        _seed(1000 * ONE, 1000 * ONE);
        (uint112 a0, uint112 a1,) = p.getReserves();
        uint256 kBefore = uint256(a0) * a1;
        _fund(p, 25 * ONE, 0);
        p.swap(0, _out(25 * ONE, true), bob, "");
        (uint112 b0, uint112 b1,) = p.getReserves();
        assertGt(uint256(b0) * b1, kBefore, "k grows by the fee");
    }

    // ------------------------------------------------------- skim / sync / overflow

    function test_Skim_SendsOnlyExcessAndEmits() public {
        _seed(1000 * ONE, 1000 * ONE);
        _fund(p, 7 * ONE, 3 * ONE);
        vm.expectEmit(true, false, false, true, address(p));
        emit INairaSwapPair.Skim(carol, 7 * ONE, 3 * ONE);
        p.skim(carol);
        assertEq(IERC20(t0).balanceOf(carol), FUND + 7 * ONE);
        assertEq(IERC20(t1).balanceOf(carol), FUND + 3 * ONE);
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(IERC20(t0).balanceOf(address(p)), r0);
        assertEq(IERC20(t1).balanceOf(address(p)), r1);
    }

    function test_RevertSkim_InvalidTo() public {
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        p.skim(address(0));
    }

    function test_Sync_AlignsReservesToBalances() public {
        _seed(1000 * ONE, 1000 * ONE);
        _fund(p, 7 * ONE, 3 * ONE);
        vm.expectEmit(false, false, false, true, address(p));
        emit INairaSwapPair.Sync(uint112(1007 * ONE), uint112(1003 * ONE));
        p.sync();
        (uint112 r0, uint112 r1,) = p.getReserves();
        assertEq(r0, 1007 * ONE);
        assertEq(r1, 1003 * ONE);
    }

    function test_Sync_ExactlyUint112MaxIsAllowed() public {
        MockERC20(t0).mint(address(p), type(uint112).max);
        p.sync();
        (uint112 r0,,) = p.getReserves();
        assertEq(r0, type(uint112).max);
    }

    function test_RevertSync_ReserveOverflow() public {
        uint256 big = uint256(type(uint112).max) + 1;
        MockERC20(t0).mint(address(p), big);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.ReserveOverflow.selector, big, 0));
        p.sync();
    }

    function test_RevertMint_ReserveOverflow() public {
        uint256 big = uint256(type(uint112).max) + 1;
        MockERC20(t0).mint(address(p), big);
        MockERC20(t1).mint(address(p), big);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapPair.ReserveOverflow.selector, big, big));
        p.mint(alice);
    }

    function test_RevertSwap_ReserveOverflow() public {
        _seed(1000 * ONE, 1000 * ONE);
        uint256 over = uint256(type(uint112).max);
        MockERC20(t0).mint(address(p), over); // balance0 = max + 1000e18
        vm.expectRevert();
        p.swap(0, 1, bob, "");
    }

    function test_RevertRouterAdd_ReserveOverflow() public {
        tokenA.mint(alice, type(uint112).max);
        tokenB.mint(alice, type(uint112).max);
        vm.prank(alice);
        vm.expectRevert();
        router.addLiquidity(
            address(tokenA), address(tokenB), uint256(type(uint112).max) + 1, uint256(type(uint112).max) + 1, 0, 0, alice, deadline
        );
    }

    // ------------------------------------------------------ price accumulators

    function test_PriceCumulative_AccruesWithTime() public {
        _seed(1000 * ONE, 4000 * ONE);
        (uint112 r0, uint112 r1, uint32 last) = p.getReserves();
        assertEq(last, uint32(block.timestamp));
        skip(100);
        p.sync();
        assertEq(p.price0CumulativeLast(), (uint256(r1) << 112) / r0 * 100);
        assertEq(p.price1CumulativeLast(), (uint256(r0) << 112) / r1 * 100);
    }

    // -------------------------------------------------------------- reentrancy

    function _hookPair() internal returns (HookERC20 h, INairaSwapPair hp) {
        h = new HookERC20("Hook", "HK");
        h.mint(alice, 1e30);
        hp = INairaSwapPair(factory.createPair(address(h), address(tokenA)));
        vm.startPrank(alice);
        h.transfer(address(hp), 1000 * ONE);
        tokenA.transfer(address(hp), 1000 * ONE);
        hp.mint(alice);
        vm.stopPrank();
    }

    function test_Swap_ReentrancyIntoPairReverts() public {
        (HookERC20 h, INairaSwapPair hp) = _hookPair();
        vm.prank(alice);
        tokenA.transfer(address(hp), 10 * ONE);
        h.arm(address(hp), abi.encodeCall(INairaSwapPair.sync, ()));
        bool hookIs0 = address(h) == hp.token0();
        vm.expectRevert(NairaSwapPair.Locked.selector);
        hp.swap(hookIs0 ? 5 * ONE : 0, hookIs0 ? 0 : 5 * ONE, bob, "");
    }

    function test_Burn_ReentrancyIntoPairReverts() public {
        (HookERC20 h, INairaSwapPair hp) = _hookPair();
        vm.prank(alice);
        hp.transfer(address(hp), 100 * ONE);
        h.arm(address(hp), abi.encodeCall(INairaSwapPair.skim, (bob)));
        vm.expectRevert(NairaSwapPair.Locked.selector);
        hp.burn(bob);
    }

    // ------------------------------------------------------------ protocol fee

    function _churn(address a, address b, uint256 rounds, uint256 size) internal {
        for (uint256 i; i < rounds; i++) {
            _swapIn(bob, size, _path2(a, b));
            _swapIn(bob, size, _path2(b, a));
        }
    }

    function test_ProtocolFee_MintsOneSixthOfFeeGrowthToFeeTo() public {
        _add(alice, address(tokenA), address(tokenB), 100_000 * ONE, 100_000 * ONE);
        assertEq(p.balanceOf(address(treasury)), 0, "no fee LP before any growth");
        assertGt(p.kLast(), 0, "kLast tracked while feeTo set");
        _churn(address(tokenA), address(tokenB), 10, 5_000 * ONE);

        (uint112 r0, uint112 r1,) = p.getReserves();
        uint256 rootK = Math.sqrt(uint256(r0) * r1);
        uint256 rootKLast = Math.sqrt(p.kLast());
        uint256 supply = p.totalSupply();
        assertGt(rootK, rootKLast);
        uint256 expected = supply * (rootK - rootKLast) / (rootK * 5 + rootKLast);

        _add(carol, address(tokenA), address(tokenB), 1_000 * ONE, 1_000 * ONE); // triggers _mintFee
        uint256 feeLp = p.balanceOf(address(treasury));
        assertEq(feeLp, expected, "formula");
        assertGt(feeLp, 0);
        // Treasury owns ~1/6 of the growth fraction: feeLp/(S+feeLp) ~= (rootK-rootKLast)/(6*rootK)
        assertApproxEqRel(feeLp * 1e18 / (supply + feeLp), (rootK - rootKLast) * 1e18 / (6 * rootK), 1e12);
    }

    function test_ProtocolFee_ValueIsAboutFiveBpsOfVolume() public {
        _add(alice, address(tokenA), address(tokenB), 1_000_000 * ONE, 1_000_000 * ONE);
        uint256 volume;
        for (uint256 i; i < 10; i++) {
            _swapIn(bob, 5_000 * ONE, _path2(address(tokenA), address(tokenB)));
            _swapIn(bob, 5_000 * ONE, _path2(address(tokenB), address(tokenA)));
            volume += 10_000 * ONE;
        }
        _add(carol, address(tokenA), address(tokenB), 1_000 * ONE, 1_000 * ONE); // mint fee LP
        uint256 feeLp = p.balanceOf(address(treasury));
        (uint112 r0, uint112 r1,) = p.getReserves();
        // underlying claim of treasury LP, valued in A+B at ~1:1 price
        uint256 value = feeLp * (uint256(r0) + r1) / p.totalSupply();
        // 0.05% of volume, tolerate 5%
        assertApproxEqRel(value, volume * 5 / 10_000, 5e16);
    }

    function test_ProtocolFee_AlsoMintedOnBurn() public {
        (,, uint256 liq) = _add(alice, address(tokenA), address(tokenB), 100_000 * ONE, 100_000 * ONE);
        _churn(address(tokenA), address(tokenB), 5, 5_000 * ONE);
        vm.prank(alice);
        p.approve(address(router), liq);
        vm.prank(alice);
        router.removeLiquidity(address(tokenA), address(tokenB), liq / 2, 0, 0, alice, deadline);
        assertGt(p.balanceOf(address(treasury)), 0);
    }

    function test_ProtocolFee_NoneWhenFeeToZero() public {
        MockFactory mf = new MockFactory();
        NairaSwapPair zp = mf.deploy(address(tokenA), address(tokenB));
        assertEq(mf.feeTo(), address(0));
        address z0 = zp.token0();
        address z1 = zp.token1();
        vm.startPrank(alice);
        IERC20(z0).transfer(address(zp), 100_000 * ONE);
        IERC20(z1).transfer(address(zp), 100_000 * ONE);
        uint256 liq = zp.mint(alice);
        vm.stopPrank();
        assertEq(zp.kLast(), 0);
        for (uint256 i; i < 5; i++) {
            vm.prank(bob);
            IERC20(z0).transfer(address(zp), 5_000 * ONE);
            (uint112 r0, uint112 r1,) = zp.getReserves();
            zp.swap(0, router.getAmountOut(5_000 * ONE, r0, r1), bob, "");
        }
        vm.startPrank(alice);
        IERC20(z0).transfer(address(zp), 1_000 * ONE);
        IERC20(z1).transfer(address(zp), 1_000 * ONE);
        uint256 liq2 = zp.mint(carol);
        vm.stopPrank();
        assertEq(zp.totalSupply(), 1000 + liq + liq2, "no fee LP minted to anyone");
        assertEq(zp.kLast(), 0);
    }

    function test_KLast_ResetsWhenFeeDisabled() public {
        MockFactory mf = new MockFactory();
        mf.setFeeTo(makeAddr("recipient"));
        NairaSwapPair zp = mf.deploy(address(tokenA), address(tokenB));
        vm.startPrank(alice);
        IERC20(zp.token0()).transfer(address(zp), 100 * ONE);
        IERC20(zp.token1()).transfer(address(zp), 100 * ONE);
        zp.mint(alice);
        assertGt(zp.kLast(), 0);
        mf.setFeeTo(address(0));
        IERC20(zp.token0()).transfer(address(zp), 10 * ONE);
        IERC20(zp.token1()).transfer(address(zp), 10 * ONE);
        zp.mint(alice);
        vm.stopPrank();
        assertEq(zp.kLast(), 0);
    }
}
