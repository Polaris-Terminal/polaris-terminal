// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @title PolarisProxy
/// @notice ERC-1967 proxy in front of every Polaris contract. Addresses stay fixed; the owner
///         upgrades the logic through the UUPS implementation behind it.
contract PolarisProxy is ERC1967Proxy {
    constructor(address implementation, bytes memory data) payable ERC1967Proxy(implementation, data) {}
}
