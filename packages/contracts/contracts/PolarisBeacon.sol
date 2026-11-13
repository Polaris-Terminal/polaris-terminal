// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title PolarisBeacon
/// @notice Daily "look up" check-in. One ping per UTC day builds a streak; streaks and
///         $POLARIS holdings multiply the XP each ping earns.
contract PolarisBeacon is Ownable2StepUpgradeable, UUPSUpgradeable {
    struct Star {
        uint32 streak;
        uint32 best;
        uint32 pings;
        uint64 lastDay;
        uint128 xp;
    }

    uint256 public constant BASE_XP = 10;
    uint256 public constant STREAK_XP = 5;
    uint256 public constant MAX_STREAK_BONUS = 20;

    IERC20 public token;
    uint256 public boostThreshold;
    uint256 public observers;
    uint256 public totalPings;
    mapping(address => Star) public stars;

    event Pinged(address indexed observer, uint64 indexed day, uint32 streak, uint128 xp, uint256 gained);

    error AlreadyPinged(uint64 day);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, IERC20 token_, uint256 boostThreshold_) external initializer {
        __Ownable_init(owner_);
        token = token_;
        boostThreshold = boostThreshold_;
    }

    function today() public view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    function ping() external returns (uint256 gained) {
        uint64 day = today();
        Star storage s = stars[msg.sender];
        if (s.pings != 0 && s.lastDay == day) revert AlreadyPinged(day);
        if (s.pings == 0) observers++;

        s.streak = (s.pings != 0 && s.lastDay + 1 == day) ? s.streak + 1 : 1;
        if (s.streak > s.best) s.best = s.streak;
        s.pings++;
        s.lastDay = day;

        gained = previewGain(msg.sender, s.streak);
        s.xp += uint128(gained);
        totalPings++;
        emit Pinged(msg.sender, day, s.streak, s.xp, gained);
    }

    /// @notice XP a ping at `streak` would earn for `who` right now.
    function previewGain(address who, uint32 streak) public view returns (uint256 gained) {
        uint256 bonus = streak > 1 ? streak - 1 : 0;
        if (bonus > MAX_STREAK_BONUS) bonus = MAX_STREAK_BONUS;
        gained = BASE_XP + bonus * STREAK_XP;
        if (address(token) != address(0) && boostThreshold != 0 && token.balanceOf(who) >= boostThreshold) {
            gained += gained / 2;
        }
    }

    /// @notice Streak as it stands today: a missed day means the next ping restarts at 1.
    function liveStreak(address who) external view returns (uint32) {
        Star memory s = stars[who];
        return s.pings != 0 && s.lastDay + 1 >= today() ? s.streak : 0;
    }

    function setBoost(IERC20 token_, uint256 threshold) external onlyOwner {
        token = token_;
        boostThreshold = threshold;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
