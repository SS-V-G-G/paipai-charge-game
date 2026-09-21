import type { CardId, LimitedCardId } from "./cards.js";

export type GamePhase = "lobby" | "selecting" | "resolving" | "finished";

export interface PlayerState {
  id: string;
  name: string;
  life: number;
  charge: number;
  alive: boolean;
  ready: boolean;
  connected: boolean;
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
  hostId: string;
  phase: GamePhase;
  round: number;
  deadlineAt: number | null;
  players: PlayerPrivateState[];
  astrologyRemaining: number;
  submittedPlayerIds: string[];
  revealedActions: PublicAction[];
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
  | { type: "playAgain" };

export type ServerMessage =
  | { type: "welcome"; playerId: string; roomCode: string }
  | { type: "state"; state: PublicRoomState }
  | { type: "error"; code: string; message: string };
