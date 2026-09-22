import { CARD_DEFINITIONS, type CardDefinition, type CardId } from "./cards.js";
import { chooseBotAction, enumerateLegalActions } from "./bot.js";
import { resolveRound } from "./engine.js";
import { compareRps, deterministicRpsChoice, findRpsDuel } from "./rps.js";
import type { RoomState, SubmittedAction } from "./types.js";

export const TRAINING_SCHEMA_VERSION = 2;
export const TRAINING_STYLES = ["balanced", "aggressive", "defensive", "economy", "trickster", "chaotic"] as const;
export type TrainingStyle = typeof TRAINING_STYLES[number];

export interface TrainingDecision {
  playerId: string;
  style: TrainingStyle;
  contextKey: string;
  legalCardIds: CardId[];
  actionCardId: CardId;
  opponentActionCardId: CardId;
}

export interface SelfPlayGame {
  schemaVersion: typeof TRAINING_SCHEMA_VERSION;
  rulesVersion: string;
  strategyVersion: string;
  gameId: string;
  source: "self-play" | "render-replay";
  seed: number;
  rounds: number;
  outcome: "left" | "right" | "draw" | "timeout";
  decisions: TrainingDecision[];
}

export interface ActionValueStat {
  count: number;
  valueSum: number;
  valueSquareSum: number;
}

export interface TrainedPolicyModel {
  schemaVersion: typeof TRAINING_SCHEMA_VERSION;
  modelType: "tabular-monte-carlo-v1";
  rulesVersion: string;
  sourceStrategyVersion: string;
  createdAt: string;
  games: number;
  decisions: number;
  global: Partial<Record<CardId, ActionValueStat>>;
  contexts: Record<string, Partial<Record<CardId, ActionValueStat>>>;
}

function chargeBucket(value: number): string {
  if (value <= 2) return String(value);
  if (value <= 4) return "3-4";
  if (value <= 6) return "5-6";
  if (value <= 9) return "7-9";
  return "10+";
}

export function trainingContextKey(state: RoomState, playerId: string): string {
  const self = state.players.find((player) => player.id === playerId);
  const opponent = state.players.find((player) => player.alive && player.id !== playerId);
  if (!self || !opponent) throw new Error("训练上下文需要两名存活玩家");
  const lastOpponentCards = state.actionHistory
    .slice(-2)
    .map((round) => round.actions.find((action) => action.playerId === opponent.id)?.cardId ?? "none")
    .join(",") || "none";
  const limited = Object.values(self.remainingUses).map((uses) => Math.min(uses, 1)).join("");
  const opponentLimited = Object.values(opponent.remainingUses).map((uses) => Math.min(uses, 1)).join("");
  return [
    `sc:${chargeBucket(self.charge)}`,
    `oc:${chargeBucket(opponent.charge)}`,
    `sl:${limited}`,
    `ol:${opponentLimited}`,
    `sf:${Math.min(self.freeBigGuns, 1)}`,
    `of:${Math.min(opponent.freeBigGuns, 1)}`,
    `sg:${Number(self.goldenRoosterActive)}`,
    `og:${Number(opponent.goldenRoosterActive)}`,
    `ast:${Math.min(state.astrologyRemaining, 2)}`,
    `last:${lastOpponentCards}`,
  ].join("|");
}

export function styledTrainingContextKey(state: RoomState, playerId: string, style: TrainingStyle): string {
  return `style:${style}|${trainingContextKey(state, playerId)}`;
}

export function classifyTrainingStyle(cardIds: CardId[]): TrainingStyle {
  if (cardIds.length === 0) return "balanced";
  const scores: Record<Exclude<TrainingStyle, "balanced" | "chaotic">, number> = {
    aggressive: 0,
    defensive: 0,
    economy: 0,
    trickster: 0,
  };
  for (const cardId of cardIds) {
    const card = CARD_DEFINITIONS[cardId] as CardDefinition;
    if (card.tags?.includes("attack")) scores.aggressive += 1;
    if (card.tags?.some((tag) => ["defense", "reflect", "invincible"].includes(tag))) scores.defensive += 1;
    if (["charge", "rub", "flower", "raise_gun", "praise"].includes(cardId)) scores.economy += 1;
    if (["contempt", "shoot", "pull", "praise", "astrology", "golden_rooster"].includes(cardId)) scores.trickster += 1;
  }
  const ranked = Object.entries(scores).sort((left, right) => right[1] - left[1]) as Array<[keyof typeof scores, number]>;
  return ranked[0][1] / cardIds.length >= 0.4 ? ranked[0][0] : "balanced";
}

export function trainingReward(game: SelfPlayGame, playerId: string): number {
  if (game.outcome === "draw" || game.outcome === "timeout") return 0;
  return game.outcome === playerId ? 1 : -1;
}

export function resolveTrainingRound(
  state: RoomState,
  actions: SubmittedAction[],
): RoomState {
  const duel = findRpsDuel(state, actions);
  if (!duel) return resolveRound(state, actions);

  let attempt = 1;
  let comparison: ReturnType<typeof compareRps> = "tie";
  while (comparison === "tie") {
    const contemptChoice = deterministicRpsChoice(state.botSeed, `${duel.duelId}:${attempt}:${duel.contemptPlayerId}`);
    const targetChoice = deterministicRpsChoice(state.botSeed, `${duel.duelId}:${attempt}:${duel.targetPlayerId}`);
    comparison = compareRps(contemptChoice, targetChoice);
    attempt += 1;
  }

  const result = resolveRound(state, actions);
  result.phase = "finished";
  if (comparison === "left") {
    result.players.forEach((player) => {
      player.alive = false;
      player.life = 0;
    });
    result.winnerIds = [];
  } else {
    result.players.forEach((player) => {
      player.alive = player.id === duel.targetPlayerId;
      player.life = player.alive ? Math.max(1, player.life) : 0;
    });
    result.winnerIds = [duel.targetPlayerId];
  }
  return result;
}

function statMean(stat: ActionValueStat | undefined): number {
  return stat && stat.count > 0 ? stat.valueSum / stat.count : 0;
}

export function chooseTrainedAction(
  state: RoomState,
  playerId: string,
  model: TrainedPolicyModel,
  style: TrainingStyle = "balanced",
): SubmittedAction {
  const legal = enumerateLegalActions(state, playerId);
  if (legal.length === 0) throw new Error("训练策略当前没有合法动作");
  const context = model.contexts[styledTrainingContextKey(state, playerId, style)] ?? {};
  const baseline = chooseBotAction(state, playerId, "normal").action;
  const contextSamples = Object.values(context).reduce((sum, stat) => sum + (stat?.count ?? 0), 0);
  if (contextSamples < 40) return baseline;
  const priorStrength = 5;
  const ranked = legal
    .map((action) => {
      const local = context[action.cardId];
      const globalMean = statMean(model.global[action.cardId]);
      const score = local
        ? (local.valueSum + globalMean * priorStrength) / (local.count + priorStrength)
        : globalMean;
      return { action, score, count: local?.count ?? 0 };
    })
    .sort((left, right) => right.score - left.score || right.count - left.count || left.action.cardId.localeCompare(right.action.cardId));
  const candidate = ranked[0];
  if (candidate.action.cardId === baseline.cardId || candidate.count < 20) return baseline;
  const baselineRank = ranked.find((item) => item.action.cardId === baseline.cardId);
  if (!baselineRank || baselineRank.count < 20) return baseline;
  const confidenceMargin = 1 / Math.sqrt(candidate.count) + 1 / Math.sqrt(baselineRank.count);
  return candidate.score > baselineRank.score + confidenceMargin ? candidate.action : baseline;
}
