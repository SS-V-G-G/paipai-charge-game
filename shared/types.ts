import type { CardId, LimitedCardId } from "./cards.js";

export type GamePhase = "lobby" | "selecting" | "resolving" | "rockPaperScissors" | "finished";
export type PlayerController = "human" | "bot";
export type RoomMode = "multiplayer" | "human-vs-bot";
export type BotDifficulty = "easy" | "normal" | "hard" | "hell";
export type RpsChoice = "rock" | "paper" | "scissors";

export interface PlayerState {
  id: string;
  name: string;
  life: number;
  charge: number;
  alive: boolean;
  ready: boolean;
  connected: boolean;
  controller: PlayerController;
  botDifficulty?: BotDifficulty;
  remainingUses: Record<LimitedCardId, number>;
  freeBigGuns: number;
  goldenRoosterActive: boolean;
  goldenRoosterNext: boolean;
}

export interface PlayerPrivateState extends PlayerState {
  reconnectToken: string;
}

export interface SubmittedAction {
  playerId: string;
  cardId: CardId;
  targetIds: string[];
}

export interface PublicAction {
  playerId: string;
  cardId: CardId;
  targetIds: string[];
}

export interface RoundRecord {
  round: number;
  actions: PublicAction[];
}

export interface RpsPublicState {
  duelId: string;
  contemptPlayerId: string;
  targetPlayerId: string;
  attempt: number;
  submittedPlayerIds: string[];
  lastAttemptWasTie: boolean;
}

export interface RpsRecord {
  duelId: string;
  gameRound: number;
  attempt: number;
  contemptPlayerId: string;
  targetPlayerId: string;
  choices: Array<{ playerId: string; choice: RpsChoice }>;
  result: "tie" | "contempt-won" | "target-won";
}

export interface GameEvent {
  id: string;
  type: "system" | "card" | "resource" | "clash" | "break" | "blocked" | "reflected" | "damage" | "death";
  text: string;
  sourceId?: string;
  targetIds?: string[];
  amount?: number | "infinite";
}

export interface RoomState {
  roomCode: string;
  mode: RoomMode;
  botSeed: number;
  botStrategyVersion: string;
  hostId: string;
  phase: GamePhase;
  round: number;
  deadlineAt: number | null;
  players: PlayerPrivateState[];
  astrologyRemaining: number;
  submittedPlayerIds: string[];
  revealedActions: PublicAction[];
  actionHistory: RoundRecord[];
  rps: RpsPublicState | null;
  rpsHistory: RpsRecord[];
  events: GameEvent[];
  winnerIds: string[];
}

export interface PublicRoomState extends Omit<RoomState, "players"> {
  players: PlayerState[];
}

export type ClientMessage =
  | { type: "ready" }
  | { type: "startGame" }
  | { type: "submit"; roundId: number; cardId: CardId; targetIds: string[] }
  | { type: "rpsSubmit"; duelId: string; choice: RpsChoice }
  | { type: "playAgain" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; roomCode: string }
  | { type: "state"; state: PublicRoomState }
  | { type: "error"; code: string; message: string };
