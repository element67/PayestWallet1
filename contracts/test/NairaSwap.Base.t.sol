// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {NairaSwapFactory} from "../NairaSwapFactory.sol";
import {NairaSwapRouter} from "../NairaSwapRouter.sol";
import {NairaSwapTreasury} from "../NairaSwapTreasury.sol";
import {INairaSwapPair} from "../interfaces/INairaSwapPair.sol";
import {MockERC20, FeeOnTransferERC20} from "../test-helpers/NairaSwapMocks.sol";

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

interface IOwn2 {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function transferOwnership(address) external;
    function acceptOwnership() external;
    function renounceOwnership() external;
}

/// @dev Shared fixture. Contains no test_/invariant_ functions.
abstract contract NairaSwapTestBase is Test {
    NairaSwapFactory internal factory;
    NairaSwapRouter internal router;
    NairaSwapTreasury internal treasury;

    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    MockERC20 internal tokenC;
    MockERC20 internal tokenD;
    FeeOnTransferERC20 internal fot; // 1% transfer fee

    address internal owner = makeAddr("owner");
    address internal pauser = makeAddr("pauser");
    address internal payoutAddr = makeAddr("payout");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant FUND = 1e30;
    uint256 internal constant ONE = 1e18;
    uint256 internal deadline;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        deadline = block.timestamp + 1 hours;

        treasury = new NairaSwapTreasury(owner, payoutAddr);
        factory = new NairaSwapFactory(owner, address(treasury));
        router = new NairaSwapRouter(address(factory), owner);
        vm.prank(owner);
        router.setPauser(pauser);

        tokenA = new MockERC20("Token A", "TKA");
        tokenB = new MockERC20("Token B", "TKB");
        tokenC = new MockERC20("Token C", "TKC");
        tokenD = new MockERC20("Token D", "TKD");
        fot = new FeeOnTransferERC20("Fee Token", "FOT", 100);

        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < users.length; i++) {
            tokenA.mint(users[i], FUND);
            tokenB.mint(users[i], FUND);
            tokenC.mint(users[i], FUND);
            tokenD.mint(users[i], FUND);
            fot.mint(users[i], FUND);
            vm.startPrank(users[i]);
            tokenA.approve(address(router), type(uint256).max);
            tokenB.approve(address(router), type(uint256).max);
            tokenC.approve(address(router), type(uint256).max);
            tokenD.approve(address(router), type(uint256).max);
            fot.approve(address(router), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ---------------------------------------------------------------- helpers

    function _pairOf(address a, address b) internal view returns (INairaSwapPair) {
        return INairaSwapPair(factory.getPair(a, b));
    }

    /// @dev Reserves ordered as (a, b).
    function _res(address a, address b) internal view returns (uint256 ra, uint256 rb) {
        INairaSwapPair p = _pairOf(a, b);
        (uint112 r0, uint112 r1,) = p.getReserves();
        (ra, rb) = a == p.token0() ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    function _k(address a, address b) internal view returns (uint256) {
        (uint256 ra, uint256 rb) = _res(a, b);
        return ra * rb;
    }

    function _add(address user, address a, address b, uint256 amtA, uint256 amtB)
        internal
        returns (uint256 usedA, uint256 usedB, uint256 liq)
    {
        vm.prank(user);
        (usedA, usedB, liq) = router.addLiquidity(a, b, amtA, amtB, 0, 0, user, deadline);
    }

    function _path2(address a, address b) internal pure returns (address[] memory p) {
        p = new address[](2);
        p[0] = a;
        p[1] = b;
    }

    function _path3(address a, address b, address c) internal pure returns (address[] memory p) {
        p = new address[](3);
        p[0] = a;
        p[1] = b;
        p[2] = c;
    }

    function _swapIn(address user, uint256 amountIn, address[] memory path) internal returns (uint256 out) {
        vm.prank(user);
        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, 0, path, user, deadline);
        out = amounts[amounts.length - 1];
    }

    function _permitSig(uint256 pk, address pairAddr, address who, address spender, uint256 value, uint256 dl)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        INairaSwapPair p = INairaSwapPair(pairAddr);
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                who,
                spender,
                value,
                p.nonces(who),
                dl
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", p.DOMAIN_SEPARATOR(), structHash));
        (v, r, s) = vm.sign(pk, digest);
    }

    /// @dev Full Ownable2Step lifecycle + renounce-disabled check against any of the three owned contracts.
    function _ownershipSuite(address target, bytes4 zeroSel, bytes4 renounceSel) internal {
        IOwn2 t = IOwn2(target);
        address o = t.owner();
        address newOwner = makeAddr("newOwner");

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        t.transferOwnership(alice);

        vm.prank(o);
        vm.expectRevert(zeroSel);
        t.transferOwnership(address(0));

        vm.expectEmit(true, true, false, false, target);
        emit Ownable2Step.OwnershipTransferStarted(o, newOwner);
        vm.prank(o);
        t.transferOwnership(newOwner);
        assertEq(t.owner(), o, "owner unchanged before accept");
        assertEq(t.pendingOwner(), newOwner);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        t.acceptOwnership();

        vm.expectEmit(true, true, false, false, target);
        emit Ownable.OwnershipTransferred(o, newOwner);
        vm.prank(newOwner);
        t.acceptOwnership();
        assertEq(t.owner(), newOwner);
        assertEq(t.pendingOwner(), address(0));

        vm.prank(o);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, o));
        t.transferOwnership(o);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        t.renounceOwnership();

        vm.prank(newOwner);
        vm.expectRevert(renounceSel);
        t.renounceOwnership();
        assertEq(t.owner(), newOwner, "renounce must not change owner");
    }

    /// @dev Standard pool used by many tests: A/B at 1000:1000 (1e18 units) provided by alice.
    function _seedAB() internal returns (INairaSwapPair p) {
        _add(alice, address(tokenA), address(tokenB), 1000 * ONE, 1000 * ONE);
        p = _pairOf(address(tokenA), address(tokenB));
    }
}
