// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {INairaSwapPair} from "./interfaces/INairaSwapPair.sol";

/// @notice Holds protocol LP fees and redeemed underlying tokens; withdrawals go only to payout.
contract NairaSwapTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Minimum payout-change delay.
    uint256 public constant PAYOUT_DELAY = 2 days;
    /// @notice Exclusive destination of treasury withdrawals.
    address public payout;
    /// @notice Queued payout, or zero if nothing is queued.
    address public pendingPayout;
    /// @notice Earliest application timestamp, or zero if nothing is queued.
    uint256 public pendingPayoutAt;

    error ZeroAddress();
    error NothingQueued();
    error DelayNotElapsed(uint256 applyAt, uint256 currentTimestamp);
    error RenounceDisabled();
    error InsufficientLiquidity();

    event PayoutQueued(address indexed newPayout, uint256 applyAt);
    event PayoutSet(address indexed newPayout, uint256 applyAt);
    event PayoutCanceled(address indexed canceledPayout, uint256 applyAt);
    event Redeemed(address indexed pair, uint256 liquidity, address indexed to);
    event Withdrawn(address indexed token, uint256 amount, address indexed to);

    /// @notice Set the nonzero initial owner and initial payout destination.
    constructor(address initialOwner, address initialPayout) Ownable(initialOwner) {
        if (initialPayout == address(0)) revert ZeroAddress();
        payout = initialPayout;
        emit PayoutSet(initialPayout, block.timestamp);
    }

    /// @notice Queue a nonzero payout destination; replacing a queue restarts the delay.
    function queuePayout(address newPayout) external onlyOwner nonReentrant {
        if (newPayout == address(0)) revert ZeroAddress();
        pendingPayout = newPayout;
        pendingPayoutAt = block.timestamp + PAYOUT_DELAY;
        emit PayoutQueued(newPayout, pendingPayoutAt);
    }

    /// @notice Anyone may apply the queued payout once its two-day delay has elapsed.
    function applyPayout() external nonReentrant {
        uint256 applyAt = pendingPayoutAt;
        if (applyAt == 0) revert NothingQueued();
        if (block.timestamp < applyAt) revert DelayNotElapsed(applyAt, block.timestamp);
        address recipient = pendingPayout;
        delete pendingPayout;
        delete pendingPayoutAt;
        payout = recipient;
        emit PayoutSet(recipient, applyAt);
    }

    /// @notice Cancel the queued payout change; owner only.
    function cancelPayout() external onlyOwner nonReentrant {
        uint256 applyAt = pendingPayoutAt;
        if (applyAt == 0) revert NothingQueued();
        address recipient = pendingPayout;
        delete pendingPayout;
        delete pendingPayoutAt;
        emit PayoutCanceled(recipient, applyAt);
    }

    /// @notice Redeem treasury-owned LP tokens with all underlying proceeds sent here.
    function redeem(address pair, uint256 liquidity) external onlyOwner nonReentrant {
        if (pair == address(0)) revert ZeroAddress();
        if (liquidity == 0) revert InsufficientLiquidity();
        IERC20(pair).safeTransfer(pair, liquidity);
        INairaSwapPair(pair).burn(address(this));
        emit Redeemed(pair, liquidity, address(this));
    }

    /// @notice Withdraw tokens only to the configured payout address; owner only.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        address recipient = payout;
        IERC20(token).safeTransfer(recipient, amount);
        emit Withdrawn(token, amount, recipient);
    }

    /// @notice Propose a nonzero new owner using two-step acceptance.
    function transferOwnership(address newOwner) public override onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        super.transferOwnership(newOwner);
    }

    /// @notice Always reverts; treasury ownership may never be renounced.
    function renounceOwnership() public override onlyOwner {
        revert RenounceDisabled();
    }
}
