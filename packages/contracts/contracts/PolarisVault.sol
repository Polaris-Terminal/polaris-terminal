// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC4626Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC4626Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title PolarisVault (North Vault)
/// @notice ERC-4626 vault whose yield is streamed in linearly, so share price rises smoothly
///         instead of jumping when rewards land (no sandwiching of reward drops).
contract PolarisVault is ERC4626Upgradeable, Ownable2StepUpgradeable, PausableUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    /// @notice Rewards still locked as of `lastSync`; they unlock linearly until `rewardEnd`.
    uint256 public rewardRemaining;
    uint64 public lastSync;
    uint64 public rewardEnd;

    event RewardStreamed(uint256 amount, uint256 locked, uint64 rewardEnd);

    error BadDuration();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(IERC20 asset_, string calldata name_, string calldata symbol_, address owner_)
        external
        initializer
    {
        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        __Ownable_init(owner_);
        __Pausable_init();
    }

    /// @notice Assets still waiting to vest into the share price.
    function lockedRewards() public view returns (uint256) {
        if (block.timestamp >= rewardEnd) return 0;
        return rewardRemaining * (rewardEnd - block.timestamp) / (rewardEnd - lastSync);
    }

    /// @notice Current unlock speed in assets per second.
    function rewardRate() external view returns (uint256) {
        if (block.timestamp >= rewardEnd) return 0;
        return rewardRemaining / (rewardEnd - lastSync);
    }

    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) - lockedRewards();
    }

    /// @notice Pull `amount` of the asset from the owner and stream it to depositors over `duration`.
    function streamReward(uint256 amount, uint64 duration) external onlyOwner {
        if (duration == 0) revert BadDuration();
        uint256 locked = lockedRewards() + amount;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), amount);
        rewardRemaining = locked;
        lastSync = uint64(block.timestamp);
        rewardEnd = uint64(block.timestamp) + duration;
        emit RewardStreamed(amount, locked, rewardEnd);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Pausing only stops new money coming in; exits always stay open.
    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxDeposit(receiver);
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return paused() ? 0 : super.maxMint(receiver);
    }

    // Virtual share offset makes first-depositor inflation attacks unprofitable.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
