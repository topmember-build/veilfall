// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, ebool, euint8, euint16, externalEuint8} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title Veilfall - Mafia with no host
/// @notice Five players: one hidden Killer, one hidden Doctor, three Villagers.
///         The contract is the moderator and it can never peek:
///           - roles are dealt with encrypted on-chain randomness
///           - EVERY living player acts every night (Villagers submit decoys), so nobody
///             can tell who the Killer or Doctor is from who acted
///           - votes are tallied on encrypted data, so nobody sees who voted for whom
///           - the only things ever revealed are who died and the role they held
///           - when the game ends, every role becomes publicly verifiable
/// @dev Role codes: 0 = Villager, 1 = Killer, 2 = Doctor. 255 = nobody.
///      Win rules: Killer eliminated -> Villagers win. Two or fewer alive with the Killer
///      still alive -> Killer wins. A tied vote eliminates nobody.
contract Veilfall is ZamaEthereumConfig {
    uint8 public constant SEATS = 5;
    uint8 public constant NOBODY = 255;

    enum Phase {
        Lobby,
        Night,
        NightReveal,
        Day,
        DayReveal,
        Ended
    }

    enum Winner {
        None,
        Villagers,
        Killer
    }

    struct Game {
        Phase phase;
        Winner winner;
        uint8 joined;
        uint8 acted;
        uint8 round;
        bool killerDead;
        bool doctorDead;
        uint8 lastDeadSeat;
        address[5] players;
        bool[5] alive;
        bool[5] hasActed;
        euint8[5] roles;
        euint8 nightKill;
        euint8 nightSave;
        euint8[5] tally;
        euint8 pendingSeat;
        euint8 pendingRole;
    }

    uint256 public gameCount;
    mapping(uint256 => Game) private _games;

    event GameCreated(uint256 indexed id, address indexed host);
    event PlayerJoined(uint256 indexed id, address indexed player, uint8 seat);
    event RolesDealt(uint256 indexed id);
    event ActionSubmitted(uint256 indexed id, address indexed player, Phase phase);
    /// @dev Handles to publicly decrypt (seat, then role) and pass to the reveal function.
    event ResultReady(uint256 indexed id, Phase phase, bytes32 seatHandle, bytes32 roleHandle);
    event PlayerDied(uint256 indexed id, uint8 seat, uint8 role, bool byVote);
    event NobodyDied(uint256 indexed id, bool byVote);
    event GameEnded(uint256 indexed id, Winner winner);

    // ------------------------------------------------------------------ lobby

    function createGame() external returns (uint256 id) {
        id = ++gameCount;
        Game storage g = _games[id];
        g.players[0] = msg.sender;
        g.alive[0] = true;
        g.joined = 1;
        emit GameCreated(id, msg.sender);
        emit PlayerJoined(id, msg.sender, 0);
    }

    function join(uint256 id) external {
        Game storage g = _games[id];
        require(g.joined > 0, "Game not found");
        require(g.phase == Phase.Lobby && g.joined < SEATS, "Lobby closed");
        for (uint8 i = 0; i < g.joined; i++) {
            require(g.players[i] != msg.sender, "Already joined");
        }
        uint8 seat = g.joined++;
        g.players[seat] = msg.sender;
        g.alive[seat] = true;
        emit PlayerJoined(id, msg.sender, seat);

        if (g.joined == SEATS) {
            _dealRoles(id, g);
            _startNight(g);
        }
    }

    // ------------------------------------------------------------------ night

    /// @notice Submit your encrypted night target (a seat number 0-4). EVERYONE alive must
    ///         submit; only the Killer's and Doctor's choices count, the rest are decoys.
    function submitNightAction(uint256 id, externalEuint8 target, bytes calldata inputProof) external {
        Game storage g = _games[id];
        require(g.phase == Phase.Night, "Not night");
        uint8 seat = _checkActor(g);

        euint8 t = FHE.fromExternal(target, inputProof);
        euint8 zero = FHE.asEuint8(0);
        euint8 role = g.roles[seat];

        // Accumulate on the fly: only the Killer's and Doctor's targets get through.
        g.nightKill = FHE.add(g.nightKill, FHE.select(FHE.eq(role, uint8(1)), t, zero));
        g.nightSave = FHE.add(g.nightSave, FHE.select(FHE.eq(role, uint8(2)), t, zero));
        FHE.allowThis(g.nightKill);
        FHE.allowThis(g.nightSave);

        g.hasActed[seat] = true;
        g.acted++;
        emit ActionSubmitted(id, msg.sender, Phase.Night);

        if (g.acted == _aliveCount(g)) {
            _resolveNight(id, g);
        }
    }

    /// @notice Publish the night result with the KMS proof of its public decryption.
    function revealNight(uint256 id, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Game storage g = _games[id];
        require(g.phase == Phase.NightReveal, "Nothing to reveal");
        (uint8 seat, uint8 role) = _verifyReveal(g, abiEncodedClearValues, decryptionProof);

        _applyDeath(id, g, seat, role, false);
        if (!_checkWin(id, g)) {
            _startDay(g);
        }
    }

    // -------------------------------------------------------------------- day

    /// @notice Cast your encrypted vote (a seat number 0-4). Everyone alive must vote.
    function submitVote(uint256 id, externalEuint8 vote, bytes calldata inputProof) external {
        Game storage g = _games[id];
        require(g.phase == Phase.Day, "Not day");
        uint8 seat = _checkActor(g);

        euint8 v = FHE.fromExternal(vote, inputProof);
        euint8 zero = FHE.asEuint8(0);
        euint8 one = FHE.asEuint8(1);
        for (uint8 j = 0; j < SEATS; j++) {
            if (!g.alive[j]) continue;
            g.tally[j] = FHE.add(g.tally[j], FHE.select(FHE.eq(v, j), one, zero));
            FHE.allowThis(g.tally[j]);
        }

        g.hasActed[seat] = true;
        g.acted++;
        emit ActionSubmitted(id, msg.sender, Phase.Day);

        if (g.acted == _aliveCount(g)) {
            _resolveDay(id, g);
        }
    }

    /// @notice Publish the vote result with the KMS proof of its public decryption.
    function revealDay(uint256 id, bytes calldata abiEncodedClearValues, bytes calldata decryptionProof) external {
        Game storage g = _games[id];
        require(g.phase == Phase.DayReveal, "Nothing to reveal");
        (uint8 seat, uint8 role) = _verifyReveal(g, abiEncodedClearValues, decryptionProof);

        _applyDeath(id, g, seat, role, true);
        if (!_checkWin(id, g)) {
            g.round++;
            _startNight(g);
        }
    }

    // ------------------------------------------------------------------ views

    /// @notice Encrypted role handle for a player. Only that player can decrypt it
    ///         (and everyone can, once the game has ended).
    function roleOf(uint256 id, address player) external view returns (euint8) {
        Game storage g = _games[id];
        return g.roles[_seatOfPlayer(g, player)];
    }

    /// @notice The two handles to publicly decrypt for the current reveal.
    function pendingHandles(uint256 id) external view returns (euint8 seat, euint8 role) {
        Game storage g = _games[id];
        return (g.pendingSeat, g.pendingRole);
    }

    function gameInfo(uint256 id)
        external
        view
        returns (
            Phase phase,
            Winner winner,
            uint8 round,
            uint8 joined,
            address[5] memory players,
            bool[5] memory alive,
            uint8 lastDeadSeat
        )
    {
        Game storage g = _games[id];
        return (g.phase, g.winner, g.round, g.joined, g.players, g.alive, g.lastDeadSeat);
    }

    // -------------------------------------------------------------- internals

    function _dealRoles(uint256 id, Game storage g) private {
        // Killer seat: uniform over 5 seats (65536 mod 5 leaves a bias of ~1 in 65,000).
        euint16 killer = FHE.rem(FHE.randEuint16(), uint16(SEATS));
        // Doctor seat: uniform over the 4 other seats (4 divides 65536, so no bias).
        euint16 offset = FHE.randEuint16(4);
        euint16 doctor = FHE.rem(FHE.add(FHE.add(killer, offset), uint16(1)), uint16(SEATS));

        euint8 villagerRole = FHE.asEuint8(0);
        euint8 killerRole = FHE.asEuint8(1);
        euint8 doctorRole = FHE.asEuint8(2);

        for (uint8 i = 0; i < SEATS; i++) {
            euint8 role = FHE.select(
                FHE.eq(killer, uint16(i)),
                killerRole,
                FHE.select(FHE.eq(doctor, uint16(i)), doctorRole, villagerRole)
            );
            FHE.allowThis(role);
            FHE.allow(role, g.players[i]);
            g.roles[i] = role;
        }
        emit RolesDealt(id);
    }

    function _startNight(Game storage g) private {
        g.phase = Phase.Night;
        g.acted = 0;
        for (uint8 i = 0; i < SEATS; i++) g.hasActed[i] = false;
        g.nightKill = FHE.asEuint8(0);
        g.nightSave = FHE.asEuint8(0);
        FHE.allowThis(g.nightKill);
        FHE.allowThis(g.nightSave);
    }

    function _startDay(Game storage g) private {
        g.phase = Phase.Day;
        g.acted = 0;
        for (uint8 i = 0; i < SEATS; i++) {
            g.hasActed[i] = false;
            g.tally[i] = FHE.asEuint8(0);
            FHE.allowThis(g.tally[i]);
        }
    }

    function _resolveNight(uint256 id, Game storage g) private {
        // The kill only counts if it points at a living seat.
        ebool valid = FHE.asEbool(false);
        for (uint8 j = 0; j < SEATS; j++) {
            if (!g.alive[j]) continue;
            valid = FHE.or(valid, FHE.eq(g.nightKill, j));
        }
        // With a dead Doctor nobody can be saved (otherwise a default save of seat 0 would leak in).
        ebool saved = g.doctorDead ? FHE.asEbool(false) : FHE.eq(g.nightKill, g.nightSave);
        ebool dies = FHE.and(valid, FHE.not(saved));

        euint8 seat = FHE.select(dies, g.nightKill, FHE.asEuint8(NOBODY));
        _publishResult(id, g, seat, Phase.NightReveal);
    }

    function _resolveDay(uint256 id, Game storage g) private {
        // Find the seat with the most votes. A tie (or no votes) means nobody is eliminated.
        euint8 best = FHE.asEuint8(0);
        euint8 bestSeat = FHE.asEuint8(NOBODY);
        ebool tie = FHE.asEbool(false);

        for (uint8 j = 0; j < SEATS; j++) {
            if (!g.alive[j]) continue;
            euint8 c = g.tally[j];
            ebool greater = FHE.gt(c, best);
            ebool equalNonZero = FHE.and(FHE.eq(c, best), FHE.gt(c, uint8(0)));
            tie = FHE.and(FHE.not(greater), FHE.or(tie, equalNonZero));
            bestSeat = FHE.select(greater, FHE.asEuint8(j), bestSeat);
            best = FHE.select(greater, c, best);
        }

        euint8 seat = FHE.select(tie, FHE.asEuint8(NOBODY), bestSeat);
        _publishResult(id, g, seat, Phase.DayReveal);
    }

    /// @dev Marks the (seat, role-of-that-seat) pair as publicly decryptable.
    function _publishResult(uint256 id, Game storage g, euint8 seat, Phase next) private {
        euint8 role = FHE.asEuint8(0);
        for (uint8 j = 0; j < SEATS; j++) {
            role = FHE.add(role, FHE.select(FHE.eq(seat, j), g.roles[j], FHE.asEuint8(0)));
        }
        FHE.allowThis(seat);
        FHE.allowThis(role);
        FHE.makePubliclyDecryptable(seat);
        FHE.makePubliclyDecryptable(role);
        g.pendingSeat = seat;
        g.pendingRole = role;
        g.phase = next;
        emit ResultReady(id, next, FHE.toBytes32(seat), FHE.toBytes32(role));
    }

    function _verifyReveal(
        Game storage g,
        bytes calldata abiEncodedClearValues,
        bytes calldata decryptionProof
    ) private returns (uint8 seat, uint8 role) {
        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(g.pendingSeat);
        handles[1] = FHE.toBytes32(g.pendingRole);
        FHE.checkSignatures(handles, abiEncodedClearValues, decryptionProof);
        (uint256 s, uint256 r) = abi.decode(abiEncodedClearValues, (uint256, uint256));
        return (uint8(s), uint8(r));
    }

    function _applyDeath(uint256 id, Game storage g, uint8 seat, uint8 role, bool byVote) private {
        g.lastDeadSeat = seat;
        if (seat >= SEATS) {
            emit NobodyDied(id, byVote);
            return;
        }
        g.alive[seat] = false;
        if (role == 1) g.killerDead = true;
        if (role == 2) g.doctorDead = true;
        emit PlayerDied(id, seat, role, byVote);
    }

    function _checkWin(uint256 id, Game storage g) private returns (bool ended) {
        if (g.killerDead) {
            g.winner = Winner.Villagers;
        } else if (_aliveCount(g) <= 2) {
            g.winner = Winner.Killer;
        } else {
            return false;
        }

        g.phase = Phase.Ended;
        // Fairness proof: once the game is over, every role can be publicly decrypted and checked.
        for (uint8 i = 0; i < SEATS; i++) {
            FHE.makePubliclyDecryptable(g.roles[i]);
        }
        emit GameEnded(id, g.winner);
        return true;
    }

    function _checkActor(Game storage g) private view returns (uint8 seat) {
        seat = _seatOfPlayer(g, msg.sender);
        require(g.alive[seat], "You are dead");
        require(!g.hasActed[seat], "Already acted");
    }

    function _seatOfPlayer(Game storage g, address player) private view returns (uint8) {
        for (uint8 i = 0; i < g.joined; i++) {
            if (g.players[i] == player) return i;
        }
        revert("Not a player");
    }

    function _aliveCount(Game storage g) private view returns (uint8 n) {
        for (uint8 i = 0; i < SEATS; i++) {
            if (g.alive[i]) n++;
        }
    }
}