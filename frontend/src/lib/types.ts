export const PHASES = ["Lobby", "Night", "NightReveal", "Day", "DayReveal", "Ended"] as const;
export type PhaseName = (typeof PHASES)[number];

export const ROLES = ["Villager", "Killer", "Doctor"] as const;
export type RoleName = (typeof ROLES)[number];

export const WINNERS = ["None", "Villagers", "Killer"] as const;
export type WinnerName = (typeof WINNERS)[number];

export const NOBODY = 255;

export interface GameState {
  id: number;
  phase: PhaseName;
  winner: WinnerName;
  round: number;
  joined: number;
  /** Seat addresses; empty string for a seat nobody has taken yet. */
  players: string[];
  alive: boolean[];
  lastDeadSeat: number;
  /** How many living players have acted in the current Night/Day phase. */
  acted: number;
  hasActed: boolean[];
  /** Unix seconds after which anyone may force the phase to resolve. */
  deadline: number;
  /** The connected player's seat, or -1 if they are not in this game. */
  mySeat: number;
}

export interface HistoryItem {
  kind: "died" | "nobody" | "ended";
  byVote?: boolean;
  seat?: number;
  role?: RoleName;
  winner?: WinnerName;
}

/**
 * Everything the UI needs from a game backend. There are two implementations:
 *  - ChainClient: the real contract on Sepolia, with Zama's encryption SDK
 *  - MockClient:  an in-memory simulation used for the "demo" mode (no wallet, not on-chain)
 */
export interface GameClient {
  readonly mode: "chain" | "mock";
  readonly address: string | null;
  /** Link to the most recent transaction, if any. */
  readonly lastTxUrl: string | null;
  setStatusListener(fn: (message: string) => void): void;

  connect(): Promise<string>;
  createGame(): Promise<number>;
  join(id: number): Promise<void>;
  getState(id: number): Promise<GameState>;
  getHistory(id: number): Promise<HistoryItem[]>;
  /** Decrypts the connected player's own role (asks for a wallet signature on-chain). */
  getMyRole(id: number): Promise<RoleName>;
  /** The role if it was already decrypted earlier in this browser session (never prompts). */
  peekMyRole(id: number): RoleName | null;
  submitNight(id: number, target: number): Promise<void>;
  submitVote(id: number, target: number): Promise<void>;
  /** Publishes the sealed night/day result (anyone may do this). */
  reveal(id: number): Promise<void>;
  /** Resolves a stalled phase after its deadline. */
  forceResolve(id: number): Promise<void>;
  /** After the game: publicly decrypt every role so anyone can check the deal was fair. */
  verifyRoles(id: number): Promise<RoleName[]>;
}

/** One line in the lobby: a game as seen by the connected wallet. */
export interface GameSummary {
  id: number;
  phase: PhaseName;
  winner: WinnerName;
  round: number;
  joined: number;
  players: string[];
  alive: boolean[];
  /** The connected player's seat, or -1. */
  mySeat: number;
  /** True when it is this player's turn to lock in a night move or a vote. */
  myTurn: boolean;
}
