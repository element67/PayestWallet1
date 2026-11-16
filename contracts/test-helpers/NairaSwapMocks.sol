// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NairaSwapPair} from "../NairaSwapPair.sol";
import {NairaSwapLibrary} from "../libraries/NairaSwapLibrary.sol";

/// @notice Plain ERC-20 with free public mint.
contract MockERC20 is ERC20 {
    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice ERC-20 that burns `feeBps` of every transfer (recipient receives less than `value`).
contract FeeOnTransferERC20 is ERC20 {
    uint256 public feeBps;

    constructor(string memory n, string memory s, uint256 feeBps_) ERC20(n, s) {
        feeBps = feeBps_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && feeBps != 0) {
            uint256 fee = value * feeBps / 10_000;
            super._update(from, address(0), fee);
            super._update(from, to, value - fee);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @notice ERC-20 that, once armed, performs one arbitrary call during the next transfer and bubbles reverts.
contract HookERC20 is ERC20 {
    address public hookTarget;
    bytes public hookData;
    bool public armed;

    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        hookTarget = target;
        hookData = data;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed && from != address(0) && to != address(0)) {
            armed = false;
            (bool ok, bytes memory ret) = hookTarget.call(hookData);
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
        super._update(from, to, value);
    }
}

/// @notice Minimal factory stand-in so a pair can be tested with feeTo == address(0) and toggled feeTo.
contract MockFactory {
    address public feeTo;

    function setFeeTo(address f) external {
        feeTo = f;
    }

    function deploy(address a, address b) external returns (NairaSwapPair p) {
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        p = new NairaSwapPair();
        p.initialize(t0, t1);
    }
}

/// @notice Exposes the internal library for direct testing.
contract LibHarness {
    function sortTokens(address a, address b) external pure returns (address, address) {
        return NairaSwapLibrary.sortTokens(a, b);
    }

    function pairFor(address f, address a, address b) external view returns (address) {
        return NairaSwapLibrary.pairFor(f, a, b);
    }

    function getReserves(address f, address a, address b) external view returns (uint256, uint256) {
        return NairaSwapLibrary.getReserves(f, a, b);
    }

    function quote(uint256 a, uint256 ra, uint256 rb) external pure returns (uint256) {
        return NairaSwapLibrary.quote(a, ra, rb);
    }

    function getAmountOut(uint256 a, uint256 ri, uint256 ro) external pure returns (uint256) {
        return NairaSwapLibrary.getAmountOut(a, ri, ro);
    }

    function getAmountIn(uint256 a, uint256 ri, uint256 ro) external pure returns (uint256) {
        return NairaSwapLibrary.getAmountIn(a, ri, ro);
    }

    function getAmountsOut(address f, uint256 a, address[] calldata path) external view returns (uint256[] memory) {
        return NairaSwapLibrary.getAmountsOut(f, a, path);
    }

    function getAmountsIn(address f, uint256 a, address[] calldata path) external view returns (uint256[] memory) {
        return NairaSwapLibrary.getAmountsIn(f, a, path);
    }

    function validatePath(address[] calldata path) external pure {
        NairaSwapLibrary.validatePath(path);
    }
}
