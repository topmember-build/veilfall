import { BrowserProvider, Contract, JsonRpcSigner, ZeroAddress, getAddress } from "ethers";
import { VEILFALL_ABI } from "./abi";
import {
  CHAIN_ID,
  CHAIN_ID_HEX,
  CONTRACT_ADDRESS,
  EXPLORER,
  FALLBACK_RPC,
  GAS_CAP,
  GAS_MARGIN_PERCENT,
  SEATS,
} from "./config";
import {
  GameClient,
  GameState,
  GameSummary,
  HistoryItem,
  PHASES,
  ROLES,
  RoleName,
  WINNERS,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    ethereum?: any;
    relayerSDK?: any;
  }
}

const SDK_SCRIPT = "/relayer-sdk/relayer-sdk-js.umd.js";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadSdkScript(): Promise<any> {
  if (window.relayerSDK) return Promise.resolve(window.relayerSDK);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_SCRIPT;
    s.async = true;
    s.onload = () =>
      window.relayerSDK
        ? resolve(window.relayerSDK)
        : reject(new Error("The Zama SDK loaded but did not register itself (window.relayerSDK is missing)."));
    s.onerror = () => reject(new Error(`Could not load the Zama SDK from ${SDK_SCRIPT}. Did you run npm install?`));
    document.head.appendChild(s);
  });
}

/** Turns wallet / ethers / contract errors into one readable sentence. */
export function friendlyError(e: unknown): string {
  const err = e as any;
  if (err?.code === 4001 || err?.code === "ACTION_REJECTED" || /user rejected|user denied/i.test(err?.message ?? "")) {
    return "You rejected the request in your wallet.";
  }
  const reason: string | undefined = err?.reason || err?.revert?.args?.[0] || err?.info?.error?.message;
  if (reason && typeof reason === "string") return reason.replace(/^execution reverted:?\s*/i, "");
  const short: string | undefined = err?.shortMessage || err?.message;
  return (short ?? String(e)).slice(0, 300);
}

export class ChainClient implements GameClient {
  readonly mode = "chain" as const;
  address: string | null = null;
  lastTxUrl: string | null = null;

  private provider: BrowserProvider | null = null;
  private signer: JsonRpcSigner | null = null;
  private contract: Contract | null = null;
  private fhePromise: Promise<any> | null = null;
  private status: (m: string) => void = () => {};

  /** The wallet the player picked; falls back to whatever the browser injects. */
  constructor(private chosen: any = null) {}

  private get eth(): any {
    return this.chosen ?? window.ethereum ?? window.okxwallet;
  }

  setStatusListener(fn: (message: string) => void) {
    this.status = fn;
  }

  // ------------------------------------------------------------ wallet

  async connect(): Promise<string> {
    const eth = this.eth;
    if (!eth) {
      throw new Error("No wallet found. Install MetaMask or OKX Wallet, make sure it is enabled for this site, and refresh.");
    }
    this.status("Connecting your wallet…");
    await eth.request({ method: "eth_requestAccounts" });
    await this.ensureSepolia();

    this.provider = new BrowserProvider(eth);
    this.signer = await this.provider.getSigner();
    this.address = getAddress(await this.signer.getAddress());
    this.contract = new Contract(CONTRACT_ADDRESS, VEILFALL_ABI, this.signer);

    // Any account or network change: simplest and safest is to start fresh.
    eth.on?.("accountsChanged", () => window.location.reload());
    eth.on?.("chainChanged", () => window.location.reload());
    return this.address;
  }

  private async ensureSepolia() {
    const current = await this.eth.request({ method: "eth_chainId" });
    if (parseInt(current, 16) === CHAIN_ID) return;
    this.status("Switching your wallet to Sepolia…");
    try {
      await this.eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CHAIN_ID_HEX }] });
    } catch (e: any) {
      if (e?.code === 4902) {
        await this.eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: CHAIN_ID_HEX,
              chainName: "Sepolia",
              nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: [FALLBACK_RPC],
              blockExplorerUrls: [EXPLORER],
            },
          ],
        });
      } else {
        throw e;
      }
    }
  }

  private need(): { contract: Contract; address: string } {
    if (!this.contract || !this.address) throw new Error("Connect your wallet first.");
    return { contract: this.contract, address: this.address };
  }

  // ------------------------------------------------------ Zama encryption

  /** Shared with solo mode so the opponents can reuse the same encryption engine. */
  getFhe(): Promise<any> {
    return this.fhe();
  }

  /** A plain ETH transfer from the player's wallet (used once to fund the solo opponents). */
  async sendEth(to: string, wei: bigint): Promise<void> {
    if (!this.signer) throw new Error("Connect your wallet first.");
    const tx = await this.signer.sendTransaction({ to, value: wei });
    this.lastTxUrl = `${EXPLORER}/tx/${tx.hash}`;
    this.status("Waiting for Sepolia to confirm the transfer…");
    await tx.wait();
    this.status("");
  }

  private fhe(): Promise<any> {
    if (!this.fhePromise) {
      this.fhePromise = (async () => {
        this.status("Loading Zama's encryption engine (a few seconds the first time)…");
        const sdk = await loadSdkScript();
        await sdk.initSDK();
        return sdk.createInstance({ ...sdk.SepoliaConfig, network: this.eth });
      })().catch((e) => {
        this.fhePromise = null;
        throw e;
      });
    }
    return this.fhePromise;
  }

  private async encrypt8(value: number): Promise<{ handle: Uint8Array; proof: Uint8Array }> {
    const { address } = this.need();
    const instance = await this.fhe();
    this.status("Encrypting your move in the browser…");
    const input = instance.createEncryptedInput(CONTRACT_ADDRESS, address);
    input.add8(value);
    const enc = await input.encrypt();
    return { handle: enc.handles[0], proof: enc.inputProof };
  }

  /** Public decryption with a few retries (the network can take a moment to allow it). */
  private async publicDecrypt(handles: string[]): Promise<any> {
    const instance = await this.fhe();
    let last: unknown;
    for (let i = 0; i < 6; i++) {
      try {
        this.status(i === 0 ? "Asking Zama's network to decrypt the sealed result…" : "Still waiting for the decryption…");
        return await instance.publicDecrypt(handles);
      } catch (e) {
        last = e;
        await sleep(4000);
      }
    }
    throw last;
  }

  // ----------------------------------------------------------- sending txs

  private async send(label: string, method: string, args: unknown[]): Promise<any> {
    const { contract } = this.need();
    const fn = contract.getFunction(method);
    this.status(`${label}: checking the transaction…`);
    const estimate: bigint = await fn.estimateGas(...args);
    let gasLimit = (estimate * GAS_MARGIN_PERCENT) / 100n;
    if (gasLimit > GAS_CAP) gasLimit = GAS_CAP;
    this.status(`${label}: confirm in your wallet…`);
    const tx = await fn(...args, { gasLimit });
    this.lastTxUrl = `${EXPLORER}/tx/${tx.hash}`;
    this.status(`${label}: waiting for Sepolia to confirm (about 15 seconds)…`);
    const receipt = await tx.wait();
    this.status("");
    return receipt;
  }

  // -------------------------------------------------------------- reads

  async getState(id: number): Promise<GameState> {
    const { contract, address } = this.need();
    const [info, st] = await Promise.all([contract.gameInfo(id), contract.actionStatus(id)]);
    if (Number(info.joined) === 0) throw new Error(`Game #${id} does not exist.`);
    const players: string[] = [...info.players].map((p: string) => (p === ZeroAddress ? "" : getAddress(p)));
    const mySeat = players.findIndex((p) => p && p.toLowerCase() === address.toLowerCase());
    return {
      id,
      phase: PHASES[Number(info.phase)],
      winner: WINNERS[Number(info.winner)],
      round: Number(info.round),
      joined: Number(info.joined),
      players,
      alive: [...info.alive].map(Boolean),
      lastDeadSeat: Number(info.lastDeadSeat),
      acted: Number(st.acted),
      hasActed: [...st.hasActed].map(Boolean),
      deadline: Number(st.deadline),
      mySeat,
    };
  }

  /** The most recent games, newest first, for the lobby and "my games" lists. */
  async listGames(max = 30): Promise<GameSummary[]> {
    const { contract, address } = this.need();
    const count = Number(await contract.gameCount());
    const ids: number[] = [];
    for (let id = count; id >= 1 && ids.length < max; id--) ids.push(id);

    const out: GameSummary[] = [];
    for (let i = 0; i < ids.length; i += 6) {
      const batch = await Promise.all(
        ids.slice(i, i + 6).map(async (id) => {
          const info = await contract.gameInfo(id);
          const players: string[] = [...info.players].map((p: string) => (p === ZeroAddress ? "" : getAddress(p)));
          const mySeat = players.findIndex((p) => p && p.toLowerCase() === address.toLowerCase());
          const phase = PHASES[Number(info.phase)];
          const alive = [...info.alive].map(Boolean);
          let myTurn = false;
          if (mySeat >= 0 && alive[mySeat] && (phase === "Night" || phase === "Day")) {
            const st = await contract.actionStatus(id);
            myTurn = !st.hasActed[mySeat];
          }
          return {
            id,
            phase,
            winner: WINNERS[Number(info.winner)],
            round: Number(info.round),
            joined: Number(info.joined),
            players,
            alive,
            mySeat,
            myTurn,
          } as GameSummary;
        }),
      );
      out.push(...batch);
    }
    return out;
  }

  async getHistory(id: number): Promise<HistoryItem[]> {
    const { contract } = this.need();
    try {
      const latest = await this.provider!.getBlockNumber();
      const from = Math.max(0, latest - 200_000);
      const [died, nobody, ended] = await Promise.all([
        contract.queryFilter(contract.filters.PlayerDied(id), from),
        contract.queryFilter(contract.filters.NobodyDied(id), from),
        contract.queryFilter(contract.filters.GameEnded(id), from),
      ]);
      const items: { order: number; item: HistoryItem }[] = [];
      const order = (l: any) => l.blockNumber * 100000 + l.index;
      for (const l of died as any[]) {
        items.push({
          order: order(l),
          item: { kind: "died", seat: Number(l.args.seat), role: ROLES[Number(l.args.role)], byVote: Boolean(l.args.byVote) },
        });
      }
      for (const l of nobody as any[]) {
        items.push({ order: order(l), item: { kind: "nobody", byVote: Boolean(l.args.byVote) } });
      }
      for (const l of ended as any[]) {
        items.push({ order: order(l), item: { kind: "ended", winner: WINNERS[Number(l.args.winner)] } });
      }
      return items.sort((a, b) => a.order - b.order).map((x) => x.item);
    } catch {
      // History is a nicety; the game itself never depends on it.
      return [];
    }
  }

  // ------------------------------------------------------------- actions

  async createGame(): Promise<number> {
    const { contract } = this.need();
    const receipt = await this.send("Creating the game", "createGame", []);
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "GameCreated") return Number(parsed.args.id);
      } catch {
        /* not one of ours */
      }
    }
    throw new Error("The game was created, but its id could not be read. Check the transaction link.");
  }

  async join(id: number): Promise<void> {
    await this.send("Joining the game", "join", [id]);
  }

  async submitNight(id: number, target: number): Promise<void> {
    const enc = await this.encrypt8(target);
    await this.send("Locking in your night action", "submitNightAction", [id, enc.handle, enc.proof]);
  }

  async submitVote(id: number, target: number): Promise<void> {
    const enc = await this.encrypt8(target);
    await this.send("Casting your vote", "submitVote", [id, enc.handle, enc.proof]);
  }

  async reveal(id: number): Promise<void> {
    const { contract } = this.need();
    const state = await this.getState(id);
    const [seatHandle, roleHandle] = await contract.pendingHandles(id);
    const res = await this.publicDecrypt([seatHandle, roleHandle]);
    if (state.phase === "NightReveal") {
      await this.send("Revealing the night", "revealNight", [id, res.abiEncodedClearValues, res.decryptionProof]);
    } else if (state.phase === "DayReveal") {
      await this.send("Revealing the vote", "revealDay", [id, res.abiEncodedClearValues, res.decryptionProof]);
    } else {
      throw new Error("There is nothing to reveal right now.");
    }
  }

  async forceResolve(id: number): Promise<void> {
    await this.send("Resolving the stalled phase", "forceResolve", [id]);
  }

  // --------------------------------------------------------- decryption

  peekMyRole(id: number): RoleName | null {
    if (!this.address) return null;
    try {
      const cached = sessionStorage.getItem(`veilfall:${CONTRACT_ADDRESS}:${id}:${this.address}`);
      return cached && (ROLES as readonly string[]).includes(cached) ? (cached as RoleName) : null;
    } catch {
      return null; // storage can be unavailable; the player just decrypts again
    }
  }

  async getMyRole(id: number): Promise<RoleName> {
    const { contract, address } = this.need();
    const cacheKey = `veilfall:${CONTRACT_ADDRESS}:${id}:${address}`;
    const cached = this.peekMyRole(id);
    if (cached) return cached;

    const handle: string = await contract.roleOf(id, address);
    const instance = await this.fhe();

    const keypair = instance.generateKeypair();
    const startTimestamp = Math.floor(Date.now() / 1000);
    const durationDays = 1;
    const eip712 = instance.createEIP712(keypair.publicKey, [CONTRACT_ADDRESS], startTimestamp, durationDays);

    this.status("Sign the message in your wallet to read your secret role (it costs no gas)…");
    const signature = await this.signer!.signTypedData(
      eip712.domain,
      { UserDecryptRequestVerification: eip712.types.UserDecryptRequestVerification },
      eip712.message,
    );

    this.status("Decrypting your role privately…");
    const result = await instance.userDecrypt(
      [{ handle, contractAddress: CONTRACT_ADDRESS }],
      keypair.privateKey,
      keypair.publicKey,
      signature,
      [CONTRACT_ADDRESS],
      address,
      startTimestamp,
      durationDays,
    );
    this.status("");

    const raw = result[handle] ?? result[handle.toLowerCase()];
    const role = ROLES[Number(raw)];
    if (!role) throw new Error("Unexpected role value from decryption.");
    try {
      sessionStorage.setItem(cacheKey, role);
    } catch {
      /* ignore */
    }
    return role;
  }

  async verifyRoles(id: number): Promise<RoleName[]> {
    const { contract } = this.need();
    const state = await this.getState(id);
    if (state.phase !== "Ended") throw new Error("Roles can only be verified once the game has ended.");
    const handles: string[] = [];
    for (let seat = 0; seat < SEATS; seat++) {
      handles.push(await contract.roleOf(id, state.players[seat]));
    }
    const res = await this.publicDecrypt(handles);
    this.status("");
    return handles.map((h) => {
      const raw = res.clearValues[h] ?? res.clearValues[h.toLowerCase()];
      const role = ROLES[Number(raw)];
      if (!role) throw new Error("Unexpected role value from public decryption.");
      return role;
    });
  }
}
