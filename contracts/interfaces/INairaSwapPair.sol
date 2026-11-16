// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";

/// @notice Constant-product pool and ERC-2612 liquidity token.
interface INairaSwapPair is IERC20Metadata, IERC20Permit {
    event Initialized(address indexed token0, address indexed token1);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);
    event Skim(address indexed to, uint256 amount0, uint256 amount1);

    /// @notice Permanently locked minimum LP supply.
    function MINIMUM_LIQUIDITY() external view returns (uint256);
    /// @notice Factory that deployed this pair.
    function factory() external view returns (address);
    /// @notice Lower-address underlying token.
    function token0() external view returns (address);
    /// @notice Higher-address underlying token.
    function token1() external view returns (address);
    /// @notice Stored balances and the last update's modulo-2**32 timestamp.
    function getReserves() external view returns (uint112, uint112, uint32);
    /// @notice Cumulative UQ112x112 token1/token0 price, modulo 2**256.
    function price0CumulativeLast() external view returns (uint256);
    /// @notice Cumulative UQ112x112 token0/token1 price, modulo 2**256.
    function price1CumulativeLast() external view returns (uint256);
    /// @notice Reserve product at the last fee-enabled liquidity event.
    function kLast() external view returns (uint256);
    /// @notice Initialize sorted nonzero tokens; factory only, once.
    function initialize(address token0_, address token1_) external;
    /// @notice Mint LP against underlying tokens already transferred to the pair.
    function mint(address to) external returns (uint256 liquidity);
    /// @notice Burn LP already transferred to the pair and deliver underlying tokens.
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    /// @notice Swap prepaid input for outputs; data must be empty (no callback).
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    /// @notice Transfer balances above reserves to the recipient.
    function skim(address to) external;
    /// @notice Update stored reserves to actual token balances.
    function sync() external;
}
