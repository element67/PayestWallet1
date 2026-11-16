// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Deterministic pool registry and delayed protocol-fee administration.
interface INairaSwapFactory {
    event PairCreated(address indexed token0, address indexed token1, address pair, uint256 index);
    event FeeToQueued(address indexed newFeeTo, uint256 applyAt);
    event FeeToSet(address indexed newFeeTo, uint256 applyAt);
    event FeeToCanceled(address indexed canceledFeeTo, uint256 applyAt);

    /// @notice Current protocol-fee recipient.
    function feeTo() external view returns (address);
    /// @notice Queued protocol-fee recipient.
    function pendingFeeTo() external view returns (address);
    /// @notice Earliest application time, or zero when nothing is queued.
    function pendingFeeToAt() external view returns (uint256);
    /// @notice Fee-recipient timelock duration.
    function FEE_DELAY() external view returns (uint256);
    /// @notice Pair for either ordering of two tokens, or zero.
    function getPair(address tokenA, address tokenB) external view returns (address);
    /// @notice Pair at a zero-based registry index.
    function allPairs(uint256 index) external view returns (address);
    /// @notice Number of pairs created.
    function allPairsLength() external view returns (uint256);
    /// @notice CREATE2 initialization-code hash used by this factory.
    function pairCodeHash() external view returns (bytes32);
    /// @notice Permissionlessly deploy and register a new sorted pair.
    function createPair(address tokenA, address tokenB) external returns (address pair);
    /// @notice Queue a nonzero fee recipient; owner only, resets the full delay.
    function queueFeeTo(address newFeeTo) external;
    /// @notice Permissionlessly apply a queued fee recipient after the delay.
    function applyFeeTo() external;
    /// @notice Cancel the queued fee recipient; owner only.
    function cancelFeeTo() external;
    /// @notice Current two-step owner.
    function owner() external view returns (address);
    /// @notice Proposed two-step owner.
    function pendingOwner() external view returns (address);
    /// @notice Propose a nonzero new owner; current owner only.
    function transferOwnership(address newOwner) external;
    /// @notice Accept ownership as the pending owner.
    function acceptOwnership() external;
    /// @notice Always reverts: ownership cannot be renounced.
    function renounceOwnership() external;
}
