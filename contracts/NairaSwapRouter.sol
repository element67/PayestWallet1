// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INairaSwapFactory} from "./interfaces/INairaSwapFactory.sol";
import {INairaSwapPair} from "./interfaces/INairaSwapPair.sol";
import {NairaSwapLibrary} from "./libraries/NairaSwapLibrary.sol";

/// @notice Token-only routing; swaps/adds can pause, liquidity removal cannot.
/// @dev Tokens move directly between users and pairs. The router grants no token approvals.
/// Administrative functions retain their specified deadline-free signatures; all user fund
/// operations require deadlines and slippage bounds. ERC-2612 permits are exact-amount only.
contract NairaSwapRouter is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Factory used for every routed pair.
    address public immutable factory;
    /// @notice Emergency pause-only operator; initially the owner.
    address public pauser;
    /// @notice Maximum number of hops; paths contain at most five token addresses.
    uint256 public constant MAX_PATH = 4;

    struct AddRequest {
        address tokenA;
        address tokenB;
        uint256 desiredA;
        uint256 desiredB;
        uint256 minA;
        uint256 minB;
        address to;
    }

    struct RemoveRequest {
        address tokenA;
        address tokenB;
        uint256 liquidity;
        uint256 minA;
        uint256 minB;
        address to;
    }

    error ZeroAddress();
    error InvalidTo();
    error Forbidden();
    error InvalidFactory(address factory);
    error Expired(uint256 deadline, uint256 currentTimestamp);
    error InsufficientInputAmount(uint256 actual, uint256 minimum);
    error InsufficientOutputAmount(uint256 actual, uint256 minimum);
    error ExcessiveInputAmount(uint256 actual, uint256 maximum);
    error RenounceDisabled();

    event PauserSet(address indexed account);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired(deadline, block.timestamp);
        _;
    }

    /// @notice Configure the factory and nonzero owner; the owner is also the initial pauser.
    constructor(address factory_, address initialOwner) Ownable(initialOwner) {
        if (factory_ == address(0)) revert ZeroAddress();
        if (factory_.code.length == 0) revert InvalidFactory(factory_);
        (bool success, bytes memory result) = factory_.staticcall(
            abi.encodeWithSelector(INairaSwapFactory.pairCodeHash.selector)
        );
        if (!success || result.length != 32) revert InvalidFactory(factory_);
        factory = factory_;
        pauser = initialOwner;
        emit PauserSet(initialOwner);
    }

    /// @notice Add optimal liquidity, checking actual received amounts against both minima.
    /// @dev Desired amounts cap transfers; outputs are actual amounts deposited and LP minted.
    function addLiquidity(
        address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired,
        uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline
    ) external ensure(deadline) whenNotPaused nonReentrant returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        AddRequest memory request;
        request.tokenA = tokenA;
        request.tokenB = tokenB;
        request.desiredA = amountADesired;
        request.desiredB = amountBDesired;
        request.minA = amountAMin;
        request.minB = amountBMin;
        request.to = to;
        return _add(request);
    }

    /// @notice Remove LP and enforce actual recipient token minima; never blocked by pause.
    function removeLiquidity(
        address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin,
        uint256 amountBMin, address to, uint256 deadline
    ) external ensure(deadline) nonReentrant returns (uint256 amountA, uint256 amountB) {
        RemoveRequest memory request;
        request.tokenA = tokenA;
        request.tokenB = tokenB;
        request.liquidity = liquidity;
        request.minA = amountAMin;
        request.minB = amountBMin;
        request.to = to;
        return _remove(request);
    }

    /// @notice Remove liquidity using a permit for exactly `liquidity`; never blocked by pause.
    /// @dev No approveMax flag: persistent unlimited approvals are intentionally unsupported.
    function removeLiquidityWithPermit(
        address tokenA, address tokenB, uint256 liquidity, uint256 amountAMin,
        uint256 amountBMin, address to, uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external ensure(deadline) nonReentrant returns (uint256 amountA, uint256 amountB) {
        RemoveRequest memory request;
        request.tokenA = tokenA;
        request.tokenB = tokenB;
        request.liquidity = liquidity;
        request.minA = amountAMin;
        request.minB = amountBMin;
        request.to = to;
        return _permitAndRemove(request, deadline, v, r, s);
    }

    /// @notice Swap exact input for at least the specified output before deadline.
    /// @dev Use the dedicated supporting function for fee-on-transfer input/intermediate tokens.
    function swapExactTokensForTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external ensure(deadline) whenNotPaused nonReentrant returns (uint256[] memory amounts) {
        _validateTo(to);
        amounts = NairaSwapLibrary.getAmountsOut(factory, amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount(amounts[amounts.length - 1], amountOutMin);
        uint256 beforeBalance = IERC20(path[path.length - 1]).balanceOf(to);
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        uint256 received = IERC20(path[path.length - 1]).balanceOf(to) - beforeBalance;
        if (received < amountOutMin) {
            revert InsufficientOutputAmount(received, amountOutMin);
        }
    }

    /// @notice Obtain the requested output spending no more than `amountInMax` before deadline.
    function swapTokensForExactTokens(
        uint256 amountOut, uint256 amountInMax, address[] calldata path, address to, uint256 deadline
    ) external ensure(deadline) whenNotPaused nonReentrant returns (uint256[] memory amounts) {
        _validateTo(to);
        amounts = NairaSwapLibrary.getAmountsIn(factory, amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount(amounts[0], amountInMax);
        uint256 beforeBalance = IERC20(path[path.length - 1]).balanceOf(to);
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amounts[0]);
        _swap(amounts, path, to);
        uint256 received = IERC20(path[path.length - 1]).balanceOf(to) - beforeBalance;
        if (received < amountOut) {
            revert InsufficientOutputAmount(received, amountOut);
        }
    }

    /// @notice Swap exact input using actual pair input balances and actual recipient minimum output.
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(
        uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline
    ) external ensure(deadline) whenNotPaused nonReentrant {
        _validateTo(to);
        NairaSwapLibrary.validatePath(path);
        if (amountIn == 0) revert InsufficientInputAmount(amountIn, 1);
        uint256 beforeBalance = IERC20(path[path.length - 1]).balanceOf(to);
        IERC20(path[0]).safeTransferFrom(msg.sender, _pair(path[0], path[1]), amountIn);
        for (uint256 i; i + 1 < path.length; i++) {
            address recipient = i + 2 < path.length ? _pair(path[i + 1], path[i + 2]) : to;
            _supportingHop(path[i], path[i + 1], recipient);
        }
        uint256 received = IERC20(path[path.length - 1]).balanceOf(to) - beforeBalance;
        if (received < amountOutMin) {
            revert InsufficientOutputAmount(received, amountOutMin);
        }
    }

    /// @notice Quote a proportional amount from reserves without a swap fee.
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB) external pure returns (uint256) {
        return NairaSwapLibrary.quote(amountA, reserveA, reserveB);
    }

    /// @notice Quote output after the 0.30% swap fee.
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256) {
        return NairaSwapLibrary.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    /// @notice Quote required input rounded up, including the swap fee.
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut) external pure returns (uint256) {
        return NairaSwapLibrary.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    /// @notice Quote each hop's amounts for exact input, for at most four hops.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory) {
        return NairaSwapLibrary.getAmountsOut(factory, amountIn, path);
    }

    /// @notice Quote each hop's amounts for exact output, for at most four hops.
    function getAmountsIn(uint256 amountOut, address[] calldata path) external view returns (uint256[] memory) {
        return NairaSwapLibrary.getAmountsIn(factory, amountOut, path);
    }

    /// @notice Set a nonzero pause-only operator; owner only.
    function setPauser(address newPauser) external onlyOwner nonReentrant {
        if (newPauser == address(0)) revert ZeroAddress();
        pauser = newPauser;
        emit PauserSet(newPauser);
    }

    /// @notice Pause swaps and adds; callable by owner or pauser, without blocking exits.
    function pause() external nonReentrant {
        if (msg.sender != owner() && msg.sender != pauser) revert Forbidden();
        _pause();
    }

    /// @notice Resume swaps and adds; only the owner may unpause.
    function unpause() external onlyOwner nonReentrant {
        _unpause();
    }

    /// @notice Rescue stray tokens; no pool reserves or user allowances can be accessed.
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        _validateTo(to);
        IERC20(token).safeTransfer(to, amount);
        emit TokensRescued(token, to, amount);
    }

    /// @notice Propose a nonzero new owner for two-step acceptance.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice Always reverts; router ownership cannot be renounced.
    function renounceOwnership() public override onlyOwner {
        revert RenounceDisabled();
    }

    function _add(AddRequest memory request) private returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        _validateTo(request.to);
        address pair = INairaSwapFactory(factory).getPair(request.tokenA, request.tokenB);
        if (pair == address(0)) pair = INairaSwapFactory(factory).createPair(request.tokenA, request.tokenB);
        (amountA, amountB) = _optimal(request);
        uint256 beforeA = IERC20(request.tokenA).balanceOf(pair);
        uint256 beforeB = IERC20(request.tokenB).balanceOf(pair);
        IERC20(request.tokenA).safeTransferFrom(msg.sender, pair, amountA);
        IERC20(request.tokenB).safeTransferFrom(msg.sender, pair, amountB);
        amountA = IERC20(request.tokenA).balanceOf(pair) - beforeA;
        amountB = IERC20(request.tokenB).balanceOf(pair) - beforeB;
        if (amountA < request.minA) revert InsufficientInputAmount(amountA, request.minA);
        if (amountB < request.minB) revert InsufficientInputAmount(amountB, request.minB);
        liquidity = INairaSwapPair(pair).mint(request.to);
    }

    function _optimal(AddRequest memory request) private view returns (uint256 amountA, uint256 amountB) {
        if (INairaSwapPair(_pair(request.tokenA, request.tokenB)).totalSupply() == 0) {
            (amountA, amountB) = (request.desiredA, request.desiredB);
        } else {
            (uint256 reserveA, uint256 reserveB) = NairaSwapLibrary.getReserves(factory, request.tokenA, request.tokenB);
            uint256 optimalB = NairaSwapLibrary.quote(request.desiredA, reserveA, reserveB);
            if (optimalB <= request.desiredB) {
                (amountA, amountB) = (request.desiredA, optimalB);
            } else {
                uint256 optimalA = NairaSwapLibrary.quote(request.desiredB, reserveB, reserveA);
                if (optimalA > request.desiredA) revert ExcessiveInputAmount(optimalA, request.desiredA);
                (amountA, amountB) = (optimalA, request.desiredB);
            }
        }
        if (amountA < request.minA) revert InsufficientInputAmount(amountA, request.minA);
        if (amountB < request.minB) revert InsufficientInputAmount(amountB, request.minB);
    }

    function _permitAndRemove(RemoveRequest memory request, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        private returns (uint256, uint256)
    {
        address pair = _pair(request.tokenA, request.tokenB);
        // A third party may have already submitted the same permit; the allowance must
        // still cover the exact removal if so. Invalid signatures never grant authority.
        try INairaSwapPair(pair).permit(msg.sender, address(this), request.liquidity, deadline, v, r, s) {} catch {
            if (IERC20(pair).allowance(msg.sender, address(this)) < request.liquidity) revert Forbidden();
        }
        return _remove(request);
    }

    function _remove(RemoveRequest memory request) private returns (uint256 amountA, uint256 amountB) {
        _validateTo(request.to);
        address pair = _pair(request.tokenA, request.tokenB);
        uint256 beforeA = IERC20(request.tokenA).balanceOf(request.to);
        uint256 beforeB = IERC20(request.tokenB).balanceOf(request.to);
        IERC20(pair).safeTransferFrom(msg.sender, pair, request.liquidity);
        INairaSwapPair(pair).burn(request.to);
        amountA = IERC20(request.tokenA).balanceOf(request.to) - beforeA;
        amountB = IERC20(request.tokenB).balanceOf(request.to) - beforeB;
        if (amountA < request.minA) revert InsufficientOutputAmount(amountA, request.minA);
        if (amountB < request.minB) revert InsufficientOutputAmount(amountB, request.minB);
    }

    function _swap(uint256[] memory amounts, address[] calldata path, address to) private {
        for (uint256 i; i + 1 < path.length; i++) {
            address recipient = i + 2 < path.length ? _pair(path[i + 1], path[i + 2]) : to;
            _swapHop(path[i], path[i + 1], amounts[i + 1], recipient);
        }
    }

    function _supportingHop(address input, address output, address recipient) private {
        (uint256 reserveIn, uint256 reserveOut) = NairaSwapLibrary.getReserves(factory, input, output);
        uint256 received = IERC20(input).balanceOf(_pair(input, output)) - reserveIn;
        _swapHop(input, output, NairaSwapLibrary.getAmountOut(received, reserveIn, reserveOut), recipient);
    }

    function _swapHop(address input, address output, uint256 amountOut, address recipient) private {
        (address token0,) = NairaSwapLibrary.sortTokens(input, output);
        (uint256 amount0Out, uint256 amount1Out) = input == token0
            ? (uint256(0), amountOut) : (amountOut, uint256(0));
        INairaSwapPair(_pair(input, output)).swap(amount0Out, amount1Out, recipient, "");
    }

    function _pair(address tokenA, address tokenB) private view returns (address) {
        return NairaSwapLibrary.pairFor(factory, tokenA, tokenB);
    }

    function _validateTo(address to) private view {
        if (to == address(0) || to == address(this)) revert InvalidTo();
    }
}
