import { Contract, JsonRpcProvider, Wallet, formatEther, getAddress, parseEther } from "ethers";
import { VEILFALL_ABI } from "./abi";
import { CHAIN_ID, CONTRACT_ADDRESS, FALLBACK_RPC, GAS_CAP, GAS_MARGIN_PERCENT, SEATS } from "./config";
import type { ChainClient } from "./chainClient";
import { PHASES, ROLES, RoleName } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

const STORAGE_KEY = "veilfall:bots:v1";
const BOT_COUNT = SEATS - 1;
/** Each bot is topped up to this much Sepolia ETH, but only when it has fallen below LOW. Leftovers are reused. */
const TARGET = parseEther("0.015");
const LOW = parseEther("0.008");
/** The first bot also pays the gas for sending ETH on to the others. */
const BANK_BUFFER = parseEther("0.003");
const TICK_MS = 4000;
const REVEAL_DELAY_MS = 9000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

async function sendTx(c: Contract, method: string, args: unknown[]): Promise<void> {
  const fn = c.getFunction(method);
  const estimate: bigint = await fn.estimateGas(...args);
  let gasLimit = (estimate * GAS_MARGIN_PERCENT) / 100n;
  if (gasLimit > GAS_CAP) gasLimit = GAS_CAP;
  const tx = await fn(...args, { gasLimit });
  await tx.wait();
}

/**
 * Solo mode: four opponents that are real wallets playing real transactions on Sepolia.
 * Their keys are throwaway testnet keys kept in this browser. Each bot decrypts only its own role,
 * exactly like any other player, and plays by the same rules.
 */
export class SoloBots {
  private provider = new JsonRpcProvider(FALLBACK_RPC, CHAIN_ID, { staticNetwork: true });
  private wallets: Wallet[] = [];
  private contracts: Contract[] = [];
  private view: Contract;
  private roles = new Map<string, RoleName>();
  private busy = new Set<number | "reveal">();
  private cooldown = new Map<number | "reveal", number>();
  private revealKey = "";
  private revealSince = 0;
  private runToken = 0;

  constructor(
    private chain: ChainClient,
    private note: (message: string) => void,
  ) {
    this.view = new Contract(CONTRACT_ADDRESS, VEILFALL_ABI, this.provider);
  }

  // ------------------------------------------------------------ wallets

  /** Loads the saved bot wallets; creates them only when asked to. Returns false if there are none. */
  private load(create: boolean): boolean {
    if (this.wallets.length) return true;
    let keys: string[] = [];
    try {
      keys = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    } catch {
      keys = [];
    }
    if (keys.length !== BOT_COUNT) {
      if (!create) return false;
      keys = Array.from({ length: BOT_COUNT }, () => Wallet.createRandom().privateKey);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
      } catch {
        throw new Error("This browser blocks local storage, so solo mode cannot keep its bot wallets. Allow site data and retry.");
      }
    }
    this.wallets = keys.map((k) => new Wallet(k, this.provider));
    this.contracts = this.wallets.map((w) => new Contract(CONTRACT_ADDRESS, VEILFALL_ABI, w));
    return true;
  }

  get bankAddress(): string {
    return this.wallets[0].address;
  }

  private botAddresses(): string[] {
    return this.wallets.map((w) => getAddress(w.address));
  }

  // ------------------------------------------------------------ funding

  /** One wallet confirmation from the player funds all four bots; the first bot sends ETH on to the rest. */
  async ensureFunded(): Promise<void> {
    this.load(true);
    const balances = await Promise.all(this.wallets.map((w) => this.provider.getBalance(w.address)));
    const deficits = balances.map((b) => (b < LOW ? TARGET - b : 0n));
    const forOthers = deficits.slice(1).reduce((a, b) => a + b, 0n);
    // The first bot keeps its own share and also pays for forwarding ETH to the others.
    const send = deficits[0] + (forOthers > 0n ? forOthers + BANK_BUFFER : 0n);
    if (send === 0n) return;

    this.note(`Fund your four opponents: confirm sending ${formatEther(send)} Sepolia ETH in your wallet (one time, leftovers are reused).`);
    await this.chain.sendEth(this.wallets[0].address, send);

    for (let i = 1; i < this.wallets.length; i++) {
      if (deficits[i] <= 0n) continue;
      this.note(`Giving opponent ${i + 1} its gas money…`);
      const tx = await this.wallets[0].sendTransaction({ to: this.wallets[i].address, value: deficits[i] });
      await tx.wait();
    }
    this.note("");
  }

  /**
   * All four bots take a seat. The fifth join deals the roles.
   * Safe to call again: bots that are already seated are skipped. The public node the bots read from can
   * lag a few seconds behind the player's wallet, so each step waits and retries instead of giving up.
   */
  async joinAll(id: number): Promise<void> {
    this.load(true);
    this.note("Your four opponents are taking their seats…");

    // 1. Wait until the bots' node can see the new game.
    for (let k = 0; k < 40; k++) {
      try {
        const info = await this.view.gameInfo(id);
        if (Number(info.joined) > 0) break;
      } catch {
        /* not visible yet */
      }
      await sleep(2000);
    }

    // 2. Each bot joins, retrying on a stale read or a busy node.
    await Promise.all(
      this.contracts.map(async (c, i) => {
        await sleep(i * 800);
        let last: unknown;
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            const info = await this.view.gameInfo(id);
            const seated = [...info.players].some((p: string) => p.toLowerCase() === this.wallets[i].address.toLowerCase());
            if (seated) return;
            await sendTx(c, "join", [id]);
            return;
          } catch (e) {
            last = e;
            await sleep(3000 + attempt * 1000);
          }
        }
        throw last;
      }),
    );
    this.note("");
  }

  // ------------------------------------------------------------ playing

  /** Starts playing if this game is one of ours (the bots' addresses are seated). Returns true when it is. */
  async attach(id: number): Promise<boolean> {
    if (!this.load(false)) return false;
    const info = await this.view.gameInfo(id);
    const seated: string[] = [...info.players].map((p: string) => p.toLowerCase());
    const mine = this.botAddresses().filter((a) => seated.includes(a.toLowerCase()));
    if (mine.length === 0) return false;
    this.run(id);
    return true;
  }

  stop() {
    this.runToken++;
  }

  private run(id: number) {
    const token = ++this.runToken;
    this.busy.clear();
    this.cooldown.clear();
    (async () => {
      while (token === this.runToken) {
        try {
          await this.tick(id, token);
        } catch (e) {
          // A flaky public RPC is normal; the next tick tries again.
          void e;
        }
        await sleep(TICK_MS);
      }
    })();
  }

  private async tick(id: number, token: number) {
    const [info, st] = await Promise.all([this.view.gameInfo(id), this.view.actionStatus(id)]);
    if (token !== this.runToken) return;
    const phase = PHASES[Number(info.phase)];
    if (phase === "Ended") {
      this.note("");
      this.stop();
      return;
    }
    const players: string[] = [...info.players].map((p: string) => p.toLowerCase());
    const alive: boolean[] = [...info.alive].map(Boolean);
    const hasActed: boolean[] = [...st.hasActed].map(Boolean);
    const now = Date.now();

    if (phase === "Night" || phase === "Day") {
      this.revealKey = "";
      this.wallets.forEach((w, i) => {
        const seat = players.indexOf(w.address.toLowerCase());
        if (seat < 0 || !alive[seat] || hasActed[seat]) return;
        if (this.busy.has(i) || (this.cooldown.get(i) ?? 0) > now) return;
        this.busy.add(i);
        this.act(i, id, phase, seat, alive, token)
          .catch((e) => {
            this.cooldown.set(i, Date.now() + 10_000);
            this.note(`Opponent ${i + 1} hit a snag and will retry: ${String((e as any)?.shortMessage ?? (e as any)?.message ?? e).slice(0, 120)}`);
          })
          .finally(() => this.busy.delete(i));
      });
    } else if (phase === "NightReveal" || phase === "DayReveal") {
      const key = `${phase}|${Number(info.round)}`;
      if (this.revealKey !== key) {
        this.revealKey = key;
        this.revealSince = now;
      }
      // Give the player a moment to press "Reveal" themselves; otherwise an opponent does it.
      if (now - this.revealSince > REVEAL_DELAY_MS && !this.busy.has("reveal") && (this.cooldown.get("reveal") ?? 0) <= now) {
        this.busy.add("reveal");
        this.reveal(id, phase)
          .catch(() => this.cooldown.set("reveal", Date.now() + 8000))
          .finally(() => this.busy.delete("reveal"));
      }
    }
  }

  private async myRole(i: number, id: number): Promise<RoleName | null> {
    const wallet = this.wallets[i];
    const cacheKey = `${id}:${wallet.address}`;
    const cached = this.roles.get(cacheKey);
    if (cached) return cached;
    try {
      const handle: string = await this.view.roleOf(id, wallet.address);
      const instance = await this.chain.getFhe();
      const keypair = instance.generateKeypair();
      const start = Math.floor(Date.now() / 1000);
      const eip712 = instance.createEIP712(keypair.publicKey, [CONTRACT_ADDRESS], start, 1);
      const signature = await wallet.signTypedData(
        eip712.domain,
        { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
        eip712.message,
      );
      const result = await instance.userDecrypt(
        [{ handle, contractAddress: CONTRACT_ADDRESS }],
        keypair.privateKey,
        keypair.publicKey,
        signature,
        [CONTRACT_ADDRESS],
        wallet.address,
        start,
        1,
      );
      const role = ROLES[Number(result[handle] ?? result[handle.toLowerCase()])];
      if (role) this.roles.set(cacheKey, role);
      return role ?? null;
    } catch {
      return null; // Not knowing its role only makes a bot play a random decoy, which is still legal.
    }
  }

  private async act(i: number, id: number, phase: "Night" | "Day", seat: number, alive: boolean[], token: number) {
    await sleep(i * 2200 + Math.random() * 1500); // stagger so the relayer is not hit all at once
    if (token !== this.runToken) return;
    const role = phase === "Night" ? await this.myRole(i, id) : null;

    const others = alive.map((a, s) => (a && s !== seat ? s : -1)).filter((s) => s >= 0);
    const everyone = alive.map((a, s) => (a ? s : -1)).filter((s) => s >= 0);
    const target = phase === "Night" && role === "Doctor" ? pick(everyone) : pick(others);

    this.note(phase === "Night" ? `Opponent ${i + 1} is making its night move…` : `Opponent ${i + 1} is casting its vote…`);
    const instance = await this.chain.getFhe();
    const input = instance.createEncryptedInput(CONTRACT_ADDRESS, this.wallets[i].address);
    input.add8(target);
    const enc = await input.encrypt();
    await sendTx(this.contracts[i], phase === "Night" ? "submitNightAction" : "submitVote", [id, enc.handles[0], enc.inputProof]);
    this.note(`Opponent ${i + 1} has locked in.`);
  }

  private async reveal(id: number, phase: "NightReveal" | "DayReveal") {
    this.note("An opponent is asking Zama's network to reveal the sealed result…");
    const [seatHandle, roleHandle] = await this.view.pendingHandles(id);
    const instance = await this.chain.getFhe();
    let res: any;
    let last: unknown;
    for (let k = 0; k < 6 && !res; k++) {
      try {
        res = await instance.publicDecrypt([seatHandle, roleHandle]);
      } catch (e) {
        last = e;
        await sleep(4000);
      }
    }
    if (!res) throw last;
    await sendTx(this.contracts[0], phase === "NightReveal" ? "revealNight" : "revealDay", [
      id,
      res.abiEncodedClearValues,
      res.decryptionProof,
    ]);
    this.note("");
  }
}
