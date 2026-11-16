// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {INairaSwapFactory} from "./interfaces/INairaSwapFactory.sol";

/// @notice Immutable V2-style constant-product pool with an ERC-2612 LP token.
/// @dev Inputs are measured from balances. No flash callback; swaps require prepaid input.
/// Rebasing tokens are unsupported. Direct donations may be skimmed permissionlessly.
contract NairaSwapPair is ERC20, ERC20Permit {
    using SafeERC20 for IERC20;

    /// @notice LP units permanently locked at the burn address on first mint.
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    /// @notice Factory authorized to initialize this pair.
    address public immutable factory;
    /// @notice Lower-address underlying token.
    address public token0;
    /// @notice Higher-address underlying token.
    address public token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;
    uint256 private unlocked = 1;

    /// @notice Cumulative UQ112x112 token1/token0 price, modulo 2**256.
    uint256 public price0CumulativeLast;
    /// @notice Cumulative UQ112x112 token0/token1 price, modulo 2**256.
    uint256 public price1CumulativeLast;
    /// @notice Reserve product after the last fee-enabled mint or burn.
    uint256 public kLast;

    struct SwapState {
        uint112 old0;
        uint112 old1;
        uint256 balance0;
        uint256 balance1;
        uint256 amount0In;
        uint256 amount1In;
    }

    error Forbidden();
    error AlreadyInitialized();
    error InvalidTokens();
    error InvalidTo();
    error Locked();
    error ReserveOverflow(uint256 balance0, uint256 balance1);
    error InsufficientLiquidity(uint256 actual, uint256 bound);
    error InsufficientInputAmount(uint256 amount0In, uint256 amount1In);
    error InsufficientOutputAmount(uint256 amount0Out, uint256 amount1Out);
    error InvariantViolation();
    error NonEmptyData();

    event Initialized(address indexed token0, address indexed token1);
    event Mint(address indexed sender, uint256 amount0, uint256 amount1);
    event Burn(address indexed sender, uint256 amount0, uint256 amount1, address indexed to);
    event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to);
    event Sync(uint112 reserve0, uint112 reserve1);
    event Skim(address indexed to, uint256 amount0, uint256 amount1);

    modifier lock() {
        if (unlocked != 1) revert Locked();
        unlocked = 0;
        _;
        unlocked = 1;
    }

    /// @notice Deploy an uninitialized pair owned by its deploying factory.
    constructor() ERC20("NairaSwap LP", "NSWAP-LP") ERC20Permit("NairaSwap LP") {
        factory = msg.sender;
    }

    /// @notice Initialize sorted tokens exactly once; only the deploying factory may call.
    function initialize(address token0_, address token1_) external {
        if (msg.sender != factory) revert Forbidden();
        if (token0 != address(0)) revert AlreadyInitialized();
        if (token0_ == address(0) || token0_ >= token1_) revert InvalidTokens();
        token0 = token0_;
        token1 = token1_;
        emit Initialized(token0_, token1_);
    }

    /// @notice Return stored reserves and the last modulo-2**32 update timestamp.
    function getReserves() external view returns (uint112, uint112, uint32) {
        return (reserve0, reserve1, blockTimestampLast);
    }

    /// @notice Mint LP to `to` for actual underlying balances deposited since the last update.
    function mint(address to) external lock returns (uint256 liquidity) {
        _validateTo(to);
        uint112 old0 = reserve0;
        uint112 old1 = reserve1;
        (uint256 balance0, uint256 balance1) = _balances();
        _checkBalances(balance0, balance1);
        uint256 amount0 = balance0 - old0;
        uint256 amount1 = balance1 - old1;
        bool feeOn = _mintFee(old0, old1);
        uint256 supply = totalSupply();
        if (supply == 0) {
            uint256 root = Math.sqrt(amount0 * amount1);
            if (root <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity(root, MINIMUM_LIQUIDITY);
            liquidity = root - MINIMUM_LIQUIDITY;
            _mint(address(0xdead), MINIMUM_LIQUIDITY);
        } else {
            if (old0 == 0 || old1 == 0) revert InsufficientLiquidity(Math.min(old0, old1), 1);
            liquidity = Math.min(amount0 * supply / old0, amount1 * supply / old1);
        }
        if (liquidity == 0) revert InsufficientLiquidity(liquidity, 1);
        _mint(to, liquidity);
        _update(balance0, balance1, old0, old1);
        if (feeOn) kLast = uint256(reserve0) * reserve1;
        emit Mint(msg.sender, amount0, amount1);
    }

    /// @notice Burn all LP held by the pair and transfer its pro-rata underlying balances to `to`.
    function burn(address to) external lock returns (uint256 amount0, uint256 amount1) {
        _validateTo(to);
        uint112 old0 = reserve0;
        uint112 old1 = reserve1;
        (uint256 balance0, uint256 balance1) = _balances();
        uint256 liquidity = balanceOf(address(this));
        bool feeOn = _mintFee(old0, old1);
        uint256 supply = totalSupply();
        if (supply == 0) revert InsufficientLiquidity(supply, 1);
        amount0 = liquidity * balance0 / supply;
        amount1 = liquidity * balance1 / supply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity(Math.min(amount0, amount1), 1);
        _burn(address(this), liquidity);
        IERC20(token0).safeTransfer(to, amount0);
        IERC20(token1).safeTransfer(to, amount1);
        (balance0, balance1) = _balances();
        _update(balance0, balance1, old0, old1);
        if (feeOn) kLast = uint256(reserve0) * reserve1;
        emit Burn(msg.sender, amount0, amount1, to);
    }

    /// @notice Exchange prepaid input for outputs, enforcing a 0.30% fee-adjusted invariant.
    /// @param data Must be empty; flash-swap callbacks are intentionally unsupported.
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external lock {
        if (data.length != 0) revert NonEmptyData();
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount(amount0Out, amount1Out);
        _validateTo(to);
        SwapState memory state;
        state.old0 = reserve0;
        state.old1 = reserve1;
        if (amount0Out >= state.old0) revert InsufficientLiquidity(state.old0, amount0Out);
        if (amount1Out >= state.old1) revert InsufficientLiquidity(state.old1, amount1Out);
        if (amount0Out != 0) IERC20(token0).safeTransfer(to, amount0Out);
        if (amount1Out != 0) IERC20(token1).safeTransfer(to, amount1Out);
        (state.balance0, state.balance1) = _balances();
        _checkBalances(state.balance0, state.balance1);
        state.amount0In = state.balance0 > uint256(state.old0) - amount0Out
            ? state.balance0 - (uint256(state.old0) - amount0Out) : 0;
        state.amount1In = state.balance1 > uint256(state.old1) - amount1Out
            ? state.balance1 - (uint256(state.old1) - amount1Out) : 0;
        if (state.amount0In == 0 && state.amount1In == 0) revert InsufficientInputAmount(state.amount0In, state.amount1In);
        uint256 adjusted0 = state.balance0 * 1000 - state.amount0In * 3;
        uint256 adjusted1 = state.balance1 * 1000 - state.amount1In * 3;
        if (adjusted0 * adjusted1 < uint256(state.old0) * state.old1 * 1_000_000) {
            revert InvariantViolation();
        }
        // Token interactions precede reserve effects intentionally: actual post-transfer balances
        // must enforce the invariant. The shared lock protects every reserve-changing entry point.
        _update(state.balance0, state.balance1, state.old0, state.old1);
        emit Swap(msg.sender, state.amount0In, state.amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Send only balances in excess of reserves to `to`.
    function skim(address to) external lock {
        _validateTo(to);
        (uint256 balance0, uint256 balance1) = _balances();
        uint256 amount0 = balance0 - reserve0;
        uint256 amount1 = balance1 - reserve1;
        if (amount0 != 0) IERC20(token0).safeTransfer(to, amount0);
        if (amount1 != 0) IERC20(token1).safeTransfer(to, amount1);
        emit Skim(to, amount0, amount1);
    }

    /// @notice Synchronize reserves to actual balances without moving tokens.
    function sync() external lock {
        (uint256 balance0, uint256 balance1) = _balances();
        _update(balance0, balance1, reserve0, reserve1);
    }

    function _validateTo(address to) private view {
        if (to == address(0) || to == address(this) || to == token0 || to == token1) revert InvalidTo();
    }

    function _balances() private view returns (uint256, uint256) {
        return (IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    }

    function _checkBalances(uint256 balance0, uint256 balance1) private pure {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert ReserveOverflow(balance0, balance1);
    }

    function _update(uint256 balance0, uint256 balance1, uint112 old0, uint112 old1) private {
        _checkBalances(balance0, balance1);
        uint32 timestamp = uint32(block.timestamp);
        // The sole unchecked block: V2 timestamps wrap modulo 2**32 and cumulative
        // UQ112x112 prices wrap modulo 2**256. Integrators take modular differences.
        unchecked {
            uint32 elapsed = timestamp - blockTimestampLast;
            if (elapsed != 0 && old0 != 0 && old1 != 0) {
                price0CumulativeLast += ((uint256(old1) << 112) / old0) * elapsed;
                price1CumulativeLast += ((uint256(old0) << 112) / old1) * elapsed;
            }
        }
        reserve0 = uint112(balance0);
        reserve1 = uint112(balance1);
        blockTimestampLast = timestamp;
        emit Sync(reserve0, reserve1);
    }

    function _mintFee(uint112 old0, uint112 old1) private returns (bool feeOn) {
        address recipient = INairaSwapFactory(factory).feeTo();
        feeOn = recipient != address(0);
        uint256 previousK = kLast;
        if (feeOn) {
            if (previousK != 0) {
                uint256 rootK = Math.sqrt(uint256(old0) * old1);
                uint256 rootKLast = Math.sqrt(previousK);
                if (rootK > rootKLast) {
                    uint256 liquidity = totalSupply() * (rootK - rootKLast) / (rootK * 5 + rootKLast);
                    if (liquidity != 0) _mint(recipient, liquidity);
                }
            }
        } else if (previousK != 0) {
            kLast = 0;
        }
    }
}
