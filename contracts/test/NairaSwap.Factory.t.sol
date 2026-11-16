// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {NairaSwapTestBase} from "./NairaSwap.Base.t.sol";
import {NairaSwapFactory} from "../NairaSwapFactory.sol";
import {NairaSwapPair} from "../NairaSwapPair.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";

contract NairaSwapFactoryTest is NairaSwapTestBase {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);
    event FeeToQueued(address indexed newFeeTo, uint256 applyAt);
    event FeeToSet(address indexed newFeeTo, uint256 applyAt);
    event FeeToCanceled(address indexed canceledFeeTo, uint256 applyAt);

    address internal newFee = makeAddr("newFee");

    function _predict(address a, address b) internal view returns (address) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        bytes32 salt = keccak256(abi.encodePacked(t0, t1));
        return address(
            uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(factory), salt, factory.pairCodeHash()))))
        );
    }

    // ------------------------------------------------------------ constructor

    function test_Constructor_SetsOwnerAndFeeTo() public view {
        assertEq(factory.owner(), owner);
        assertEq(factory.feeTo(), address(treasury));
        assertEq(factory.pendingFeeToAt(), 0);
        assertEq(factory.allPairsLength(), 0);
        assertEq(factory.FEE_DELAY(), 2 days);
    }

    function test_Constructor_EmitsFeeToSet() public {
        vm.expectEmit(true, false, false, true);
        emit FeeToSet(newFee, block.timestamp);
        new NairaSwapFactory(owner, newFee);
    }

    function test_RevertConstructor_ZeroFeeTo() public {
        vm.expectRevert(NairaSwapFactory.ZeroAddress.selector);
        new NairaSwapFactory(owner, address(0));
    }

    function test_RevertConstructor_ZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new NairaSwapFactory(address(0), newFee);
    }

    function test_PairCodeHash_MatchesCreationCode() public view {
        assertEq(factory.pairCodeHash(), keccak256(type(NairaSwapPair).creationCode));
    }

    // ------------------------------------------------------------- createPair

    function test_CreatePair_AddressMatchesCreate2Prediction() public {
        address predicted = _predict(address(tokenA), address(tokenB));
        address pair = factory.createPair(address(tokenA), address(tokenB));
        assertEq(pair, predicted);
        assertGt(pair.code.length, 0);
    }

    function test_CreatePair_ReversedOrderGivesSamePrediction() public {
        address predicted = _predict(address(tokenB), address(tokenA));
        address pair = factory.createPair(address(tokenB), address(tokenA));
        assertEq(pair, predicted);
    }

    function test_CreatePair_RegistersBothDirectionsAndInitializes() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair);
        assertEq(factory.allPairs(0), pair);
        assertEq(factory.allPairsLength(), 1);
        (address t0, address t1) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));
        assertEq(INairaSwapPair(pair).token0(), t0);
        assertEq(INairaSwapPair(pair).token1(), t1);
        assertEq(INairaSwapPair(pair).factory(), address(factory));
    }

    function test_CreatePair_EmitsPairCreated() public {
        address predicted = _predict(address(tokenA), address(tokenB));
        (address t0, address t1) =
            address(tokenA) < address(tokenB) ? (address(tokenA), address(tokenB)) : (address(tokenB), address(tokenA));
        vm.expectEmit(true, true, false, true, address(factory));
        emit PairCreated(t0, t1, predicted, 1);
        factory.createPair(address(tokenA), address(tokenB));
    }

    function test_CreatePair_IsPermissionless() public {
        vm.prank(carol);
        address pair = factory.createPair(address(tokenA), address(tokenC));
        assertGt(pair.code.length, 0);
    }

    function test_RevertCreatePair_Duplicate() public {
        factory.createPair(address(tokenA), address(tokenB));
        vm.expectRevert(NairaSwapFactory.PairExists.selector);
        factory.createPair(address(tokenA), address(tokenB));
        vm.expectRevert(NairaSwapFactory.PairExists.selector);
        factory.createPair(address(tokenB), address(tokenA));
    }

    function test_RevertCreatePair_Identical() public {
        vm.expectRevert(NairaSwapFactory.IdenticalAddresses.selector);
        factory.createPair(address(tokenA), address(tokenA));
    }

    function test_RevertCreatePair_ZeroToken() public {
        vm.expectRevert(NairaSwapFactory.ZeroAddress.selector);
        factory.createPair(address(0), address(tokenA));
        vm.expectRevert(NairaSwapFactory.ZeroAddress.selector);
        factory.createPair(address(tokenA), address(0));
    }

    function test_RevertCreatePair_BothZeroIsIdentical() public {
        vm.expectRevert(NairaSwapFactory.IdenticalAddresses.selector);
        factory.createPair(address(0), address(0));
    }

    // ----------------------------------------------------------- feeTo delay

    function test_QueueFeeTo_StoresPendingAndEmits() public {
        uint256 at = block.timestamp + 2 days;
        vm.expectEmit(true, false, false, true, address(factory));
        emit FeeToQueued(newFee, at);
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        assertEq(factory.pendingFeeTo(), newFee);
        assertEq(factory.pendingFeeToAt(), at);
        assertEq(factory.feeTo(), address(treasury), "feeTo unchanged until applied");
    }

    function test_RevertQueueFeeTo_NonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.queueFeeTo(newFee);
    }

    function test_RevertQueueFeeTo_Zero() public {
        vm.prank(owner);
        vm.expectRevert(NairaSwapFactory.ZeroAddress.selector);
        factory.queueFeeTo(address(0));
    }

    function test_RevertApplyFeeTo_NothingQueued() public {
        vm.expectRevert(NairaSwapFactory.NothingQueued.selector);
        factory.applyFeeTo();
    }

    function test_RevertApplyFeeTo_Early() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        uint256 at = factory.pendingFeeToAt();
        vm.expectRevert(abi.encodeWithSelector(NairaSwapFactory.DelayNotElapsed.selector, at, block.timestamp));
        factory.applyFeeTo();
        vm.warp(at - 1);
        vm.expectRevert(abi.encodeWithSelector(NairaSwapFactory.DelayNotElapsed.selector, at, at - 1));
        factory.applyFeeTo();
    }

    function test_ApplyFeeTo_AfterTwoDays_AnyoneCanApply() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        uint256 at = factory.pendingFeeToAt();
        skip(2 days);
        vm.expectEmit(true, false, false, true, address(factory));
        emit FeeToSet(newFee, at);
        vm.prank(carol);
        factory.applyFeeTo();
        assertEq(factory.feeTo(), newFee);
        assertEq(factory.pendingFeeTo(), address(0));
        assertEq(factory.pendingFeeToAt(), 0);
    }

    function test_RevertApplyFeeTo_Twice() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        skip(2 days);
        factory.applyFeeTo();
        vm.expectRevert(NairaSwapFactory.NothingQueued.selector);
        factory.applyFeeTo();
    }

    function test_QueueFeeTo_ReplacingRestartsDelay() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        skip(1 days);
        address other = makeAddr("other");
        vm.prank(owner);
        factory.queueFeeTo(other);
        skip(1 days + 1);
        vm.expectRevert();
        factory.applyFeeTo();
        skip(1 days);
        factory.applyFeeTo();
        assertEq(factory.feeTo(), other);
    }

    function test_CancelFeeTo_ClearsQueueAndEmits() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        uint256 at = factory.pendingFeeToAt();
        vm.expectEmit(true, false, false, true, address(factory));
        emit FeeToCanceled(newFee, at);
        vm.prank(owner);
        factory.cancelFeeTo();
        assertEq(factory.pendingFeeTo(), address(0));
        assertEq(factory.pendingFeeToAt(), 0);
        skip(3 days);
        vm.expectRevert(NairaSwapFactory.NothingQueued.selector);
        factory.applyFeeTo();
        assertEq(factory.feeTo(), address(treasury));
    }

    function test_RevertCancelFeeTo_NonOwner() public {
        vm.prank(owner);
        factory.queueFeeTo(newFee);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        factory.cancelFeeTo();
    }

    function test_RevertCancelFeeTo_NothingQueued() public {
        vm.prank(owner);
        vm.expectRevert(NairaSwapFactory.NothingQueued.selector);
        factory.cancelFeeTo();
    }

    // -------------------------------------------------------------- ownership

    function test_Factory_TwoStepOwnershipAndNoRenounce() public {
        _ownershipSuite(address(factory), NairaSwapFactory.ZeroAddress.selector, NairaSwapFactory.RenounceDisabled.selector);
    }
}
