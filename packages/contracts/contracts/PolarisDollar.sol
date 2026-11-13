// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title PolarisDollar (pUSD)
/// @notice Testnet stable used by North Vaults. Anyone can claim a drip once per cooldown.
contract PolarisDollar is ERC20Upgradeable, Ownable2StepUpgradeable, UUPSUpgradeable {
    uint256 public dripAmount;
    uint256 public cooldown;
    mapping(address => uint256) public lastDrip;

    event Dripped(address indexed to, uint256 amount);

    error DripCooling(uint256 readyAt);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, uint256 dripAmount_, uint256 cooldown_) external initializer {
        __ERC20_init("Polaris Dollar", "pUSD");
        __Ownable_init(owner_);
        dripAmount = dripAmount_;
        cooldown = cooldown_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function drip() external {
        uint256 readyAt = lastDrip[msg.sender] + cooldown;
        if (lastDrip[msg.sender] != 0 && block.timestamp < readyAt) revert DripCooling(readyAt);
        lastDrip[msg.sender] = block.timestamp;
        _mint(msg.sender, dripAmount);
        emit Dripped(msg.sender, dripAmount);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function setDrip(uint256 dripAmount_, uint256 cooldown_) external onlyOwner {
        dripAmount = dripAmount_;
        cooldown = cooldown_;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
