// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Create2Factory} from "../script/Create2Factory.sol";

/// @dev Tiny target whose constructor records who deployed it (the factory) and an owner argument.
contract Target {
    address public immutable owner;
    address public immutable deployer;

    constructor(address owner_) payable {
        owner = owner_;
        deployer = msg.sender;
    }
}

contract Create2FactoryTest is Test {
    Create2Factory factory;
    address alice = makeAddr("alice");
    address mallory = makeAddr("mallory");
    bytes32 constant SALT = keccak256("nairabridge-test");

    function setUp() public {
        factory = new Create2Factory();
    }

    function _code(address owner_) internal pure returns (bytes memory) {
        return abi.encodePacked(type(Target).creationCode, abi.encode(owner_));
    }

    function test_deployMatchesPrediction() public {
        bytes memory code = _code(alice);
        address predicted = factory.computeAddress(alice, SALT, keccak256(code));
        vm.prank(alice);
        address deployed = factory.deploy(SALT, code);
        assertEq(deployed, predicted);
        assertEq(Target(deployed).owner(), alice);
        assertEq(Target(deployed).deployer(), address(factory));
    }

    function test_saltIsNamespacedByCaller() public {
        bytes memory code = _code(alice);
        vm.prank(alice);
        address a = factory.deploy(SALT, code);
        // The same salt and bytecode from another account lands somewhere else: nobody can claim or block Alice's address.
        vm.prank(mallory);
        address m = factory.deploy(SALT, code);
        assertTrue(a != m);
        assertEq(m, factory.computeAddress(mallory, SALT, keccak256(code)));
    }

    function test_frontRunningCannotOccupyTheVictimsAddress() public {
        bytes memory code = _code(alice);
        address victimAddress = factory.computeAddress(alice, SALT, keccak256(code));
        // Mallory copies Alice's pending transaction exactly.
        vm.prank(mallory);
        address attackerAddress = factory.deploy(SALT, code);
        assertTrue(attackerAddress != victimAddress);
        assertEq(victimAddress.code.length, 0);
        // Alice's own deployment still succeeds at her predicted address.
        vm.prank(alice);
        assertEq(factory.deploy(SALT, code), victimAddress);
    }

    function test_deployingTwiceFromTheSameAccountReverts() public {
        bytes memory code = _code(alice);
        vm.startPrank(alice);
        factory.deploy(SALT, code);
        vm.expectRevert();
        factory.deploy(SALT, code);
        vm.stopPrank();
    }

    function test_differentSaltsGiveDifferentAddresses() public {
        bytes memory code = _code(alice);
        vm.startPrank(alice);
        address one = factory.deploy(SALT, code);
        address two = factory.deploy(keccak256("other"), code);
        vm.stopPrank();
        assertTrue(one != two);
    }

    function test_forwardsValueToTheConstructor() public {
        bytes memory code = _code(alice);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        address deployed = factory.deploy{value: 0.25 ether}(SALT, code);
        assertEq(deployed.balance, 0.25 ether);
    }

    function test_emitsDeployedWithTheCaller() public {
        bytes memory code = _code(alice);
        address predicted = factory.computeAddress(alice, SALT, keccak256(code));
        vm.expectEmit(true, true, true, true, address(factory));
        emit Create2Factory.Deployed(predicted, alice, SALT);
        vm.prank(alice);
        factory.deploy(SALT, code);
    }
}
