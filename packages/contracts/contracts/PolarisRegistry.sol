// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC4626} from "@openzeppelin/contracts/interfaces/IERC4626.sol";
import {Ownable2StepUpgradeable} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/// @title PolarisRegistry
/// @notice On-chain allowlist of the vaults the terminal is allowed to route deposits into.
///         A vault can only be listed if it reports the registry's asset on-chain.
contract PolarisRegistry is Ownable2StepUpgradeable, UUPSUpgradeable {
    struct Vault {
        address vault;
        string name;
        string curator;
        bool active;
        uint64 listedAt;
    }

    address public asset;
    Vault[] private _vaults;
    mapping(address => uint256) private _slot; // index + 1

    event VaultListed(address indexed vault, string name, string curator);
    event VaultToggled(address indexed vault, bool active);

    error AssetMismatch(address vault, address reported);
    error AlreadyListed(address vault);
    error NotListed(address vault);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address owner_, address asset_) external initializer {
        __Ownable_init(owner_);
        asset = asset_;
    }

    function listVault(address vault, string calldata name, string calldata curator) external onlyOwner {
        if (_slot[vault] != 0) revert AlreadyListed(vault);
        address reported = IERC4626(vault).asset();
        if (reported != asset) revert AssetMismatch(vault, reported);
        _vaults.push(Vault(vault, name, curator, true, uint64(block.timestamp)));
        _slot[vault] = _vaults.length;
        emit VaultListed(vault, name, curator);
    }

    function setActive(address vault, bool active) external onlyOwner {
        uint256 slot = _slot[vault];
        if (slot == 0) revert NotListed(vault);
        _vaults[slot - 1].active = active;
        emit VaultToggled(vault, active);
    }

    function isActive(address vault) external view returns (bool) {
        uint256 slot = _slot[vault];
        return slot != 0 && _vaults[slot - 1].active;
    }

    function vaults() external view returns (Vault[] memory) {
        return _vaults;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
