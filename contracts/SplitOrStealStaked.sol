// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint64, externalEbool} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title Split or Steal (staked) - Veilfall week 1
/// @notice Two players each stake the same amount of a confidential token (ERC-7984),
///         then secretly choose SPLIT (false) or STEAL (true). Choices, balances and
///         payouts stay encrypted. The contract settles on encrypted data:
///           both split  -> each gets their stake back
///           one steals  -> the thief takes the whole pot
///           both steal  -> the pot is forfeited and stays in this contract
///         If someone could not actually fund their stake, everyone is refunded what they paid.
/// @dev Each player must first call token.setOperator(thisContract, until).
contract SplitOrStealStaked is ZamaEthereumConfig {
    struct Duel {
        address playerA;
        address playerB;
        uint64 stake;
        uint48 createdAt;
        bool playedA;
        bool playedB;
        bool settled;
        bool cancelled;
        bool refundedA;
        bool refundedB;
        ebool choiceA;
        ebool choiceB;
        euint64 paidA;
        euint64 paidB;
        euint64 payoutA;
        euint64 payoutB;
    }

    uint48 public constant TIMEOUT = 1 days;

    IERC7984 public immutable token;
    uint256 public duelCount;
    mapping(uint256 => Duel) private _duels;

    event DuelCreated(uint256 indexed id, address indexed playerA, address indexed playerB, uint64 stake);
    event ChoiceLocked(uint256 indexed id, address indexed player);
    event DuelSettled(uint256 indexed id);
    event DuelCancelled(uint256 indexed id, address indexed by);

    constructor(IERC7984 token_) {
        token = token_;
    }

    function createDuel(address opponent, uint64 stake) external returns (uint256 id) {
        require(opponent != address(0) && opponent != msg.sender, "Invalid opponent");
        require(stake > 0 && stake <= type(uint64).max / 2, "Invalid stake");
        id = ++duelCount;
        Duel storage d = _duels[id];
        d.playerA = msg.sender;
        d.playerB = opponent;
        d.stake = stake;
        d.createdAt = uint48(block.timestamp);
        emit DuelCreated(id, msg.sender, opponent, stake);
    }

    /// @notice Pay your stake and lock in your encrypted choice (true = steal, false = split).
    function play(uint256 id, externalEbool input, bytes calldata inputProof) external {
        Duel storage d = _duels[id];
        require(d.playerA != address(0), "Duel not found");
        require(!d.settled && !d.cancelled, "Duel closed");

        bool isA = msg.sender == d.playerA;
        require(isA || msg.sender == d.playerB, "Not a player");
        require(isA ? !d.playedA : !d.playedB, "Already played");

        ebool choice = FHE.fromExternal(input, inputProof);
        FHE.allowThis(choice);

        // Pull the stake. The token silently transfers 0 if the player is short,
        // so we keep the amount that really moved.
        euint64 stakeEnc = FHE.asEuint64(d.stake);
        FHE.allowTransient(stakeEnc, address(token));
        euint64 paid = token.confidentialTransferFrom(msg.sender, address(this), stakeEnc);
        FHE.allowThis(paid);

        if (isA) {
            d.choiceA = choice;
            d.paidA = paid;
            d.playedA = true;
        } else {
            d.choiceB = choice;
            d.paidB = paid;
            d.playedB = true;
        }
        emit ChoiceLocked(id, msg.sender);

        if (d.playedA && d.playedB) {
            _settle(id, d);
        }
    }

    /// @notice If the opponent never plays, take your stake back after the timeout.
    function claimRefund(uint256 id) external {
        Duel storage d = _duels[id];
        require(d.playerA != address(0), "Duel not found");
        require(!d.settled, "Already settled");
        require(block.timestamp >= uint256(d.createdAt) + TIMEOUT, "Too early");

        euint64 paid;
        if (msg.sender == d.playerA) {
            require(d.playedA && !d.refundedA, "Nothing to refund");
            d.refundedA = true;
            paid = d.paidA;
        } else if (msg.sender == d.playerB) {
            require(d.playedB && !d.refundedB, "Nothing to refund");
            d.refundedB = true;
            paid = d.paidB;
        } else {
            revert("Not a player");
        }

        if (!d.cancelled) {
            d.cancelled = true;
            emit DuelCancelled(id, msg.sender);
        }

        FHE.allowTransient(paid, address(token));
        token.confidentialTransfer(msg.sender, paid);
    }

    /// @notice Encrypted payout handle for a player (only that player can decrypt it).
    function payoutOf(uint256 id, address player) external view returns (euint64) {
        Duel storage d = _duels[id];
        if (player == d.playerA) return d.payoutA;
        if (player == d.playerB) return d.payoutB;
        revert("Not a player");
    }

    function duelInfo(uint256 id)
        external
        view
        returns (address playerA, address playerB, uint64 stake, bool playedA, bool playedB, bool settled, bool cancelled)
    {
        Duel storage d = _duels[id];
        return (d.playerA, d.playerB, d.stake, d.playedA, d.playedB, d.settled, d.cancelled);
    }

    function _settle(uint256 id, Duel storage d) private {
        d.settled = true;

        euint64 zero = FHE.asEuint64(0);
        euint64 one = FHE.asEuint64(d.stake);
        euint64 two = FHE.asEuint64(d.stake * 2);

        // Both stakes really arrived?
        ebool funded = FHE.and(FHE.eq(d.paidA, one), FHE.eq(d.paidB, one));

        euint64 winA = FHE.select(
            d.choiceA,
            FHE.select(d.choiceB, zero, two),
            FHE.select(d.choiceB, zero, one)
        );
        euint64 winB = FHE.select(
            d.choiceB,
            FHE.select(d.choiceA, zero, two),
            FHE.select(d.choiceA, zero, one)
        );

        // Not funded: refund whatever each player actually paid.
        d.payoutA = FHE.select(funded, winA, d.paidA);
        d.payoutB = FHE.select(funded, winB, d.paidB);

        FHE.allowThis(d.payoutA);
        FHE.allowThis(d.payoutB);
        FHE.allow(d.payoutA, d.playerA);
        FHE.allow(d.payoutB, d.playerB);

        FHE.allowTransient(d.payoutA, address(token));
        token.confidentialTransfer(d.playerA, d.payoutA);
        FHE.allowTransient(d.payoutB, address(token));
        token.confidentialTransfer(d.playerB, d.payoutB);

        emit DuelSettled(id);
    }
}