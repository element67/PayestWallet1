// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapRouter} from "../NairaSwapRouter.sol";
import {NairaSwapPair} from "../NairaSwapPair.sol";
import {NairaSwapLibrary} from "../libraries/NairaSwapLibrary.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";
import {MockERC20, LibHarness} from "../test-helpers/NairaSwapMocks.sol";

contract NairaSwapSwapTest is NairaSwapTestBase {
    address internal A;
    address internal B;
    address internal C;
    address internal D;
    MockERC20 internal tokenE;
    LibHarness internal lib;

    function setUp() public override {
        super.setUp();
        A = address(tokenA);
        B = address(tokenB);
        C = address(tokenC);
        D = address(tokenD);
        tokenE = new MockERC20("Token E", "TKE");
        tokenE.mint(bob, FUND);
        tokenE.mint(alice, FUND);
        vm.prank(bob);
        tokenE.approve(address(router), type(uint256).max);
        vm.prank(alice);
        tokenE.approve(address(router), type(uint256).max);
        lib = new LibHarness();
        _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        _add(alice, B, C, 1000 * ONE, 2000 * ONE);
    }

    function _out(uint256 amountIn, uint256 rIn, uint256 rOut) internal pure returns (uint256) {
        return amountIn * 997 * rOut / (rIn * 1000 + amountIn * 997);
    }

    // ------------------------------------------------------ swapExactTokensForTokens

    function test_SwapExact_SingleHop_ExactFeeMath() public {
        uint256 amountIn = 10 * ONE;
        uint256 expected = _out(amountIn, 1000 * ONE, 1000 * ONE);
        uint256 balBefore = tokenB.balanceOf(bob);
        vm.prank(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, expected, _path2(A, B), bob, deadline);
        assertEq(amounts.length, 2);
        assertEq(amounts[0], amountIn);
        assertEq(amounts[1], expected);
        assertEq(tokenB.balanceOf(bob) - balBefore, expected);
        assertEq(tokenA.balanceOf(bob), FUND - amountIn);
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, 1010 * ONE);
        assertEq(rb, 1000 * ONE - expected);
        assertEq(tokenA.balanceOf(address(router)) + tokenB.balanceOf(address(router)), 0);
    }

    function test_SwapExact_LpFeeStaysInPool_KGrows() public {
        uint256 k0 = _k(A, B);
        _swapIn(bob, 50 * ONE, _path2(A, B));
        assertGt(_k(A, B), k0);
    }

    function test_SwapExact_EmitsSwapOnPair() public {
        INairaSwapPair p = _pairOf(A, B);
        uint256 out = _out(10 * ONE, 1000 * ONE, 1000 * ONE);
        (uint256 a0In, uint256 a1In, uint256 a0Out, uint256 a1Out) =
            p.token0() == A ? (10 * ONE, uint256(0), uint256(0), out) : (uint256(0), 10 * ONE, out, uint256(0));
        vm.expectEmit(true, true, false, true, address(p));
        emit INairaSwapPair.Swap(address(router), a0In, a1In, a0Out, a1Out, bob);
        _swapIn(bob, 10 * ONE, _path2(A, B));
    }

    function test_SwapExact_MultiHop_TwoHops() public {
        uint256 hop1 = _out(10 * ONE, 1000 * ONE, 1000 * ONE);
        uint256 hop2 = _out(hop1, 1000 * ONE, 2000 * ONE);
        vm.prank(bob);
        uint256[] memory amounts = router.swapExactTokensForTokens(10 * ONE, hop2, _path3(A, B, C), carol, deadline);
        assertEq(amounts[1], hop1);
        assertEq(amounts[2], hop2);
        assertEq(tokenC.balanceOf(carol), FUND + hop2);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_SwapExact_MultiHop_FourHops() public {
        _add(alice, C, D, 1000 * ONE, 1000 * ONE);
        _add(alice, D, address(tokenE), 1000 * ONE, 1000 * ONE);
        address[] memory path = new address[](5);
        path[0] = A;
        path[1] = B;
        path[2] = C;
        path[3] = D;
        path[4] = address(tokenE);
        uint256[] memory quoted = router.getAmountsOut(5 * ONE, path);
        uint256 before = tokenE.balanceOf(carol);
        vm.prank(bob);
        router.swapExactTokensForTokens(5 * ONE, quoted[4], path, carol, deadline);
        assertEq(tokenE.balanceOf(carol) - before, quoted[4]);
        assertEq(router.MAX_PATH(), 4);
    }

    function test_RevertSwapExact_SlippageTooHigh() public {
        uint256 expected = _out(10 * ONE, 1000 * ONE, 1000 * ONE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientOutputAmount.selector, expected, expected + 1));
        router.swapExactTokensForTokens(10 * ONE, expected + 1, _path2(A, B), bob, deadline);
    }

    function test_RevertSwapExact_Expired() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, block.timestamp - 1, block.timestamp));
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), bob, block.timestamp - 1);
    }

    function test_RevertSwapExact_InvalidToAndPathAndAmounts() public {
        vm.startPrank(bob);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), address(0), deadline);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), address(router), deadline);
        vm.expectRevert(NairaSwapLibrary.InvalidPath.selector);
        router.swapExactTokensForTokens(ONE, 0, new address[](1), bob, deadline);
        vm.expectRevert(NairaSwapLibrary.InvalidPath.selector);
        router.swapExactTokensForTokens(ONE, 0, new address[](6), bob, deadline);
        vm.expectRevert(NairaSwapLibrary.IdenticalAddresses.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, A), bob, deadline);
        vm.expectRevert(NairaSwapLibrary.InsufficientInputAmount.selector);
        router.swapExactTokensForTokens(0, 0, _path2(A, B), bob, deadline);
        // pair A/D does not exist
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, D), bob, deadline);
        vm.stopPrank();
    }

    function test_RevertSwapExact_RecipientIsOutputToken() public {
        vm.prank(bob);
        vm.expectRevert(NairaSwapPair.InvalidTo.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), B, deadline);
    }

    function test_RevertSwapExact_NoAllowance() public {
        address dave = makeAddr("dave");
        tokenA.mint(dave, ONE);
        vm.prank(dave);
        vm.expectRevert();
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), dave, deadline);
    }

    // ------------------------------------------------------ swapTokensForExactTokens

    function test_SwapForExact_SingleHop() public {
        uint256 want = 10 * ONE;
        uint256[] memory quoted = router.getAmountsIn(want, _path2(A, B));
        uint256 balA = tokenA.balanceOf(bob);
        // input is rounded up: spending 1 wei less would not have sufficed
        assertLe(_out(quoted[0] - 1, 1000 * ONE, 1000 * ONE), want - 1);
        vm.prank(bob);
        uint256[] memory amounts = router.swapTokensForExactTokens(want, quoted[0], _path2(A, B), carol, deadline);
        assertEq(amounts[0], quoted[0]);
        assertEq(amounts[1], want);
        assertEq(tokenB.balanceOf(carol), FUND + want);
        assertEq(balA - tokenA.balanceOf(bob), quoted[0]);
    }

    function test_SwapForExact_MultiHop() public {
        uint256[] memory quoted = router.getAmountsIn(20 * ONE, _path3(A, B, C));
        vm.prank(bob);
        router.swapTokensForExactTokens(20 * ONE, quoted[0], _path3(A, B, C), bob, deadline);
        assertEq(tokenC.balanceOf(bob), FUND + 20 * ONE);
    }

    function test_RevertSwapForExact_InputExceedsMax() public {
        uint256[] memory quoted = router.getAmountsIn(10 * ONE, _path2(A, B));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.ExcessiveInputAmount.selector, quoted[0], quoted[0] - 1));
        router.swapTokensForExactTokens(10 * ONE, quoted[0] - 1, _path2(A, B), bob, deadline);
    }

    function test_RevertSwapForExact_ExpiredInvalidToAndTooMuchOut() public {
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, block.timestamp - 1, block.timestamp));
        router.swapTokensForExactTokens(ONE, type(uint256).max, _path2(A, B), bob, block.timestamp - 1);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.swapTokensForExactTokens(ONE, type(uint256).max, _path2(A, B), address(0), deadline);
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        router.swapTokensForExactTokens(1000 * ONE, type(uint256).max, _path2(A, B), bob, deadline);
        vm.expectRevert(NairaSwapLibrary.InsufficientOutputAmount.selector);
        router.swapTokensForExactTokens(0, type(uint256).max, _path2(A, B), bob, deadline);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ fee-on-transfer

    function _seedFot() internal {
        _add(alice, address(fot), B, 1000 * ONE, 1000 * ONE); // pool holds 990 fot
        _add(alice, address(fot), C, 1000 * ONE, 1000 * ONE);
    }

    function test_SwapSupportingFee_FotInput() public {
        _seedFot();
        (uint256 rf, uint256 rb) = _res(address(fot), B);
        uint256 received = 100 * ONE * 99 / 100;
        uint256 expected = _out(received, rf, rb);
        uint256 before = tokenB.balanceOf(bob);
        vm.prank(bob);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            100 * ONE, expected, _path2(address(fot), B), bob, deadline
        );
        assertEq(tokenB.balanceOf(bob) - before, expected);
    }

    function test_SwapSupportingFee_FotOutputMinMeasuredOnActualReceipt() public {
        _seedFot();
        (uint256 rb, uint256 rf) = _res(B, address(fot));
        uint256 pairOut = _out(10 * ONE, rb, rf);
        uint256 actual = pairOut - pairOut * 100 / 10_000;
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientOutputAmount.selector, actual, actual + 1));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
            10 * ONE, actual + 1, _path2(B, address(fot)), bob, deadline
        );
        uint256 before = fot.balanceOf(carol);
        vm.prank(bob);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(10 * ONE, actual, _path2(B, address(fot)), carol, deadline);
        assertEq(fot.balanceOf(carol) - before, actual);
    }

    function test_SwapSupportingFee_FotIntermediateHop() public {
        _seedFot();
        address[] memory path = _path3(B, address(fot), C);
        uint256 before = tokenC.balanceOf(carol);
        vm.prank(bob);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(10 * ONE, 1, path, carol, deadline);
        assertGt(tokenC.balanceOf(carol) - before, 0);
        assertEq(fot.balanceOf(address(router)), 0);
    }

    function test_SwapSupportingFee_KDoesNotDecrease() public {
        _seedFot();
        uint256 k0 = _k(address(fot), B);
        vm.prank(bob);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(100 * ONE, 1, _path2(address(fot), B), bob, deadline);
        assertGt(_k(address(fot), B), k0);
    }

    function test_RevertSwapExact_FotInputBreaksInvariant_UseSupportingVariant() public {
        _seedFot();
        vm.prank(bob);
        vm.expectRevert(NairaSwapPair.InvariantViolation.selector);
        router.swapExactTokensForTokens(100 * ONE, 0, _path2(address(fot), B), bob, deadline);
    }

    function test_RevertSwapExact_FotOutputBelowQuotedMin() public {
        _seedFot();
        uint256[] memory q = router.getAmountsOut(10 * ONE, _path2(B, address(fot)));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientOutputAmount.selector, q[1] - q[1] * 100 / 10_000, q[1]));
        router.swapExactTokensForTokens(10 * ONE, q[1], _path2(B, address(fot)), bob, deadline);
    }

    function test_RevertSwapSupporting_ExpiredPausedInvalidAndZero() public {
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, block.timestamp - 1, block.timestamp));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(ONE, 0, _path2(A, B), bob, block.timestamp - 1);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(ONE, 0, _path2(A, B), address(0), deadline);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientInputAmount.selector, 0, 1));
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(0, 0, _path2(A, B), bob, deadline);
        vm.expectRevert(NairaSwapLibrary.InvalidPath.selector);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(ONE, 0, new address[](1), bob, deadline);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ quote functions

    function test_Quote_Functions() public view {
        assertEq(router.quote(10, 100, 300), 30);
        assertEq(router.getAmountOut(10 * ONE, 1000 * ONE, 1000 * ONE), _out(10 * ONE, 1000 * ONE, 1000 * ONE));
        uint256 inNeeded = router.getAmountIn(10 * ONE, 1000 * ONE, 1000 * ONE);
        assertGe(router.getAmountOut(inNeeded, 1000 * ONE, 1000 * ONE), 10 * ONE);
        assertEq(router.getAmountsOut(ONE, _path2(A, B))[0], ONE);
        assertEq(router.getAmountsIn(ONE, _path2(A, B)).length, 2);
    }

    function test_Quote_Reverts() public {
        vm.expectRevert(NairaSwapLibrary.InsufficientInputAmount.selector);
        router.quote(0, 1, 1);
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        router.quote(1, 0, 1);
        vm.expectRevert(NairaSwapLibrary.InsufficientInputAmount.selector);
        router.getAmountOut(0, 1, 1);
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        router.getAmountOut(1, 0, 1);
        vm.expectRevert(NairaSwapLibrary.InsufficientOutputAmount.selector);
        router.getAmountIn(0, 1, 1);
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        router.getAmountIn(1, 1, 1);
    }

    // ------------------------------------------------------------------- library

    function test_Library_SortAndPairFor() public view {
        (address lo, address hi) = lib.sortTokens(B, A);
        assertTrue(lo < hi);
        assertEq(lib.pairFor(address(factory), A, B), factory.getPair(A, B));
        assertEq(lib.pairFor(address(factory), B, A), factory.getPair(A, B));
        (uint256 ra, uint256 rb) = lib.getReserves(address(factory), A, B);
        assertEq(ra, 1000 * ONE);
        assertEq(rb, 1000 * ONE);
    }

    function test_Library_Reverts() public {
        vm.expectRevert(NairaSwapLibrary.IdenticalAddresses.selector);
        lib.sortTokens(A, A);
        vm.expectRevert(NairaSwapLibrary.ZeroAddress.selector);
        lib.sortTokens(address(0), A);
        vm.expectRevert(NairaSwapLibrary.InsufficientLiquidity.selector);
        lib.getReserves(address(factory), A, D);
        vm.expectRevert(NairaSwapLibrary.InvalidPath.selector);
        lib.validatePath(new address[](0));
    }

    function test_Library_PairForPredictsUndeployedPair() public view {
        address predicted = lib.pairFor(address(factory), A, D);
        assertEq(predicted.code.length, 0);
    }
}
