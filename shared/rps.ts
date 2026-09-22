import { CARD_DEFINITIONS } from "./cards.js";
import type { RoomState, RpsChoice, SubmittedAction } from "./types.js";

export interface RpsDuel {
  duelId: string;
  contemptPlayerId: string;
  targetPlayerId: string;
}

export type RpsComparison = "tie" | "left" | "right";

export function compareRps(left: RpsChoice, right: RpsChoice): RpsComparison {
  if (left === right) return "tie";
  if (
    (left === "rock" && right === "scissors")
    || (left === "scissors" && right === "paper")
    || (left === "paper" && right === "rock")
  ) return "left";
  return "right";
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function deterministicRpsChoice(seed: number, key: string): RpsChoice {
  const choices: RpsChoice[] = ["rock", "paper", "scissors"];
  return choices[hashSeed(`${seed}:${key}`) % choices.length];
}

export function findRpsDuel(state: RoomState, actions: SubmittedAction[]): RpsDuel | null {
  if (state.players.filter((player) => player.alive).length !== 2) return null;
  const actionByPlayer = new Map(actions.map((action) => [action.playerId, action]));
  for (const action of actions) {
    if (action.cardId !== "contempt") continue;
    const targetPlayerId = action.targetIds[0];
    const targetAction = actionByPlayer.get(targetPlayerId);
    if (!targetAction || CARD_DEFINITIONS[targetAction.cardId].cost <= 0) continue;
    return {
      duelId: `rps-${state.round}-${action.playerId}-${targetPlayerId}`,
      contemptPlayerId: action.playerId,
      targetPlayerId,
    };
  }
  return null;
}
