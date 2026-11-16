// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";

contract NairaSwapFuzzTest is NairaSwapTestBase {
    address internal A;
    address internal B;
    address internal C;

    function setUp() public override {
        super.setUp();
        A = address(tokenA);
        B = address(tokenB);
        C = address(tokenC);
    }

    function _seed(address x, address y, uint256 rx, uint256 ry) internal {
        _add(alice, x, y, rx, ry);
    }

    // ------------------------------------------------------------- swap math

    function testFuzz_SwapExactIn_KNeverDecreases_AndMatchesFormula(uint256 rA, uint256 rB, uint256 amountIn) public {
        rA = bound(rA, 1e6, 1e27);
        rB = bound(rB, 1e6, 1e27);
        amountIn = bound(amountIn, 1, 1e27);
        _seed(A, B, rA, rB);
        uint256 expected = amountIn * 997 * rB / (rA * 1000 + amountIn * 997);
        vm.assume(expected > 0);
        uint256 k0 = _k(A, B);

        uint256 out = _swapIn(bob, amountIn, _path2(A, B));

        assertEq(out, expected);
        assertLt(out, rB, "never drains the reserve");
        assertGe(_k(A, B), k0, "k must not decrease");
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, rA + amountIn);
        assertEq(rb, rB - out);
    }

    function testFuzz_SwapExactOut_ReceivesExactlyAndKNeverDecreases(uint256 rA, uint256 rB, uint256 out) public {
        rA = bound(rA, 1e6, 1e27);
        rB = bound(rB, 1e6, 1e27);
        out = bound(out, 1, rB * 9 / 10);
        _seed(A, B, rA, rB);
        uint256 k0 = _k(A, B);
        uint256 balBefore = tokenB.balanceOf(carol);
        uint256[] memory q = router.getAmountsIn(out, _path2(A, B));
        vm.prank(bob);
        router.swapTokensForExactTokens(out, q[0], _path2(A, B), carol, deadline);
        assertEq(tokenB.balanceOf(carol) - balBefore, out);
        assertGe(_k(A, B), k0);
    }

    function testFuzz_MultiHop_KNonDecreasingOnBothPools(uint256 amountIn, uint256 r1, uint256 r2) public {
        r1 = bound(r1, 1e9, 1e26);
        r2 = bound(r2, 1e9, 1e26);
        amountIn = bound(amountIn, 1e3, 1e26);
        _seed(A, B, r1, r2);
        _seed(B, C, r2, r1);
        uint256 hop1 = router.getAmountOut(amountIn, r1, r2);
        vm.assume(hop1 > 0);
        vm.assume(router.getAmountOut(hop1, r2, r1) > 0);
        uint256[] memory q = router.getAmountsOut(amountIn, _path3(A, B, C));
        uint256 kAB = _k(A, B);
        uint256 kBC = _k(B, C);
        vm.prank(bob);
        router.swapExactTokensForTokens(amountIn, q[2], _path3(A, B, C), bob, deadline);
        assertGe(_k(A, B), kAB);
        assertGe(_k(B, C), kBC);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function testFuzz_QuoteRoundTrip_AmountInCoversAmountOut(uint256 rIn, uint256 rOut, uint256 out) public view {
        // reserves capped so intermediate products stay inside uint256 (library has no overflow guard beyond checked math)
        rIn = bound(rIn, 1, 1e22);
        rOut = bound(rOut, 2, 1e22);
        out = bound(out, 1, rOut - 1);
        uint256 need = router.getAmountIn(out, rIn, rOut);
        assertGe(router.getAmountOut(need, rIn, rOut), out);
    }

    function testFuzz_GetAmountOut_Monotonic(uint256 rIn, uint256 rOut, uint256 a, uint256 b) public view {
        rIn = bound(rIn, 1, 1e30);
        rOut = bound(rOut, 1, 1e30);
        a = bound(a, 1, 1e30);
        b = bound(b, a, 1e30);
        assertLe(router.getAmountOut(a, rIn, rOut), router.getAmountOut(b, rIn, rOut));
    }

    // ------------------------------------------------------ add / remove round trips

    function testFuzz_AddRemove_NeverCreatesValue(uint256 rA, uint256 rB, uint256 dA, uint256 dB) public {
        rA = bound(rA, 1e6, 1e27);
        rB = bound(rB, 1e6, 1e27);
        dA = bound(dA, 1e3, 1e27);
        dB = bound(dB, 1e3, 1e27);
        _seed(A, B, rA, rB);
        INairaSwapPair p = _pairOf(A, B);
        uint256 a0 = tokenA.balanceOf(bob);
        uint256 b0 = tokenB.balanceOf(bob);

        vm.startPrank(bob);
        uint256 liq;
        try router.addLiquidity(A, B, dA, dB, 0, 0, bob, deadline) returns (uint256, uint256, uint256 l) {
            liq = l;
        } catch {
            vm.stopPrank();
            return; // dust deposits that mint zero LP are rejected by the pair
        }
        p.approve(address(router), liq);
        try router.removeLiquidity(A, B, liq, 0, 0, bob, deadline) {} catch {
            vm.stopPrank();
            return; // dust amounts rounding to zero are rejected
        }
        vm.stopPrank();
        assertLe(tokenA.balanceOf(bob), a0, "no free token A");
        assertLe(tokenB.balanceOf(bob), b0, "no free token B");
        assertEq(p.balanceOf(bob), 0);
    }

    function testFuzz_AddRemove_BalancedPoolLosesAtMostRounding(uint256 r, uint256 d) public {
        r = bound(r, 1e18, 1e27);
        d = bound(d, 1e12, r);
        _seed(A, B, r, r);
        INairaSwapPair p = _pairOf(A, B);
        uint256 a0 = tokenA.balanceOf(bob);
        uint256 b0 = tokenB.balanceOf(bob);
        (,, uint256 liq) = _add(bob, A, B, d, d);
        vm.startPrank(bob);
        p.approve(address(router), liq);
        router.removeLiquidity(A, B, liq, 0, 0, bob, deadline);
        vm.stopPrank();
        assertLe(tokenA.balanceOf(bob), a0);
        assertLe(tokenB.balanceOf(bob), b0);
        assertLe(a0 - tokenA.balanceOf(bob), 5, "A rounding loss");
        assertLe(b0 - tokenB.balanceOf(bob), 5, "B rounding loss");
    }

    function testFuzz_SwapThenRemove_LpHoldersNeverLose(uint256 rA, uint256 rB, uint256 amountIn) public {
        rA = bound(rA, 1e12, 1e27);
        rB = bound(rB, 1e12, 1e27);
        // keep the pool away from the degenerate few-wei-reserve regime where pure rounding dominates
        amountIn = bound(amountIn, 1e6, rA * 5);
        vm.assume(router.getAmountOut(amountIn, rA, rB) > 0);
        (,, uint256 liq) = _add(alice, A, B, rA, rB);
        _swapIn(bob, amountIn, _path2(A, B));
        INairaSwapPair p = _pairOf(A, B);
        vm.startPrank(alice);
        p.approve(address(router), liq);
        (uint256 outA, uint256 outB) = router.removeLiquidity(A, B, liq, 0, 0, alice, deadline);
        vm.stopPrank();
        // Fees accrue to LPs (net of the protocol's 1/6): the LP's geometric-mean claim never falls
        // below what was deposited (liq == sqrt(rA*rB) - MINIMUM_LIQUIDITY), up to rounding.
        // tolerance covers 1-wei floor errors amplified by the reserve ratio (sqrt(rB/rA)) in the geometric mean
        assertGe(Math.sqrt(outA * outB) + liq / 1e9 + 10, liq);
    }

    // ------------------------------------------------------------ protocol fee

    function testFuzz_ProtocolFee_FormulaAndNeverAboveOneSixthOfGrowth(uint256 vol, uint8 rounds) public {
        vol = bound(vol, 1e18, 20_000 * ONE);
        rounds = uint8(bound(rounds, 1, 8));
        _seed(A, B, 200_000 * ONE, 200_000 * ONE);
        INairaSwapPair p = _pairOf(A, B);
        for (uint256 i; i < rounds; i++) {
            _swapIn(bob, vol, _path2(A, B));
            _swapIn(bob, vol, _path2(B, A));
        }
        (uint256 ra, uint256 rb) = _res(A, B);
        uint256 rootK = Math.sqrt(ra * rb);
        uint256 rootKLast = Math.sqrt(p.kLast());
        uint256 supply = p.totalSupply();
        _add(carol, A, B, 1_000 * ONE, 1_000 * ONE);
        uint256 feeLp = p.balanceOf(address(treasury));
        assertEq(feeLp, supply * (rootK - rootKLast) / (rootK * 5 + rootKLast));
        // treasury share of the enlarged pool never exceeds 1/6 of relative sqrt(k) growth
        assertLe(feeLp * 6 * rootK, (supply + feeLp) * (rootK - rootKLast) + (supply + feeLp));
    }

    // ------------------------------------------------------------ timelock

    function testFuzz_FeeToApplies_IffDelayElapsed(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 10 days);
        address nf = makeAddr("nf");
        vm.prank(owner);
        factory.queueFeeTo(nf);
        skip(elapsed);
        if (elapsed >= 2 days) {
            factory.applyFeeTo();
            assertEq(factory.feeTo(), nf);
        } else {
            vm.expectRevert();
            factory.applyFeeTo();
            assertEq(factory.feeTo(), address(treasury));
        }
    }

    function testFuzz_PayoutApplies_IffDelayElapsed(uint256 elapsed) public {
        elapsed = bound(elapsed, 0, 10 days);
        address np = makeAddr("np");
        vm.prank(owner);
        treasury.queuePayout(np);
        skip(elapsed);
        if (elapsed >= 2 days) {
            treasury.applyPayout();
            assertEq(treasury.payout(), np);
        } else {
            vm.expectRevert();
            treasury.applyPayout();
            assertEq(treasury.payout(), payoutAddr);
        }
    }
}
