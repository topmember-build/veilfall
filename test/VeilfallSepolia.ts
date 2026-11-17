import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm, deployments } from "hardhat";
import { Veilfall } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const VILLAGER = 0;
const KILLER = 1;
const DOCTOR = 2;
const PHASE = { Night: 1, NightReveal: 2, Day: 3, DayReveal: 4, Ended: 5 };
const WINNER_VILLAGERS = 1;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Plays one COMPLETE game of Veilfall on the real Sepolia testnet:
 * join -> hidden roles -> night -> reveal -> day vote -> reveal -> game over -> public role check.
 * Run with:  npx hardhat test test/VeilfallSepolia.ts --network sepolia
 *
 * Free public RPCs are load-balanced and can lag a few seconds behind, so after every
 * transaction the test waits until the new state is actually visible before moving on.
 */
describe("VeilfallSepolia", function () {
  let game: Veilfall;
  let gameAddress: string;
  let players: HardhatEthersSigner[];

  const log = (m: string) => console.log(`  ${m}`);

  /** Wait until the RPC has caught up to a block. */
  async function sync(blockNumber: number) {
    for (let i = 0; i < 60; i++) {
      if ((await ethers.provider.getBlockNumber()) >= blockNumber) break;
      await sleep(2000);
    }
    await sleep(2500);
  }

  /** Send a transaction, wait for it, log its Etherscan link, and wait for the RPC to catch up. */
  async function send(label: string, txPromise: Promise<any>) {
    const tx = await txPromise;
    const receipt = await tx.wait();
    log(`${label}  https://sepolia.etherscan.io/tx/${tx.hash}`);
    await sync(receipt.blockNumber);
    return receipt;
  }

  /** Retry a read until it succeeds and passes the check. */
  async function eventually<T>(label: string, read: () => Promise<T>, ok: (v: T) => boolean = () => true, tries = 45) {
    let lastError: unknown;
    for (let i = 0; i < tries; i++) {
      try {
        const v = await read();
        if (ok(v)) return v;
      } catch (e) {
        lastError = e;
      }
      await sleep(2000);
    }
    throw new Error(`Timed out waiting for: ${label}${lastError ? ` (last error: ${(lastError as Error).message})` : ""}`);
  }

  async function encrypt8(who: HardhatEthersSigner, value: number) {
    return eventually(`encrypt for ${who.address}`, () =>
      fhevm.createEncryptedInput(gameAddress, who.address).add8(value).encrypt(),
      () => true,
      5,
    );
  }

  const phaseIs = (id: number, phase: number) =>
    eventually(`phase ${phase}`, () => game.gameInfo(id), (i) => Number(i.phase) === phase);

  before(async function () {
    this.timeout(10 * 60 * 1000);
    if (fhevm.isMock) {
      console.warn(`This hardhat test suite can only run on Sepolia Testnet`);
      this.skip();
    }
    try {
      const d = await deployments.get("Veilfall");
      gameAddress = d.address;
      game = (await ethers.getContractAt("Veilfall", d.address)) as unknown as Veilfall;
    } catch (e) {
      (e as Error).message += ". Call 'npx hardhat deploy --network sepolia --tags Veilfall'";
      throw e;
    }
    players = (await ethers.getSigners()).slice(0, 5);

    // Top up the four other players from player 0 so each can pay gas.
    const bal0 = await ethers.provider.getBalance(players[0].address);
    log(`Veilfall at ${gameAddress}`);
    log(`Player 0 balance: ${ethers.formatEther(bal0)} ETH`);
    for (let i = 1; i < 5; i++) {
      const bal = await ethers.provider.getBalance(players[i].address);
      if (bal < ethers.parseEther("0.005")) {
        await send(
          `Fund player ${i}`,
          players[0].sendTransaction({ to: players[i].address, value: ethers.parseEther("0.01") }),
        );
      }
    }
  });

  it("plays a full game to the end", async function () {
    this.timeout(30 * 60 * 1000);

    // ---- lobby (the game id comes from the event, not from a possibly-stale read)
    const created = await send("createGame", game.connect(players[0]).createGame());
    const parsed = created.logs
      .map((l: any) => {
        try {
          return game.interface.parseLog(l);
        } catch {
          return null;
        }
      })
      .find((p: any) => p?.name === "GameCreated");
    const id = Number(parsed!.args.id);
    log(`Game #${id} created`);

    for (let i = 1; i < 5; i++) {
      await send(`join (player ${i})`, game.connect(players[i]).join(id));
      await eventually(`player ${i} joined`, () => game.gameInfo(id), (inf) => Number(inf.joined) === i + 1);
    }
    await phaseIs(id, PHASE.Night);
    log("Roles dealt, night has begun");

    // ---- everyone reads their own secret role
    const roles: number[] = [];
    for (let i = 0; i < 5; i++) {
      const handle = await eventually(
        `role handle ${i}`,
        () => game.roleOf(id, players[i].address),
        (h) => h !== ethers.ZeroHash,
      );
      const role = await eventually(`decrypt role ${i}`, () =>
        fhevm.userDecryptEuint(FhevmType.euint8, handle, gameAddress, players[i]),
      );
      roles.push(Number(role));
    }
    log(`Secret roles (only for this test log): ${roles.map((r) => ["Villager", "Killer", "Doctor"][r]).join(", ")}`);
    expect(roles.filter((r) => r === KILLER).length).to.eq(1);
    expect(roles.filter((r) => r === DOCTOR).length).to.eq(1);

    const killer = roles.indexOf(KILLER);
    const victim = roles.indexOf(VILLAGER);

    // ---- night 1: everybody acts; the Killer targets a Villager
    for (let i = 0; i < 5; i++) {
      const target = roles[i] === KILLER ? victim : roles[i] === DOCTOR ? killer : (i + 1) % 5;
      const enc = await encrypt8(players[i], target);
      await send(
        `night action (player ${i})`,
        game.connect(players[i]).submitNightAction(id, enc.handles[0], enc.inputProof),
      );
    }
    await phaseIs(id, PHASE.NightReveal);
    let [seatHandle, roleHandle] = await eventually(
      "night handles",
      () => game.pendingHandles(id),
      (h) => h[0] !== ethers.ZeroHash,
    );
    let res = await eventually("public decrypt (night)", () => fhevm.publicDecrypt([seatHandle, roleHandle]));
    await send("revealNight", game.revealNight(id, res.abiEncodedClearValues, res.decryptionProof));
    let info = await eventually("night revealed", () => game.gameInfo(id), (inf) => Number(inf.phase) === PHASE.Day);
    log(`Night result: seat ${info.lastDeadSeat} died`);
    expect(Number(info.lastDeadSeat)).to.eq(victim);

    // ---- day 1: all living players vote out the Killer
    for (let i = 0; i < 5; i++) {
      if (i === victim) continue;
      const enc = await encrypt8(players[i], killer);
      await send(`vote (player ${i})`, game.connect(players[i]).submitVote(id, enc.handles[0], enc.inputProof));
    }
    await phaseIs(id, PHASE.DayReveal);
    [seatHandle, roleHandle] = await eventually(
      "day handles",
      () => game.pendingHandles(id),
      (h) => h[0] !== ethers.ZeroHash,
    );
    res = await eventually("public decrypt (day)", () => fhevm.publicDecrypt([seatHandle, roleHandle]));
    await send("revealDay", game.revealDay(id, res.abiEncodedClearValues, res.decryptionProof));

    info = await eventually("game ended", () => game.gameInfo(id), (inf) => Number(inf.phase) === PHASE.Ended);
    expect(Number(info.winner)).to.eq(WINNER_VILLAGERS);
    log("Game over: Villagers win");

    // ---- fairness proof: anyone can now decrypt every role
    const handles: string[] = [];
    for (let i = 0; i < 5; i++) handles.push(await game.roleOf(id, players[i].address));
    const all = await eventually("public role check", () => fhevm.publicDecrypt(handles));
    handles.forEach((h, i) => expect(Number(all.clearValues[h as `0x${string}`])).to.eq(roles[i]));
    log("All five roles verified publicly after the game");
  });
});