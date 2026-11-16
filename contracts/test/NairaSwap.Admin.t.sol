// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapRouter} from "../NairaSwapRouter.sol";
import {NairaSwapTreasury} from "../NairaSwapTreasury.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";
import {HookERC20} from "../test-helpers/NairaSwapMocks.sol";

contract NairaSwapAdminTest is NairaSwapTestBase {
    event PauserSet(address indexed account);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event PayoutQueued(address indexed newPayout, uint256 applyAt);
    event PayoutSet(address indexed newPayout, uint256 applyAt);
    event PayoutCanceled(address indexed canceledPayout, uint256 applyAt);
    event Redeemed(address indexed pair, uint256 liquidity, address indexed to);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);

    address internal A;
    address internal B;

    function setUp() public override {
        super.setUp();
        A = address(tokenA);
        B = address(tokenB);
    }

    function _unauth(address who) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, who);
    }

    // ------------------------------------------------------------- router ctor

    function test_RouterConstructor_SetsState() public {
        vm.expectEmit(true, false, false, false);
        emit PauserSet(owner);
        NairaSwapRouter r = new NairaSwapRouter(address(factory), owner);
        assertEq(r.factory(), address(factory));
        assertEq(r.owner(), owner);
        assertEq(r.pauser(), owner);
        assertFalse(r.paused());
        assertEq(r.MAX_PATH(), 4);
    }

    function test_RevertRouterConstructor_BadFactory() public {
        vm.expectRevert(NairaSwapRouter.ZeroAddress.selector);
        new NairaSwapRouter(address(0), owner);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InvalidFactory.selector, alice));
        new NairaSwapRouter(alice, owner);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapRouter.InvalidFactory.selector, A));
        new NairaSwapRouter(A, owner); // contract without pairCodeHash()
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new NairaSwapRouter(address(factory), address(0));
    }

    // ----------------------------------------------------------- router pause

    function test_Pause_ByPauserAndByOwner() public {
        vm.expectEmit(false, false, false, true, address(router));
        emit Pausable.Paused(pauser);
        vm.prank(pauser);
        router.pause();
        assertTrue(router.paused());
        vm.prank(owner);
        router.unpause();
        vm.prank(owner);
        router.pause();
        assertTrue(router.paused());
    }

    function test_RevertPause_Stranger() public {
        vm.prank(alice);
        vm.expectRevert(NairaSwapRouter.Forbidden.selector);
        router.pause();
    }

    function test_Unpause_OnlyOwner_EmitsEvent() public {
        vm.prank(pauser);
        router.pause();
        vm.prank(pauser);
        vm.expectRevert(_unauth(pauser));
        router.unpause();
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        router.unpause();
        vm.expectEmit(false, false, false, true, address(router));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        router.unpause();
        assertFalse(router.paused());
    }

    function test_RevertPauseState_Misuse() public {
        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        router.unpause();
        vm.prank(owner);
        router.pause();
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.pause();
    }

    function test_SetPauser_OnlyOwner_ZeroReverts_EmitsAndReplaces() public {
        address newPauser = makeAddr("newPauser");
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        router.setPauser(newPauser);
        vm.prank(pauser);
        vm.expectRevert(_unauth(pauser));
        router.setPauser(newPauser);
        vm.prank(owner);
        vm.expectRevert(NairaSwapRouter.ZeroAddress.selector);
        router.setPauser(address(0));
        vm.expectEmit(true, false, false, false, address(router));
        emit PauserSet(newPauser);
        vm.prank(owner);
        router.setPauser(newPauser);
        assertEq(router.pauser(), newPauser);
        vm.prank(pauser); // replaced pauser lost the power
        vm.expectRevert(NairaSwapRouter.Forbidden.selector);
        router.pause();
        vm.prank(newPauser);
        router.pause();
    }

    function test_Paused_BlocksAddAndAllSwaps() public {
        _seedAB();
        vm.prank(pauser);
        router.pause();
        vm.startPrank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.addLiquidity(A, B, ONE, ONE, 0, 0, bob, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.swapExactTokensForTokens(ONE, 0, _path2(A, B), bob, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.swapTokensForExactTokens(ONE, type(uint256).max, _path2(A, B), bob, deadline);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        router.swapExactTokensForTokensSupportingFeeOnTransferTokens(ONE, 0, _path2(A, B), bob, deadline);
        vm.stopPrank();
    }

    function test_Paused_RemoveLiquidityStillWorks() public {
        (,, uint256 liq) = _add(alice, A, B, 1000 * ONE, 1000 * ONE);
        vm.prank(pauser);
        router.pause();
        vm.startPrank(alice);
        _pairOf(A, B).approve(address(router), liq);
        (uint256 a, uint256 b) = router.removeLiquidity(A, B, liq, 0, 0, alice, deadline);
        vm.stopPrank();
        assertGt(a, 0);
        assertGt(b, 0);
    }

    function test_Paused_RemoveLiquidityWithPermitStillWorks() public {
        (address lp, uint256 pk) = makeAddrAndKey("pauseLp");
        tokenA.mint(lp, 1000 * ONE);
        tokenB.mint(lp, 1000 * ONE);
        vm.startPrank(lp);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        (,, uint256 liq) = router.addLiquidity(A, B, 1000 * ONE, 1000 * ONE, 0, 0, lp, deadline);
        vm.stopPrank();
        vm.prank(owner);
        router.pause();
        (uint8 v, bytes32 r, bytes32 s) = _permitSig(pk, address(_pairOf(A, B)), lp, address(router), liq, deadline);
        vm.prank(lp);
        (uint256 a,) = router.removeLiquidityWithPermit(A, B, liq, 0, 0, lp, deadline, v, r, s);
        assertGt(a, 0);
    }

    function test_Unpause_RestoresSwapsAndAdds() public {
        _seedAB();
        vm.prank(owner);
        router.pause();
        vm.prank(owner);
        router.unpause();
        _swapIn(bob, ONE, _path2(A, B));
        _add(bob, A, B, ONE, ONE);
    }

    // ------------------------------------------------------------ router rescue

    function test_RescueTokens_OwnerOnly_MovesStrayTokens() public {
        vm.prank(alice);
        tokenC.transfer(address(router), 50 * ONE);
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        router.rescueTokens(C(), alice, 50 * ONE);
        vm.prank(pauser);
        vm.expectRevert(_unauth(pauser));
        router.rescueTokens(C(), pauser, 50 * ONE);

        vm.expectEmit(true, true, false, true, address(router));
        emit TokensRescued(C(), carol, 50 * ONE);
        vm.prank(owner);
        router.rescueTokens(C(), carol, 50 * ONE);
        assertEq(tokenC.balanceOf(carol), FUND + 50 * ONE);
        assertEq(tokenC.balanceOf(address(router)), 0);
    }

    function test_RevertRescueTokens_BadArgs() public {
        vm.startPrank(owner);
        vm.expectRevert(NairaSwapRouter.ZeroAddress.selector);
        router.rescueTokens(address(0), carol, 1);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.rescueTokens(C(), address(0), 1);
        vm.expectRevert(NairaSwapRouter.InvalidTo.selector);
        router.rescueTokens(C(), address(router), 1);
        vm.expectRevert();
        router.rescueTokens(C(), carol, 1); // router holds nothing
        vm.stopPrank();
    }

    function C() internal view returns (address) {
        return address(tokenC);
    }

    function test_Router_ReentrancyFromTokenBlocked() public {
        HookERC20 h = new HookERC20("Hook", "HK");
        h.mint(alice, 1e30);
        vm.prank(alice);
        h.approve(address(router), type(uint256).max);
        h.arm(address(router), abi.encodeCall(NairaSwapRouter.pause, ()));
        vm.prank(alice);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.addLiquidity(address(h), A, 100 * ONE, 100 * ONE, 0, 0, alice, deadline);
    }

    function test_Router_TwoStepOwnershipAndNoRenounce() public {
        _ownershipSuite(address(router), NairaSwapRouter.ZeroAddress.selector, NairaSwapRouter.RenounceDisabled.selector);
    }

    // ---------------------------------------------------------- treasury basics

    function test_TreasuryConstructor() public {
        vm.expectEmit(true, false, false, true);
        emit PayoutSet(payoutAddr, block.timestamp);
        NairaSwapTreasury t = new NairaSwapTreasury(owner, payoutAddr);
        assertEq(t.owner(), owner);
        assertEq(t.payout(), payoutAddr);
        assertEq(t.PAYOUT_DELAY(), 2 days);
        vm.expectRevert(NairaSwapTreasury.ZeroAddress.selector);
        new NairaSwapTreasury(owner, address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new NairaSwapTreasury(address(0), payoutAddr);
    }

    function test_Treasury_TwoStepOwnershipAndNoRenounce() public {
        _ownershipSuite(address(treasury), NairaSwapTreasury.ZeroAddress.selector, NairaSwapTreasury.RenounceDisabled.selector);
    }

    // ------------------------------------------------------- treasury payout delay

    function test_QueuePayout_OwnerOnly_StoresAndEmits() public {
        address np = makeAddr("newPayout");
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        treasury.queuePayout(np);
        vm.prank(owner);
        vm.expectRevert(NairaSwapTreasury.ZeroAddress.selector);
        treasury.queuePayout(address(0));
        vm.expectEmit(true, false, false, true, address(treasury));
        emit PayoutQueued(np, block.timestamp + 2 days);
        vm.prank(owner);
        treasury.queuePayout(np);
        assertEq(treasury.pendingPayout(), np);
        assertEq(treasury.pendingPayoutAt(), block.timestamp + 2 days);
        assertEq(treasury.payout(), payoutAddr);
    }

    function test_ApplyPayout_EarlyRevertsThenAppliesAfterDelayOnlyOnce() public {
        address np = makeAddr("newPayout");
        vm.expectRevert(NairaSwapTreasury.NothingQueued.selector);
        treasury.applyPayout();
        vm.prank(owner);
        treasury.queuePayout(np);
        uint256 at = treasury.pendingPayoutAt();
        vm.expectRevert(abi.encodeWithSelector(NairaSwapTreasury.DelayNotElapsed.selector, at, block.timestamp));
        treasury.applyPayout();
        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapTreasury.DelayNotElapsed.selector, at, at - 1));
        treasury.applyPayout();
        vm.warp(at);
        vm.expectEmit(true, false, false, true, address(treasury));
        emit PayoutSet(np, at);
        vm.prank(carol);
        treasury.applyPayout();
        assertEq(treasury.payout(), np);
        assertEq(treasury.pendingPayoutAt(), 0);
        assertEq(treasury.pendingPayout(), address(0));
        vm.expectRevert(NairaSwapTreasury.NothingQueued.selector);
        treasury.applyPayout();
    }

    function test_QueuePayout_ReplacingRestartsDelay() public {
        vm.prank(owner);
        treasury.queuePayout(makeAddr("p1"));
        skip(1 days);
        address p2 = makeAddr("p2");
        vm.prank(owner);
        treasury.queuePayout(p2);
        skip(1 days + 1);
        vm.expectRevert();
        treasury.applyPayout();
        skip(1 days);
        treasury.applyPayout();
        assertEq(treasury.payout(), p2);
    }

    function test_CancelPayout() public {
        address np = makeAddr("newPayout");
        vm.prank(owner);
        vm.expectRevert(NairaSwapTreasury.NothingQueued.selector);
        treasury.cancelPayout();
        vm.prank(owner);
        treasury.queuePayout(np);
        uint256 at = treasury.pendingPayoutAt();
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        treasury.cancelPayout();
        vm.expectEmit(true, false, false, true, address(treasury));
        emit PayoutCanceled(np, at);
        vm.prank(owner);
        treasury.cancelPayout();
        assertEq(treasury.pendingPayoutAt(), 0);
        skip(3 days);
        vm.expectRevert(NairaSwapTreasury.NothingQueued.selector);
        treasury.applyPayout();
        assertEq(treasury.payout(), payoutAddr);
    }

    // ------------------------------------------------- treasury redeem / withdraw

    function _accrueFee() internal returns (INairaSwapPair p, uint256 feeLp, uint256 volume) {
        _add(alice, A, B, 1_000_000 * ONE, 1_000_000 * ONE);
        for (uint256 i; i < 10; i++) {
            _swapIn(bob, 5_000 * ONE, _path2(A, B));
            _swapIn(bob, 5_000 * ONE, _path2(B, A));
            volume += 10_000 * ONE;
        }
        _add(carol, A, B, 1_000 * ONE, 1_000 * ONE);
        p = _pairOf(A, B);
        feeLp = p.balanceOf(address(treasury));
    }

    function test_Redeem_BurnsTreasuryLpAndKeepsTokensInTreasury() public {
        (INairaSwapPair p, uint256 feeLp, uint256 volume) = _accrueFee();
        assertGt(feeLp, 0);
        uint256 supply = p.totalSupply();
        (uint256 ra, uint256 rb) = _res(A, B);
        vm.expectEmit(true, true, false, true, address(treasury));
        emit Redeemed(address(p), feeLp, address(treasury));
        vm.prank(owner);
        treasury.redeem(address(p), feeLp);
        assertEq(p.balanceOf(address(treasury)), 0);
        uint256 gotA = tokenA.balanceOf(address(treasury));
        uint256 gotB = tokenB.balanceOf(address(treasury));
        assertEq(gotA, feeLp * ra / supply);
        assertEq(gotB, feeLp * rb / supply);
        // protocol fee ~ 0.05% of volume (tolerance 5%)
        assertApproxEqRel(gotA + gotB, volume * 5 / 10_000, 5e16);
        assertEq(tokenA.balanceOf(payoutAddr), 0, "nothing reaches payout until withdraw");
    }

    function test_Redeem_PartialAndReverts() public {
        (INairaSwapPair p, uint256 feeLp,) = _accrueFee();
        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        treasury.redeem(address(p), feeLp);
        vm.startPrank(owner);
        vm.expectRevert(NairaSwapTreasury.ZeroAddress.selector);
        treasury.redeem(address(0), feeLp);
        vm.expectRevert(NairaSwapTreasury.InsufficientLiquidity.selector);
        treasury.redeem(address(p), 0);
        vm.expectRevert(); // more LP than the treasury holds
        treasury.redeem(address(p), feeLp + 1);
        treasury.redeem(address(p), feeLp / 2);
        vm.stopPrank();
        assertEq(p.balanceOf(address(treasury)), feeLp - feeLp / 2);
    }

    function test_Withdraw_OnlyOwner_OnlyToPayout() public {
        (INairaSwapPair p, uint256 feeLp,) = _accrueFee();
        vm.prank(owner);
        treasury.redeem(address(p), feeLp);
        uint256 bal = tokenA.balanceOf(address(treasury));

        vm.prank(alice);
        vm.expectRevert(_unauth(alice));
        treasury.withdraw(A, bal);

        vm.expectEmit(true, true, false, true, address(treasury));
        emit Withdrawn(A, bal, payoutAddr);
        vm.prank(owner);
        treasury.withdraw(A, bal);
        assertEq(tokenA.balanceOf(payoutAddr), bal);
        assertEq(tokenA.balanceOf(address(treasury)), 0);
        assertEq(tokenA.balanceOf(owner), 0, "owner never receives funds directly");
    }

    function test_Withdraw_FollowsPayoutOnlyAfterDelay() public {
        tokenC.mint(address(treasury), 100 * ONE);
        address np = makeAddr("newPayout");
        vm.prank(owner);
        treasury.queuePayout(np);
        vm.prank(owner);
        treasury.withdraw(C(), 40 * ONE);
        assertEq(tokenC.balanceOf(payoutAddr), 40 * ONE, "old payout until applied");
        skip(2 days);
        treasury.applyPayout();
        vm.prank(owner);
        treasury.withdraw(C(), 60 * ONE);
        assertEq(tokenC.balanceOf(np), 60 * ONE);
    }

    function test_RevertWithdraw_ZeroTokenAndOverdraw() public {
        vm.startPrank(owner);
        vm.expectRevert(NairaSwapTreasury.ZeroAddress.selector);
        treasury.withdraw(address(0), 1);
        vm.expectRevert();
        treasury.withdraw(C(), 1);
        vm.stopPrank();
    }

    function test_Treasury_ReentrancyFromTokenBlocked() public {
        HookERC20 h = new HookERC20("Hook", "HK");
        h.mint(address(treasury), 100 * ONE);
        h.arm(address(treasury), abi.encodeCall(NairaSwapTreasury.applyPayout, ()));
        vm.prank(owner);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        treasury.withdraw(address(h), 10 * ONE);
    }
}
