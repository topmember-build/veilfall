import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { Veilfall, Veilfall__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const VILLAGER = 0;
const KILLER = 1;
const DOCTOR = 2;
const NOBODY = 255;

const Phase = { Lobby: 0, Night: 1, NightReveal: 2, Day: 3, DayReveal: 4, Ended: 5 };
const Winner = { None: 0, Villagers: 1, Killer: 2 };

describe("Veilfall", function () {
  let players: HardhatEthersSigner[];
  let game: Veilfall;
  let gameAddress: string;

  before(async function () {
    players = (await ethers.getSigners()).slice(1, 6);
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    game = (await (await ethers.getContractFactory("Veilfall") as Veilfall__factory).deploy()) as Veilfall;
    gameAddress = await game.getAddress();
  });

  // ---------------------------------------------------------------- helpers

  async function startGame(): Promise<number> {
    await (await game.connect(players[0]).createGame()).wait();
    const id = Number(await game.gameCount());
    for (let i = 1; i < 5; i++) await (await game.connect(players[i]).join(id)).wait();
    return id;
  }

  async function allRoles(id: number): Promise<number[]> {
    const roles: number[] = [];
    for (const p of players) {
      const handle = await game.roleOf(id, p.address);
      roles.push(Number(await fhevm.userDecryptEuint(FhevmType.euint8, handle, gameAddress, p)));
    }
    return roles;
  }

  async function forceAfterTimeout(id: number) {
    await ethers.provider.send("evm_increaseTime", [10 * 60 + 5]);
    await ethers.provider.send("evm_mine", []);
    await (await game.forceResolve(id)).wait();
  }

  async function night(
    id: number,
    kill: number,
    save: number,
    roles: number[],
    opts: { skip?: number[]; force?: boolean } = {},
  ) {
    const info = await game.gameInfo(id);
    for (let i = 0; i < 5; i++) {
      if (!info.alive[i] || opts.skip?.includes(i)) continue;
      // Villagers submit decoys; the contract must ignore them.
      const target = roles[i] === KILLER ? kill : roles[i] === DOCTOR ? save : (i + 1) % 5;
      const enc = await fhevm.createEncryptedInput(gameAddress, players[i].address).add8(target).encrypt();
      await (await game.connect(players[i]).submitNightAction(id, enc.handles[0], enc.inputProof)).wait();
    }
    if (opts.force) await forceAfterTimeout(id);
    await reveal(id, "night");
  }

  async function vote(id: number, votes: Record<number, number>, force = false) {
    for (const [voter, target] of Object.entries(votes)) {
      const enc = await fhevm.createEncryptedInput(gameAddress, players[+voter].address).add8(target).encrypt();
      await (await game.connect(players[+voter]).submitVote(id, enc.handles[0], enc.inputProof)).wait();
    }
    if (force) await forceAfterTimeout(id);
    await reveal(id, "day");
  }

  async function reveal(id: number, kind: "night" | "day") {
    const [seat, role] = await game.pendingHandles(id);
    const res = await fhevm.publicDecrypt([seat, role]);
    const fn = kind === "night" ? game.revealNight : game.revealDay;
    await (await fn(id, res.abiEncodedClearValues, res.decryptionProof)).wait();
  }

  function pick(roles: number[], role: number, skip: number[] = []): number {
    return roles.findIndex((r, i) => r === role && !skip.includes(i));
  }

  // ------------------------------------------------------------------ tests

  it("deals exactly one Killer, one Doctor and three Villagers", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    expect(roles.filter((r) => r === KILLER).length).to.eq(1);
    expect(roles.filter((r) => r === DOCTOR).length).to.eq(1);
    expect(roles.filter((r) => r === VILLAGER).length).to.eq(3);
    expect(Number((await game.gameInfo(id)).phase)).to.eq(Phase.Night);
  });

  it("role dealing is random across games", async function () {
    const killerSeats = new Set<number>();
    for (let n = 0; n < 8; n++) {
      const id = await startGame();
      killerSeats.add((await allRoles(id)).indexOf(KILLER));
    }
    expect(killerSeats.size).to.be.greaterThan(1);
  });

  it("you cannot read another player's role while the game is running", async function () {
    const id = await startGame();
    const handle = await game.roleOf(id, players[1].address);
    await expect(fhevm.userDecryptEuint(FhevmType.euint8, handle, gameAddress, players[0])).to.be.rejected;
  });

  it("night: Killer's target dies and its role is revealed; decoys are ignored", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const v = pick(roles, VILLAGER);
    await night(id, v, pick(roles, VILLAGER, [v]), roles);
    const info = await game.gameInfo(id);
    expect(Number(info.phase)).to.eq(Phase.Day);
    expect(Number(info.lastDeadSeat)).to.eq(v);
    expect(info.alive[v]).to.eq(false);
  });

  it("night: the Doctor saves the Killer's target", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const v = pick(roles, VILLAGER);
    await night(id, v, v, roles);
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(NOBODY);
    expect(info.alive.every((a: boolean) => a)).to.eq(true);
  });

  it("night: an out-of-range Killer target kills nobody", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    await night(id, 200, 0, roles);
    expect(Number((await game.gameInfo(id)).lastDeadSeat)).to.eq(NOBODY);
  });

  it("Villagers win by voting out the Killer, and every role becomes verifiable", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const k = pick(roles, KILLER);
    const v = pick(roles, VILLAGER);
    await night(id, v, pick(roles, VILLAGER, [v]), roles);

    const votes: Record<number, number> = {};
    for (let i = 0; i < 5; i++) if (i !== v) votes[i] = k;
    await vote(id, votes);

    const info = await game.gameInfo(id);
    expect(Number(info.phase)).to.eq(Phase.Ended);
    expect(Number(info.winner)).to.eq(Winner.Villagers);

    // Anyone can now check the roles that were dealt.
    const handle = await game.roleOf(id, players[k].address);
    const res = await fhevm.publicDecrypt([handle]);
    expect(Number(res.clearValues[handle as `0x${string}`])).to.eq(KILLER);
  });

  it("Killer wins when only two players are left", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const k = pick(roles, KILLER);
    const d = pick(roles, DOCTOR);
    const v1 = pick(roles, VILLAGER);
    const v2 = pick(roles, VILLAGER, [v1]);
    const v3 = pick(roles, VILLAGER, [v1, v2]);

    await night(id, v1, v2, roles); // v1 dies
    await vote(id, { [k]: v2, [d]: v2, [v2]: k, [v3]: v2 }); // v2 voted out (3 votes vs 1)
    expect(Number((await game.gameInfo(id)).phase)).to.eq(Phase.Night);

    await night(id, v3, d, roles); // v3 dies, only Killer and Doctor remain
    const info = await game.gameInfo(id);
    expect(Number(info.phase)).to.eq(Phase.Ended);
    expect(Number(info.winner)).to.eq(Winner.Killer);
  });

  it("a tied vote eliminates nobody and the next night begins", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const v1 = pick(roles, VILLAGER);
    const a = pick(roles, VILLAGER, [v1]);
    const b = pick(roles, VILLAGER, [v1, a]);
    const k = pick(roles, KILLER);
    const d = pick(roles, DOCTOR);

    await night(id, v1, a, roles);
    await vote(id, { [k]: a, [d]: b, [a]: b, [b]: a }); // 2 votes each
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(NOBODY);
    expect(Number(info.phase)).to.eq(Phase.Night);
    expect(Number(info.round)).to.eq(1);
  });

  it("a dead Doctor cannot save anyone (even seat 0)", async function () {
    // Needs a game where seat 0 is a Villager (3 in 5 games): the default "save target" is 0.
    let id = 0;
    let roles: number[] = [];
    for (let attempt = 0; attempt < 15; attempt++) {
      id = await startGame();
      roles = await allRoles(id);
      if (roles[0] === VILLAGER) break;
    }
    expect(roles[0]).to.eq(VILLAGER);

    const k = pick(roles, KILLER);
    const d = pick(roles, DOCTOR);
    const others = [0, 1, 2, 3, 4].filter((i) => i !== k && i !== d);

    // Night 1: Killer kills the Doctor, who tries to save a Villager instead.
    await night(id, d, others[1], roles);
    expect((await game.gameInfo(id)).alive[d]).to.eq(false);

    // Day: everyone votes for a different person -> tie, nobody eliminated.
    const alive = [0, 1, 2, 3, 4].filter((i) => i !== d);
    const votes: Record<number, number> = {};
    alive.forEach((voter, n) => (votes[voter] = alive[(n + 1) % alive.length]));
    await vote(id, votes);
    expect(Number((await game.gameInfo(id)).phase)).to.eq(Phase.Night);

    // Night 2: Killer targets seat 0. With no Doctor alive, seat 0 must die.
    await night(id, 0, 0, roles);
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(0);
    expect(info.alive[0]).to.eq(false);
  });

  // ------------------------------------------------------- stall protection

  async function gameWithVillagerAtSeat0(): Promise<{ id: number; roles: number[] }> {
    for (let attempt = 0; attempt < 15; attempt++) {
      const id = await startGame();
      const roles = await allRoles(id);
      if (roles[0] === VILLAGER) return { id, roles };
    }
    throw new Error("could not get a Villager at seat 0");
  }

  it("stall: a Killer who never acts kills nobody (seat 0 is not killed by default)", async function () {
    const { id, roles } = await gameWithVillagerAtSeat0();
    const k = pick(roles, KILLER);
    // The Doctor protects seat 1, so a default kill of seat 0 would NOT be masked by a save.
    await night(id, 0, 1, roles, { skip: [k], force: true });
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(NOBODY);
    expect(info.alive.every((a: boolean) => a)).to.eq(true);
    expect(Number(info.phase)).to.eq(Phase.Day);
  });

  it("stall: a Doctor who never acts saves nobody (seat 0 is not saved by default)", async function () {
    const { id, roles } = await gameWithVillagerAtSeat0();
    const d = pick(roles, DOCTOR);
    await night(id, 0, 0, roles, { skip: [d], force: true });
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(0);
    expect(info.alive[0]).to.eq(false);
  });

  it("stall: if nobody acts, the forced night kills nobody", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    await night(id, 0, 0, roles, { skip: [0, 1, 2, 3, 4], force: true });
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(NOBODY);
    expect(Number(info.phase)).to.eq(Phase.Day);
  });

  it("stall: missing voters abstain and the votes that arrived still count", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    const k = pick(roles, KILLER);
    const v1 = pick(roles, VILLAGER);
    const v2 = pick(roles, VILLAGER, [v1]);
    const v3 = pick(roles, VILLAGER, [v1, v2]);

    await night(id, v1, v1, roles); // the Doctor saves v1: nobody dies
    await vote(id, { [v2]: v1, [v3]: v1 }, true); // only two of five vote, then the timeout passes
    const info = await game.gameInfo(id);
    expect(Number(info.lastDeadSeat)).to.eq(v1);
    expect(info.alive[v1]).to.eq(false);
    expect(info.alive[k]).to.eq(true);
  });

  it("stall: forceResolve is refused too early, in the lobby and after resolution", async function () {
    await (await game.connect(players[0]).createGame()).wait();
    const lobbyId = Number(await game.gameCount());
    await expect(game.forceResolve(lobbyId)).to.be.revertedWith("Nothing to force");

    const id = await startGame();
    await expect(game.forceResolve(id)).to.be.revertedWith("Too early");
    await ethers.provider.send("evm_increaseTime", [10 * 60 + 5]);
    await ethers.provider.send("evm_mine", []);
    await (await game.forceResolve(id)).wait();
    await expect(game.forceResolve(id)).to.be.revertedWith("Nothing to force");
  });

  it("actionStatus shows who has acted and the deadline", async function () {
    const id = await startGame();
    const roles = await allRoles(id);
    let st = await game.actionStatus(id);
    expect(Number(st.acted)).to.eq(0);
    const enc = await fhevm.createEncryptedInput(gameAddress, players[2].address).add8(1).encrypt();
    await (await game.connect(players[2]).submitNightAction(id, enc.handles[0], enc.inputProof)).wait();
    st = await game.actionStatus(id);
    expect(Number(st.acted)).to.eq(1);
    expect(st.hasActed[2]).to.eq(true);
    expect(st.hasActed[0]).to.eq(false);
    expect(Number(st.deadline)).to.be.greaterThan(0);
    void roles;
  });

  it("rejects wrong-phase actions, double actions, outsiders and early reveals", async function () {
    const id = await startGame();
    const enc = await fhevm.createEncryptedInput(gameAddress, players[0].address).add8(1).encrypt();
    await expect(game.connect(players[0]).submitVote(id, enc.handles[0], enc.inputProof)).to.be.revertedWith("Not day");

    await (await game.connect(players[0]).submitNightAction(id, enc.handles[0], enc.inputProof)).wait();
    const enc2 = await fhevm.createEncryptedInput(gameAddress, players[0].address).add8(1).encrypt();
    await expect(game.connect(players[0]).submitNightAction(id, enc2.handles[0], enc2.inputProof)).to.be.revertedWith(
      "Already acted",
    );
    const outsider = (await ethers.getSigners())[7];
    const enc3 = await fhevm.createEncryptedInput(gameAddress, outsider.address).add8(1).encrypt();
    await expect(game.connect(outsider).submitNightAction(id, enc3.handles[0], enc3.inputProof)).to.be.revertedWith(
      "Not a player",
    );
    await expect(game.revealNight(id, "0x", "0x")).to.be.revertedWith("Nothing to reveal");
    await expect(game.revealDay(id, "0x", "0x")).to.be.revertedWith("Nothing to reveal");
  });
});
