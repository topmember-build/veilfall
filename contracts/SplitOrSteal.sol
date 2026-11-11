// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Split or Steal - Veilfall week 1 base
/// @notice Two players secretly choose SPLIT (false) or STEAL (true).
///         Choices stay encrypted forever. The contract computes each player's
///         outcome on encrypted data, so there is no reveal phase to stall or grief.
/// @dev Outcome codes: 0 = nothing, 1 = half the pot, 2 = the whole pot.
contract SplitOrSteal is ZamaEthereumConfig {
    struct Duel {
        address playerA;
        address playerB;
        ebool choiceA;
        ebool choiceB;
        bool playedA;
        bool playedB;
        euint8 resultA;
        euint8 resultB;
    }

    uint256 public duelCount;
    mapping(uint256 => Duel) private _duels;

    event DuelCreated(uint256 indexed id, address indexed playerA, address indexed playerB);
    event ChoiceLocked(uint256 indexed id, address indexed player);
    event DuelResolved(uint256 indexed id);

    /// @notice Start a duel against a specific opponent.
    function createDuel(address opponent) external returns (uint256 id) {
        require(opponent != address(0) && opponent != msg.sender, "Invalid opponent");
        id = ++duelCount;
        _duels[id].playerA = msg.sender;
        _duels[id].playerB = opponent;
        emit DuelCreated(id, msg.sender, opponent);
    }

    /// @notice Lock in your encrypted choice (true = steal, false = split).
    function play(uint256 id, externalEbool input, bytes calldata inputProof) external {
        Duel storage d = _duels[id];
        require(d.playerA != address(0), "Duel not found");

        ebool choice = FHE.fromExternal(input, inputProof);
        FHE.allowThis(choice);

        if (msg.sender == d.playerA) {
            require(!d.playedA, "Already played");
            d.choiceA = choice;
            d.playedA = true;
        } else if (msg.sender == d.playerB) {
            require(!d.playedB, "Already played");
            d.choiceB = choice;
            d.playedB = true;
        } else {
            revert("Not a player");
        }

        emit ChoiceLocked(id, msg.sender);

        if (d.playedA && d.playedB) {
            _resolve(id, d);
        }
    }

    /// @notice Encrypted outcome code for a player (only that player can decrypt it).
    function resultOf(uint256 id, address player) external view returns (euint8) {
        Duel storage d = _duels[id];
        if (player == d.playerA) return d.resultA;
        if (player == d.playerB) return d.resultB;
        revert("Not a player");
    }

    function playersOf(uint256 id) external view returns (address, address, bool, bool) {
        Duel storage d = _duels[id];
        return (d.playerA, d.playerB, d.playedA, d.playedB);
    }

    function _resolve(uint256 id, Duel storage d) private {
        euint8 nothing = FHE.asEuint8(0);
        euint8 half = FHE.asEuint8(1);
        euint8 all = FHE.asEuint8(2);

        // I steal: win everything if the other splits, nothing if the other steals.
        // I split: half if the other splits, nothing if the other steals.
        d.resultA = FHE.select(
            d.choiceA,
            FHE.select(d.choiceB, nothing, all),
            FHE.select(d.choiceB, nothing, half)
        );
        d.resultB = FHE.select(
            d.choiceB,
            FHE.select(d.choiceA, nothing, all),
            FHE.select(d.choiceA, nothing, half)
        );

        FHE.allowThis(d.resultA);
        FHE.allowThis(d.resultB);
        FHE.allow(d.resultA, d.playerA);
        FHE.allow(d.resultB, d.playerB);

        emit DuelResolved(id);
    }
}