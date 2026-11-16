// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";

/// @notice Minimal, reusable CREATE2 factory. Deploys arbitrary bytecode at a deterministic address derived from
/// this factory + the caller + a salt + the bytecode. Not tied to any specific target contract.
/// @dev The salt is namespaced by `msg.sender` on-chain: the effective salt is keccak256(msg.sender, salt). Nobody
/// can replay someone else's pending deployment from their own address to claim, grief or front-run that address:
/// the same (salt, bytecode) from a different sender lands at a different address.
contract Create2Factory {
    event Deployed(address indexed deployedAddress, address indexed deployer, bytes32 indexed salt);

    /// @notice Deploys `bytecode` via CREATE2 at the address determined by (msg.sender, `salt`, bytecode).
    /// @dev Payable so the deployed contract's constructor can receive an initial balance.
    function deploy(bytes32 salt, bytes memory bytecode) external payable returns (address deployedAddress) {
        deployedAddress = Create2.deploy(msg.value, _effectiveSalt(msg.sender, salt), bytecode);
        emit Deployed(deployedAddress, msg.sender, salt);
    }

    /// @notice Predicts the address `deploy` produces when `deployer` calls it with `salt` and a bytecode hash.
    function computeAddress(address deployer, bytes32 salt, bytes32 bytecodeHash) external view returns (address) {
        return Create2.computeAddress(_effectiveSalt(deployer, salt), bytecodeHash);
    }

    function _effectiveSalt(address deployer, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encodePacked(deployer, salt));
    }
}
