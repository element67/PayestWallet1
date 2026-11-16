// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {INairaSwapFactory} from "../interfaces/INairaSwapFactory.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";

/// @notice Deterministic pair addressing and fee-inclusive V2 pricing.
library NairaSwapLibrary {
    uint256 internal constant MAX_PATH = 4; // Hops; at most five token addresses.

    error IdenticalAddresses();
    error ZeroAddress();
    error InvalidPath();
    error InsufficientLiquidity();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();

    function sortTokens(address tokenA, address tokenB) internal pure returns (address token0, address token1) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    function pairFor(address factory, address tokenA, address tokenB) internal view returns (address pair) {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        bytes32 hash = keccak256(abi.encodePacked(
            hex"ff", factory, keccak256(abi.encodePacked(token0, token1)),
            INairaSwapFactory(factory).pairCodeHash()
        ));
        pair = address(uint160(uint256(hash)));
    }

    function getReserves(address factory, address tokenA, address tokenB)
        internal view returns (uint256 reserveA, uint256 reserveB)
    {
        (address token0,) = sortTokens(tokenA, tokenB);
        address pair = pairFor(factory, tokenA, tokenB);
        if (pair.code.length == 0) revert InsufficientLiquidity();
        (uint112 reserve0, uint112 reserve1,) = INairaSwapPair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) internal pure returns (uint256) {
        if (amountA == 0) revert InsufficientInputAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        return amountA * reserveB / reserveA;
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();
        uint256 amountInWithFee = amountIn * 997;
        return amountInWithFee * reserveOut / (reserveIn * 1000 + amountInWithFee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        if (amountOut == 0) revert InsufficientOutputAmount();
        if (reserveIn == 0 || reserveOut == 0 || amountOut >= reserveOut) revert InsufficientLiquidity();
        return reserveIn * amountOut * 1000 / ((reserveOut - amountOut) * 997) + 1;
    }

    function validatePath(address[] memory path) internal pure {
        if (path.length < 2 || path.length > MAX_PATH + 1) revert InvalidPath();
        for (uint256 i; i + 1 < path.length; i++) {
            sortTokens(path[i], path[i + 1]);
        }
    }

    function getAmountsOut(address factory, uint256 amountIn, address[] memory path)
        internal view returns (uint256[] memory amounts)
    {
        validatePath(path);
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i; i + 1 < path.length; i++) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(factory, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    function getAmountsIn(address factory, uint256 amountOut, address[] memory path)
        internal view returns (uint256[] memory amounts)
    {
        validatePath(path);
        amounts = new uint256[](path.length);
        amounts[path.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(factory, path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}
