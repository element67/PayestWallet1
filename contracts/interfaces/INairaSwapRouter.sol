// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Token-only V2 routing with bounded paths and pause-independent liquidity exits.
interface INairaSwapRouter {
    event Paused(address account);
    event Unpaused(address account);
    event PauserSet(address indexed account);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    /// @notice Immutable pool factory.
    function factory() external view returns (address);
    /// @notice Whether swaps and adds are paused.
    function paused() external view returns (bool);
    /// @notice Account permitted to pause, but not unpause.
    function pauser() external view returns (address);
    /// @notice Maximum number of swap hops (four).
    function MAX_PATH() external view returns (uint256);
    /// @notice Add optimally proportioned liquidity before deadline; minima bound actual deposits.
    function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
    /// @notice Remove liquidity before deadline, enforcing recipient balance-delta minima even while paused.
    function removeLiquidity(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) external returns (uint256 amountA, uint256 amountB);
    /// @notice Remove using an exact-liquidity ERC-2612 permit (no unlimited-approval flag).
    function removeLiquidityWithPermit(address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external returns (uint256 amountA, uint256 amountB);
    /// @notice Swap an exact input for at least amountOutMin before deadline.
    function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
    /// @notice Obtain an exact output spending at most amountInMax before deadline.
    function swapTokensForExactTokens(uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts);
    /// @notice Swap exact input with per-hop balance accounting and recipient-delta minimum output.
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
    /// @notice Quote a proportional reserve amount without fees.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256);
    /// @notice Quote output after the 0.30% fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256);
    /// @notice Quote required input, rounded upward, including the fee.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256);
    /// @notice Quote every hop's amount for a fixed input.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory);
    /// @notice Quote every hop's amount for a fixed output.
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory);
    /// @notice Set a nonzero emergency pauser; owner only.
    function setPauser(address newPauser) external;
    /// @notice Pause swaps and adds; callable by owner or pauser.
    function pause() external;
    /// @notice Unpause swaps and adds; owner only.
    function unpause() external;
    /// @notice Recover accidentally transferred tokens; owner only.
    function rescueTokens(address token, address to, uint256 amount) external;
    /// @notice Current two-step owner.
    function owner() external view returns (address);
    /// @notice Proposed two-step owner.
    function pendingOwner() external view returns (address);
    /// @notice Propose a nonzero new owner.
    function transferOwnership(address newOwner) external;
    /// @notice Accept ownership as the pending owner.
    function acceptOwnership() external;
    /// @notice Always reverts: ownership cannot be renounced.
    function renounceOwnership() external;
}
