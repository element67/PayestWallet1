// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapRouter} from "../NairaSwapRouter.sol";
import {NairaSwapFactory} from "../NairaSwapFactory.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";

contract NairaSwapLiquidityTest is NairaSwapTestBase {
    address internal A;
    address internal B;

    function setUp() public override {
        super.setUp();
        A = address(tokenA);
        B = address(tokenB);
    }

    // -------------------------------------------------------------- addLiquidity

    function test_AddLiquidity_First_CreatesPairAndMintsSqrtMinusLock() public {
        assertEq(factory.getPair(A, B), address(0));
        vm.prank(alice);
        (uint256 a, uint256 b, uint256 liq) = router.addLiquidity(A, B, 4000 * ONE, 1000 * ONE, 0, 0, bob, deadline);
        assertEq(a, 4000 * ONE);
        assertEq(b, 1000 * ONE);
        assertEq(liq, 2000 * ONE - 1000);
        INairaSwapPair p = _pairOf(A, B);
        assertTrue(address(p) != address(0));
        assertEq(p.balanceOf(bob), liq);
        assertEq(p.balanceOf(address(0xdead)), 1000);
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, 4000 * ONE);
        assertEq(rb, 1000 * ONE);
    }

    function test_AddLiquidity_TokenOrderIrrelevant() public {
        _add(alice, B, A, 100 * ONE, 400 * ONE);
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, 400 * ONE);
        assertEq(rb, 100 * ONE);
    }

    function test_AddLiquidity_EmitsMintOnPair() public {
        factory.createPair(A, B);
        INairaSwapPair p = _pairOf(A, B);
        (uint256 a0, uint256 a1) = p.token0() == A ? (100 * ONE, 200 * ONE) : (200 * ONE, 100 * ONE);
        vm.expectEmit(true, false, false, true, address(p));
        emit INairaSwapPair.Mint(address(router), a0, a1);
        vm.prank(alice);
        router.addLiquidity(A, B, 100 * ONE, 200 * ONE, 0, 0, alice, deadline);
    }

    function test_AddLiquidity_RouterHoldsNoTokens() public {
        _seedAB();
        _add(bob, A, B, 100 * ONE, 300 * ONE);
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(_pairOf(A, B).balanceOf(address(router)), 0);
    }

    function test_AddLiquidity_Subsequent_UsesOptimalB() public {
        _add(alice, A, B, 1000 * ONE, 2000 * ONE);
        (uint256 a, uint256 b, uint256 liq) = _add(bob, A, B, 100 * ONE, 500 * ONE);
        assertEq(a, 100 * ONE);
        assertEq(b, 200 * ONE, "B capped to pool ratio");
        assertGt(liq, 0);
        assertEq(tokenA.balanceOf(bob), FUND - 100 * ONE);
        assertEq(tokenB.balanceOf(bob), FUND - 200 * ONE);
    }

    function test_AddLiquidity_Subsequent_UsesOptimalA() public {
        _add(alice, A, B, 1000 * ONE, 2000 * ONE);
        (uint256 a, uint256 b,) = _add(bob, A, B, 500 * ONE, 200 * ONE);
        assertEq(a, 100 * ONE, "A capped to pool ratio");
        assertEq(b, 200 * ONE);
    }

    function test_AddLiquidity_Subsequent_LpProportionalToShare() public {
        (,, uint256 first) = _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        (,, uint256 second) = _add(bob, A, B, 100 * ONE, 100 * ONE);
        assertEq(first + 1000, 1000 * ONE);
        assertEq(second, 100 * ONE);
    }

    function test_RevertAddLiquidity_BelowMinA_AndMinB() public {
        _add(alice, A, B, 1000 * ONE, 2000 * ONE);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientInputAmount.selector, 200 * ONE, 300 * ONE));
        router.addLiquidity(A, B, 100 * ONE, 500 * ONE, 0, 300 * ONE, bob, deadline);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientInputAmount.selector, 100 * ONE, 101 * ONE));
        router.addLiquidity(A, B, 100 * ONE, 500 * ONE, 101 * ONE, 0, bob, deadline);
    }

    function test_RevertAddLiquidity_Expired() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, block.timestamp - 1, block.timestamp));
        router.addLiquidity(A, B, ONE, ONE, 0, 0, alice, block.timestamp - 1);
    }

    function test_AddLiquidity_DeadlineEqualToNowIsOk() public {
        vm.prank(alice);
        router.addLiquidity(A, B, 100 * ONE, 100 * ONE, 0, 0, alice, block.timestamp);
    }

    function test_RevertAddLiquidity_InvalidTo() public {
        vm.prank(alice);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.addLiquidity(A, B, ONE, ONE, 0, 0, address(0), deadline);
        vm.prank(alice);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.addLiquidity(A, B, ONE, ONE, 0, 0, address(router), deadline);
    }

    function test_RevertAddLiquidity_IdenticalAndZeroTokens() public {
        vm.prank(alice);
        vm.expectRevert(NairaSwapFactory.IdenticalAddresses.selector);
        router.addLiquidity(A, A, ONE, ONE, 0, 0, alice, deadline);
        vm.prank(alice);
        vm.expectRevert(NairaSwapFactory.ZeroAddress.selector);
        router.addLiquidity(address(0), A, ONE, ONE, 0, 0, alice, deadline);
    }

    function test_RevertAddLiquidity_NoAllowance() public {
        address dave = makeAddr("dave");
        tokenA.mint(dave, 10 * ONE);
        tokenB.mint(dave, 10 * ONE);
        vm.prank(dave);
        vm.expectRevert();
        router.addLiquidity(A, B, ONE, ONE, 0, 0, dave, deadline);
    }

    function test_AddLiquidity_FeeOnTransfer_UsesActualReceived() public {
        vm.prank(alice);
        (uint256 a, uint256 b, uint256 liq) =
            router.addLiquidity(address(fot), B, 1000 * ONE, 1000 * ONE, 0, 0, alice, deadline);
        assertEq(a, 990 * ONE, "actual received after 1% fee");
        assertEq(b, 1000 * ONE);
        assertGt(liq, 0);
        (uint256 rf, uint256 rb) = _res(address(fot), B);
        assertEq(rf, 990 * ONE);
        assertEq(rb, 1000 * ONE);
    }

    function test_RevertAddLiquidity_FeeOnTransferBelowMin() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InsufficientInputAmount.selector, 990 * ONE, 1000 * ONE));
        router.addLiquidity(address(fot), B, 1000 * ONE, 1000 * ONE, 1000 * ONE, 0, alice, deadline);
    }

    // ------------------------------------------- donation before first deposit

    function test_AddLiquidity_OneSidedDonationAndSyncBeforeFirstDeposit() public {
        address pairAddr = factory.createPair(A, B);
        vm.prank(alice);
        tokenA.transfer(pairAddr, 500 * ONE);
        INairaSwapPair(pairAddr).sync();
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, 500 * ONE);
        assertEq(rb, 0);

        vm.prank(bob);
        (uint256 a, uint256 b, uint256 liq) = router.addLiquidity(A, B, 1000 * ONE, 1000 * ONE, 0, 0, bob, deadline);
        assertEq(a, 1000 * ONE);
        assertEq(b, 1000 * ONE);
        assertEq(liq, 1000 * ONE - 1000, "LP is priced from the actual deposit");
        (ra, rb) = _res(A, B);
        assertEq(ra, 1500 * ONE);
        assertEq(rb, 1000 * ONE);
        // pool is now usable: a later proportional deposit and a swap both work
        _add(carol, A, B, 150 * ONE, 100 * ONE);
        _swapIn(carol, ONE, _path2(A, B));
    }

    function test_AddLiquidity_OneSidedDonationWithoutSyncBeforeFirstDeposit() public {
        address pairAddr = factory.createPair(A, B);
        vm.prank(alice);
        tokenB.transfer(pairAddr, 300 * ONE);
        vm.prank(bob);
        (,, uint256 liq) = router.addLiquidity(A, B, 1000 * ONE, 1000 * ONE, 0, 0, bob, deadline);
        assertGt(liq, 0);
        (uint256 ra, uint256 rb) = _res(A, B);
        assertEq(ra, 1000 * ONE);
        assertEq(rb, 1300 * ONE);
    }

    function test_RevertAddLiquidity_FirstDepositAtMinimumLiquidity() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("InsufficientLiquidity(uint256,uint256)")), 1000, 1000));
        router.addLiquidity(A, B, 1000, 1000, 0, 0, alice, deadline);
    }

    function test_FirstDepositorInflationAttackFails() public {
        // attacker seeds the smallest possible position, then donates to inflate LP price
        _add(alice, A, B, 1001, 1001);
        INairaSwapPair p = _pairOf(A, B);
        assertEq(p.totalSupply(), 1001);
        vm.startPrank(alice);
        tokenA.transfer(address(p), 1_000_000 * ONE);
        tokenB.transfer(address(p), 1_000_000 * ONE);
        vm.stopPrank();
        p.sync();
        (,, uint256 liq) = _add(bob, A, B, 1000 * ONE, 1000 * ONE);
        assertGt(liq, 0, "victim still gets LP (locked minimum keeps supply from being 1 wei)");
        (uint256 ra,) = _res(A, B);
        uint256 supply = p.totalSupply();
        uint256 victimValue = liq * ra / supply;
        uint256 attackerValue = p.balanceOf(alice) * ra / supply;
        uint256 donated = 1_000_000 * ONE;
        // economic property: the attack is unprofitable - the attacker forfeits (almost) the whole donation
        assertLt(attackerValue, donated / 100, "attacker recovers <1% of donation");
        assertGt(donated - attackerValue, 1000 * ONE - victimValue, "attacker loses far more than the victim");
    }

    // ----------------------------------------------------------- removeLiquidity

    function test_RemoveLiquidity_ReturnsProRataAndBurnsLp() public {
        _add(alice, A, B, 1000 * ONE, 2000 * ONE);
        (,, uint256 liq) = _add(bob, A, B, 100 * ONE, 200 * ONE);
        INairaSwapPair p = _pairOf(A, B);
        vm.startPrank(bob);
        p.approve(address(router), liq);
        uint256 supply = p.totalSupply();
        (uint256 ra, uint256 rb) = _res(A, B);
        (uint256 outA, uint256 outB) = router.removeLiquidity(A, B, liq, 0, 0, carol, deadline);
        vm.stopPrank();
        assertEq(outA, liq * ra / supply);
        assertEq(outB, liq * rb / supply);
        assertEq(tokenA.balanceOf(carol), FUND + outA);
        assertEq(tokenB.balanceOf(carol), FUND + outB);
        assertEq(p.balanceOf(bob), 0);
        assertEq(p.totalSupply(), supply - liq);
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
    }

    function test_RemoveLiquidity_EmitsBurn() public {
        (,, uint256 liq) = _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        INairaSwapPair p = _pairOf(A, B);
        vm.startPrank(alice);
        p.approve(address(router), liq);
        vm.expectEmit(true, true, false, false, address(p));
        emit INairaSwapPair.Burn(address(router), 0, 0, bob);
        router.removeLiquidity(A, B, liq, 0, 0, bob, deadline);
        vm.stopPrank();
    }

    function test_RevertRemoveLiquidity_BelowMinimums() public {
        (,, uint256 liq) = _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        _pairOf(A, B);
        vm.startPrank(alice);
        _pairOf(A, B).approve(address(router), liq);
        uint256 expectOut = liq * 1000 * ONE / (liq + 1000);
        vm.expectRevert(
            abi.encodeWithSelector(NairaSwapRouter.InsufficientOutputAmount.selector, expectOut, expectOut + 1)
        );
        router.removeLiquidity(A, B, liq, expectOut + 1, 0, alice, deadline);
        vm.expectRevert(
            abi.encodeWithSelector(NairaSwapRouter.InsufficientOutputAmount.selector, expectOut, expectOut + 1)
        );
        router.removeLiquidity(A, B, liq, 0, expectOut + 1, alice, deadline);
        vm.stopPrank();
    }

    function test_RevertRemoveLiquidity_ExpiredAndInvalidToAndNoAllowance() public {
        (,, uint256 liq) = _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, block.timestamp - 1, block.timestamp));
        router.removeLiquidity(A, B, liq, 0, 0, alice, block.timestamp - 1);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.removeLiquidity(A, B, liq, 0, 0, address(0), deadline);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), 0, liq)
        );
        router.removeLiquidity(A, B, liq, 0, 0, alice, deadline);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------- permit

    function _permitFixture() internal returns (address lp, uint256 pk, INairaSwapPair p, uint256 liq) {
        (lp, pk) = makeAddrAndKey("permitLp");
        tokenA.mint(lp, 1000 * ONE);
        tokenB.mint(lp, 1000 * ONE);
        vm.startPrank(lp);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        (,, liq) = router.addLiquidity(A, B, 1000 * ONE, 1000 * ONE, 0, 0, lp, deadline);
        vm.stopPrank();
        p = _pairOf(A, B);
    }

    function test_RemoveLiquidityWithPermit_Works_NoPriorApproval() public {
        (address lp, uint256 pk, INairaSwapPair p, uint256 liq) = _permitFixture();
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(p), lp, address(router), liq, deadline);
        uint256 nonceBefore = p.nonces(lp);
        vm.prank(lp);
        (uint256 outA, uint256 outB) =
            router.removeLiquidityWithPermit(A, B, liq, 0, 0, carol, deadline, v, r, s);
        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(p.balanceOf(lp), 0);
        assertEq(p.nonces(lp), nonceBefore + 1);
        assertEq(p.allowance(lp, address(router)), 0, "exact-amount permit fully consumed");
    }

    function test_RemoveLiquidityWithPermit_BadSignatureReverts() public {
        (address lp,, INairaSwapPair p, uint256 liq) = _permitFixture();
        (, uint256 wrongPk) = makeAddrAndKey("attacker");
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(wrongPk, address(p), lp, address(router), liq, deadline);
        vm.prank(lp);
        vm.expectRevert(NairaSwapRouter.Forbidden.selector);
        router.removeLiquidityWithPermit(A, B, liq, 0, 0, lp, deadline, v, r, s);
    }

    function test_RemoveLiquidityWithPermit_PermitForSmallerValueReverts() public {
        (address lp, uint256 pk, INairaSwapPair p, uint256 liq) = _permitFixture();
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(p), lp, address(router), liq - 1, deadline);
        vm.prank(lp);
        vm.expectRevert(NairaSwapRouter.Forbidden.selector);
        router.removeLiquidityWithPermit(A, B, liq, 0, 0, lp, deadline, v, r, s);
    }

    function test_RemoveLiquidityWithPermit_FrontRunPermitStillWorks() public {
        (address lp, uint256 pk, INairaSwapPair p, uint256 liq) = _permitFixture();
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(p), lp, address(router), liq, deadline);
        vm.prank(bob);
        p.permit(lp, address(router), liq, deadline, v, r, s); // griefing front-run
        vm.prank(lp);
        (uint256 outA,) = router.removeLiquidityWithPermit(A, B, liq, 0, 0, lp, deadline, v, r, s);
        assertGt(outA, 0);
    }

    function test_RevertRemoveLiquidityWithPermit_Expired() public {
        (address lp, uint256 pk, INairaSwapPair p, uint256 liq) = _permitFixture();
        uint256 dl = block.timestamp - 1;
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(p), lp, address(router), liq, dl);
        vm.prank(lp);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.Expired.selector, dl, block.timestamp));
        router.removeLiquidityWithPermit(A, B, liq, 0, 0, lp, dl, v, r, s);
    }

    function test_RevertRemoveLiquidityWithPermit_BelowMin() public {
        (address lp, uint256 pk, INairaSwapPair p, uint256 liq) = _permitFixture();
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(p), lp, address(router), liq, deadline);
        vm.prank(lp);
        vm.expectRevert();
        router.removeLiquidityWithPermit(A, B, liq, 1000 * ONE, 0, lp, deadline, v, r, s);
    }
}
