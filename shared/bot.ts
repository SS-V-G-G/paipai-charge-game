import { BASE_CARD_IDS, CARD_DEFINITIONS, type CardId, type LimitedCardId } from "./cards.js";
import { resolveRound, validateAction } from "./engine.js";
import type { BotDifficulty, RoomState, SubmittedAction } from "./types.js";

export const BOT_STRATEGY_VERSION = "lookahead-v2-rps";

const LIMITED_CARD_VALUE: Record<LimitedCardId, number> = {
  rub: 3,
  flower: 12,
  shoot: 8,
  push: 10,
  praise: 8,
  golden_rooster: 6,
};

export interface BotDecision {
  action: SubmittedAction;
  score: number;
  consideredActions: number;
  strategyVersion: string;
}

export function enumerateLegalActions(state: RoomState, playerId: string): SubmittedAction[] {
  const player = state.players.find((item) => item.id === playerId);
  const opponents = state.players.filter((item) => item.alive && item.id !== playerId);
  if (!player?.alive || opponents.length !== 1) return [];

  const opponentId = opponents[0].id;
  const cardIds: CardId[] = [...BASE_CARD_IDS];
  if (player.freeBigGuns > 0) cardIds.push("free_big_gun");

  const actions: SubmittedAction[] = [];
  for (const cardId of cardIds) {
    const card = CARD_DEFINITIONS[cardId];
    if (card.targetMode === "two-others") continue;
    const targetIds = card.targetMode === "one-other" ? [opponentId] : [];
    if (validateAction(state, playerId, cardId, targetIds) === null) {
      actions.push({ playerId, cardId, targetIds });
    }
  }
  return actions;
}

function limitedResourceValue(state: RoomState, playerId: string): number {
  const player = state.players.find((item) => item.id === playerId);
  if (!player) return 0;
  return (Object.entries(LIMITED_CARD_VALUE) as [LimitedCardId, number][])
    .reduce((sum, [cardId, value]) => sum + player.remainingUses[cardId] * value, 0);
}

function evaluateResult(result: RoomState, botId: string, opponentId: string): number {
  const bot = result.players.find((item) => item.id === botId)!;
  const opponent = result.players.find((item) => item.id === opponentId)!;

  if (bot.alive && !opponent.alive) return 10_000 - result.round;
  if (!bot.alive && opponent.alive) return -10_000 + result.round;
  if (!bot.alive && !opponent.alive) return -250;

  let score = 0;
  score += (bot.life - opponent.life) * 120;
  score += (bot.charge - opponent.charge) * 7;
  score += (bot.freeBigGuns - opponent.freeBigGuns) * 28;
  score += limitedResourceValue(result, botId) - limitedResourceValue(result, opponentId);
  if (bot.goldenRoosterActive) score += 16;
  if (opponent.goldenRoosterActive) score -= 16;
  return score;
}

function opponentActionWeight(state: RoomState, opponentId: string, action: SubmittedAction): number {
  const opponent = state.players.find((item) => item.id === opponentId)!;
  let weight = 1;

  const recent = state.actionHistory.slice(-6);
  recent.forEach((record, index) => {
    const previous = record.actions.find((item) => item.playerId === opponentId);
    if (previous?.cardId === action.cardId) weight += 0.25 + index * 0.08;
  });

  if (opponent.charge <= 1 && action.cardId === "charge") weight += 1.4;
  if (opponent.charge <= 1 && action.cardId === "rub") weight += 0.8;
  if (action.cardId === "small_defense") weight += 0.35;
  if (action.cardId === "contempt") weight *= 0.2;
  return weight;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number): number {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

export function chooseBotAction(
  state: RoomState,
  botId: string,
  difficulty: BotDifficulty = "normal",
): BotDecision {
  const botActions = enumerateLegalActions(state, botId);
  const opponent = state.players.find((item) => item.alive && item.id !== botId);
  if (!opponent || botActions.length === 0) throw new Error("AI当前没有合法动作");
  const opponentActions = enumerateLegalActions(state, opponent.id);
  if (opponentActions.length === 0) throw new Error("对手当前没有可预演动作");

  const ranked = botActions.map((botAction) => {
    let weightedTotal = 0;
    let totalWeight = 0;
    let worst = Number.POSITIVE_INFINITY;
    for (const opponentAction of opponentActions) {
      const weight = opponentActionWeight(state, opponent.id, opponentAction);
      const result = resolveRound(state, [botAction, opponentAction]);
      const utility = evaluateResult(result, botId, opponent.id);
      weightedTotal += utility * weight;
      totalWeight += weight;
      worst = Math.min(worst, utility);
    }
    const expected = weightedTotal / totalWeight;
    const caution = difficulty === "hard" ? 0.3 : difficulty === "easy" ? 0.05 : 0.18;
    return { action: botAction, score: expected * (1 - caution) + worst * caution };
  }).sort((left, right) => right.score - left.score || left.action.cardId.localeCompare(right.action.cardId));

  const random = seededUnit(hashSeed(`${state.botSeed}:${state.round}:${botId}:${BOT_STRATEGY_VERSION}`));
  const candidateCount = difficulty === "hard" ? 1 : difficulty === "easy"
    ? Math.max(1, Math.ceil(ranked.length / 2))
    : Math.min(3, ranked.length);
  const position = difficulty === "normal"
    ? Math.min(candidateCount - 1, Math.floor(random * random * candidateCount))
    : Math.min(candidateCount - 1, Math.floor(random * candidateCount));
  const selected = ranked[position];

  return {
    action: {
      ...selected.action,
      targetIds: [...selected.action.targetIds],
    },
    score: selected.score,
    consideredActions: botActions.length * opponentActions.length,
    strategyVersion: BOT_STRATEGY_VERSION,
  };
}
