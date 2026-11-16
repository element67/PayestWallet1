// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {NairaSwapPair} from "./NairaSwapPair.sol";

/// @notice Permissionless CREATE2 pair factory with delayed fee-recipient changes.
contract NairaSwapFactory is Ownable2Step {
    /// @notice Minimum fee-recipient change delay.
    uint256 public constant FEE_DELAY = 2 days;
    /// @notice Recipient of protocol-fee LP tokens.
    address public feeTo;
    /// @notice Queued recipient, or zero if nothing is queued.
    address public pendingFeeTo;
    /// @notice Earliest application timestamp, or zero if nothing is queued.
    uint256 public pendingFeeToAt;
    /// @notice Pair registry, populated in both token directions.
    mapping(address => mapping(address => address)) public getPair;
    /// @notice All deployed pairs in creation order.
    address[] public allPairs;

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error NothingQueued();
    error DelayNotElapsed(uint256 applyAt, uint256 currentTimestamp);
    error RenounceDisabled();

    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);
    event FeeToQueued(address indexed newFeeTo, uint256 applyAt);
    event FeeToSet(address indexed newFeeTo, uint256 applyAt);
    event FeeToCanceled(address indexed canceledFeeTo, uint256 applyAt);

    /// @notice Set the nonzero initial owner and fee recipient without an initial delay.
    constructor(address initialOwner, address initialFeeTo) Ownable(initialOwner) {
        if (initialFeeTo == address(0)) revert ZeroAddress();
        feeTo = initialFeeTo;
        emit FeeToSet(initialFeeTo, block.timestamp);
    }

    /// @notice Number of pairs created by this factory.
    function allPairsLength() external view returns (uint256) {
        return allPairs.length;
    }

    /// @notice Initialization-code hash used for deterministic pair address calculation.
    function pairCodeHash() external pure returns (bytes32) {
        return keccak256(type(NairaSwapPair).creationCode);
    }

    /// @notice Create a pair for distinct nonzero tokens, sorted by address; rejects duplicates.
    function createPair(address tokenA, address tokenB) external returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        NairaSwapPair deployed = new NairaSwapPair{salt: salt}();
        pair = address(deployed);
        // Initialization has no external token calls, so registration cannot be reentered.
        deployed.initialize(token0, token1);
        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair;
        allPairs.push(pair);
        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    /// @notice Queue a nonzero fee recipient; replacing a queue restarts the full delay.
    function queueFeeTo(address newFeeTo) external onlyOwner {
        if (newFeeTo == address(0)) revert ZeroAddress();
        pendingFeeTo = newFeeTo;
        pendingFeeToAt = block.timestamp + FEE_DELAY;
        emit FeeToQueued(newFeeTo, pendingFeeToAt);
    }

    /// @notice Anyone may apply the queued fee recipient once the full delay has elapsed.
    function applyFeeTo() external {
        uint256 applyAt = pendingFeeToAt;
        if (applyAt == 0) revert NothingQueued();
        if (block.timestamp < applyAt) revert DelayNotElapsed(applyAt, block.timestamp);
        address recipient = pendingFeeTo;
        delete pendingFeeTo;
        delete pendingFeeToAt;
        feeTo = recipient;
        emit FeeToSet(recipient, applyAt);
    }

    /// @notice Cancel a pending fee-recipient change; owner only.
    function cancelFeeTo() external onlyOwner {
        uint256 applyAt = pendingFeeToAt;
        if (applyAt == 0) revert NothingQueued();
        address recipient = pendingFeeTo;
        delete pendingFeeTo;
        delete pendingFeeToAt;
        emit FeeToCanceled(recipient, applyAt);
    }

    /// @notice Propose a nonzero new owner using two-step acceptance.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice Always reverts; factory ownership may never be renounced.
    function renounceOwnership() public override onlyOwner {
        revert RenounceDisabled();
    }
}
