// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @notice Test-only confidential token. Anyone can mint. Never deploy this for real use.
contract MockCUSDT is ZamaEthereumConfig, ERC7984 {
    constructor() ERC7984("Mock Confidential USDT", "cUSDT", "") {}

    function mint(address to, uint64 amount) external {
        _mint(to, FHE.asEuint64(amount));
    }
}