import { GameClient, GameState, HistoryItem, NOBODY, PhaseName, RoleName, WinnerName } from "./types";
import { SEATS } from "./config";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (n: number) => Math.floor(Math.random() * n);

/**
 * A simulated game used for the "demo" mode: no wallet, nothing on-chain.
 * It follows the same rules as the Veilfall contract so the screens behave the same,
 * with four bot players. The UI always labels it as a simulation.
 */
export class MockClient implements GameClient {
  readonly mode = "mock" as const;
  readonly address = "0xDEMO000000000000000000000000000000000001";
  readonly lastTxUrl: string | null = null;

  private status: (m: string) => void = () => {};
  private id = 1;
  private phase: PhaseName = "Lobby";
  private winner: WinnerName = "None";
  private round = 0;
  private joined = 1;
  private roles: RoleName[] = [];
  private alive: boolean[] = Array(SEATS).fill(true);
  private hasActed: boolean[] = Array(SEATS).fill(false);
  private acted = 0;
  private lastDeadSeat = NOBODY;
  private history: HistoryItem[] = [];
  private nightKill = -1;
  private nightSave = -1;
  private votes: number[] = [];
  private pendingSeat = NOBODY;
  private deadline = 0;
  private readonly mySeat = 0;
  private runId = 0;

  setStatusListener(fn: (message: string) => void) {
    this.status = fn;
  }

  async connect() {
    return this.address;
  }

  async createGame(): Promise<number> {
    this.status("Creating a simulated game…");
    await sleep(400);
    this.runId++;
    this.phase = "Lobby";
    this.winner = "None";
    this.round = 0;
    this.joined = 1;
    this.alive = Array(SEATS).fill(true);
    this.history = [];
    this.lastDeadSeat = NOBODY;
    this.status("");
    // Bots take their seats one after another.
    const run = this.runId;
    for (let seat = 1; seat < SEATS; seat++) {
      setTimeout(() => {
        if (run !== this.runId) return;
        this.joined = seat + 1;
        if (this.joined === SEATS) this.deal();
      }, 900 * seat);
    }
    return this.id;
  }

  async join(): Promise<void> {
    /* the demo player is always seat 1 */
  }

  private deal() {
    const roles: RoleName[] = ["Killer", "Doctor", "Villager", "Villager", "Villager"];
    for (let i = roles.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [roles[i], roles[j]] = [roles[j], roles[i]];
    }
    this.roles = roles;
    this.startNight();
  }

  private startNight() {
    this.phase = "Night";
    this.acted = 0;
    this.hasActed = Array(SEATS).fill(false);
    this.nightKill = -1;
    this.nightSave = -1;
    this.deadline = Math.floor(Date.now() / 1000) + 600;
    this.scheduleBots();
  }

  private startDay() {
    this.phase = "Day";
    this.acted = 0;
    this.hasActed = Array(SEATS).fill(false);
    this.votes = Array(SEATS).fill(0);
    this.deadline = Math.floor(Date.now() / 1000) + 600;
    this.scheduleBots();
  }

  private aliveSeats(): number[] {
    return this.alive.map((a, i) => (a ? i : -1)).filter((i) => i >= 0);
  }

  private scheduleBots() {
    const run = this.runId;
    const phase = this.phase;
    for (const seat of this.aliveSeats()) {
      if (seat === this.mySeat) continue;
      setTimeout(() => {
        if (run !== this.runId || this.phase !== phase || this.hasActed[seat]) return;
        const targets = this.aliveSeats().filter((s) => s !== seat);
        const target = targets[rand(targets.length)];
        this.record(seat, target);
      }, 1200 + rand(2600));
    }
  }

  private record(seat: number, target: number) {
    if (this.hasActed[seat]) return;
    this.hasActed[seat] = true;
    this.acted++;
    if (this.phase === "Night") {
      if (this.roles[seat] === "Killer") this.nightKill = target;
      if (this.roles[seat] === "Doctor") this.nightSave = target;
    } else if (this.phase === "Day") {
      this.votes[target]++;
    }
    if (this.acted === this.aliveSeats().length) this.resolve();
  }

  private resolve() {
    if (this.phase === "Night") {
      const dies = this.nightKill >= 0 && this.alive[this.nightKill] && this.nightKill !== this.nightSave;
      this.pendingSeat = dies ? this.nightKill : NOBODY;
      this.phase = "NightReveal";
    } else if (this.phase === "Day") {
      const best = Math.max(...this.aliveSeats().map((s) => this.votes[s]));
      const top = this.aliveSeats().filter((s) => this.votes[s] === best);
      this.pendingSeat = best > 0 && top.length === 1 ? top[0] : NOBODY;
      this.phase = "DayReveal";
    }
  }

  async getState(id: number): Promise<GameState> {
    const players = Array.from({ length: SEATS }, (_, i) => (i < this.joined ? (i === 0 ? this.address : `0xBOT${i}`) : ""));
    return {
      id,
      phase: this.phase,
      winner: this.winner,
      round: this.round,
      joined: this.joined,
      players,
      alive: [...this.alive],
      lastDeadSeat: this.lastDeadSeat,
      acted: this.acted,
      hasActed: [...this.hasActed],
      deadline: this.deadline,
      mySeat: this.mySeat,
    };
  }

  async getHistory(): Promise<HistoryItem[]> {
    return [...this.history];
  }

  peekMyRole(): RoleName | null {
    return null;
  }

  async getMyRole(): Promise<RoleName> {
    this.status("Decrypting your role privately…");
    await sleep(700);
    this.status("");
    return this.roles[this.mySeat];
  }

  async submitNight(_id: number, target: number): Promise<void> {
    this.status("Encrypting your move…");
    await sleep(700);
    this.status("");
    if (this.phase !== "Night") throw new Error("Not night");
    this.record(this.mySeat, target);
  }

  async submitVote(_id: number, target: number): Promise<void> {
    this.status("Encrypting your vote…");
    await sleep(700);
    this.status("");
    if (this.phase !== "Day") throw new Error("Not day");
    this.record(this.mySeat, target);
  }

  async reveal(): Promise<void> {
    this.status("Decrypting the sealed result…");
    await sleep(900);
    this.status("");
    const byVote = this.phase === "DayReveal";
    if (this.phase !== "NightReveal" && this.phase !== "DayReveal") throw new Error("Nothing to reveal");

    const seat = this.pendingSeat;
    this.lastDeadSeat = seat;
    if (seat === NOBODY) {
      this.history.push({ kind: "nobody", byVote });
    } else {
      this.alive[seat] = false;
      this.history.push({ kind: "died", seat, role: this.roles[seat], byVote });
    }

    const killerDead = this.alive.some((a, i) => !a && this.roles[i] === "Killer");
    if (killerDead) this.finish("Villagers");
    else if (this.aliveSeats().length <= 2) this.finish("Killer");
    else if (byVote) {
      this.round++;
      this.startNight();
    } else {
      this.startDay();
    }
  }

  private finish(winner: WinnerName) {
    this.winner = winner;
    this.phase = "Ended";
    this.history.push({ kind: "ended", winner });
  }

  async forceResolve(): Promise<void> {
    throw new Error("Too early");
  }

  async verifyRoles(): Promise<RoleName[]> {
    this.status("Decrypting every role publicly…");
    await sleep(900);
    this.status("");
    return [...this.roles];
  }
}
