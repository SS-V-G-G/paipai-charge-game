import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CARD_DEFINITIONS, type CardDefinition } from "../shared/cards.js";
import { BOT_STRATEGY_VERSION, chooseBotAction, enumerateLegalActions } from "../shared/bot.js";
import { createFreshPlayer, RULES_VERSION } from "../shared/engine.js";
import {
  TRAINING_SCHEMA_VERSION,
  TRAINING_STYLES,
  resolveTrainingRound,
  styledTrainingContextKey,
  type SelfPlayGame,
  type TrainingDecision,
  type TrainingStyle,
} from "../shared/training.js";
import type { RoomState, SubmittedAction } from "../shared/types.js";

const gameCount = Math.max(1, Number(process.argv[2] ?? 1000));
const outputPath = resolve(process.argv[3] ?? "training-data/self-play.jsonl");
const explorationRate = Math.min(1, Math.max(0, Number(process.argv[4] ?? 0.35)));
const maxRounds = Math.max(1, Number(process.argv[5] ?? 80));

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function unit(seed: number, key: string): number {
  let value = hash(`${seed}:${key}`) + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
}

function createState(seed: number): RoomState {
  return {
    roomCode: `TRAIN-${seed}`,
    mode: "human-vs-bot",
    botSeed: seed,
    botStrategyVersion: BOT_STRATEGY_VERSION,
    hostId: "left",
    phase: "selecting",
    round: 1,
    deadlineAt: null,
    players: [
      { ...createFreshPlayer("left", "左策略", "left", true, "bot"), botDifficulty: "normal" },
      { ...createFreshPlayer("right", "右策略", "right", true, "bot"), botDifficulty: "normal" },
    ],
    astrologyRemaining: 0,
    submittedPlayerIds: [],
    revealedActions: [],
    actionHistory: [],
    rps: null,
    rpsHistory: [],
    events: [],
    winnerIds: [],
  };
}

function weightedChoice(actions: SubmittedAction[], weights: number[], seed: number, key: string): SubmittedAction {
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let position = unit(seed, key) * total;
  for (let index = 0; index < actions.length; index += 1) {
    position -= weights[index];
    if (position <= 0) return actions[index];
  }
  return actions[actions.length - 1];
}

function styleWeight(action: SubmittedAction, style: TrainingStyle): number {
  const card = CARD_DEFINITIONS[action.cardId] as CardDefinition;
  if (style === "aggressive") return card.tags?.includes("attack") ? 6 : card.cost > 0 ? 1.5 : 0.7;
  if (style === "defensive") return card.tags?.some((tag) => ["defense", "reflect", "invincible"].includes(tag)) ? 6 : 0.8;
  if (style === "economy") return ["charge", "rub", "flower", "raise_gun", "praise"].includes(action.cardId) ? 6 : 0.8;
  if (style === "trickster") return ["contempt", "shoot", "pull", "praise", "astrology", "golden_rooster"].includes(action.cardId) ? 6 : 0.8;
  return 1;
}

function chooseExploringAction(state: RoomState, playerId: string, seed: number, style: TrainingStyle): SubmittedAction {
  const legal = enumerateLegalActions(state, playerId);
  const effectiveExploration = style === "chaotic" ? Math.max(0.8, explorationRate) : explorationRate;
  const explore = unit(seed, `${state.round}:${playerId}:explore`) < effectiveExploration;
  if (!explore) return chooseBotAction(state, playerId, "normal").action;
  return weightedChoice(legal, legal.map((action) => styleWeight(action, style)), seed, `${state.round}:${playerId}:action`);
}

mkdirSync(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { encoding: "utf8" });
const outcomes = { left: 0, right: 0, draw: 0, timeout: 0 };
let decisionCount = 0;

for (let gameIndex = 0; gameIndex < gameCount; gameIndex += 1) {
  const seed = gameIndex + 1;
  const leftStyle = TRAINING_STYLES[Math.floor(unit(seed, "left:style") * TRAINING_STYLES.length)];
  const rightStyle = TRAINING_STYLES[Math.floor(unit(seed, "right:style") * TRAINING_STYLES.length)];
  let state = createState(seed);
  const decisions: TrainingDecision[] = [];
  while (state.phase !== "finished" && state.actionHistory.length < maxRounds) {
    const left = chooseExploringAction(state, "left", seed, leftStyle);
    const right = chooseExploringAction(state, "right", seed, rightStyle);
    decisions.push({
      playerId: "left",
      style: leftStyle,
      contextKey: styledTrainingContextKey(state, "left", leftStyle),
      legalCardIds: enumerateLegalActions(state, "left").map((action) => action.cardId),
      actionCardId: left.cardId,
      opponentActionCardId: right.cardId,
    });
    decisions.push({
      playerId: "right",
      style: rightStyle,
      contextKey: styledTrainingContextKey(state, "right", rightStyle),
      legalCardIds: enumerateLegalActions(state, "right").map((action) => action.cardId),
      actionCardId: right.cardId,
      opponentActionCardId: left.cardId,
    });
    state = resolveTrainingRound(state, [left, right]);
  }

  const outcome: SelfPlayGame["outcome"] = state.phase !== "finished"
    ? "timeout"
    : state.winnerIds.length === 0
      ? "draw"
      : state.winnerIds[0] as "left" | "right";
  outcomes[outcome] += 1;
  decisionCount += decisions.length;
  const game: SelfPlayGame = {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    rulesVersion: RULES_VERSION,
    strategyVersion: BOT_STRATEGY_VERSION,
    gameId: `self-play-${seed}`,
    source: "self-play",
    seed,
    rounds: state.actionHistory.length,
    outcome,
    decisions,
  };
  output.write(`${JSON.stringify(game)}\n`);
}

output.end();
await new Promise<void>((resolveDone, reject) => {
  output.on("finish", resolveDone);
  output.on("error", reject);
});
console.log(`已生成 ${gameCount} 局 / ${decisionCount} 个决策 -> ${outputPath}`);
console.log(`左胜 ${outcomes.left}｜右胜 ${outcomes.right}｜平局 ${outcomes.draw}｜超时 ${outcomes.timeout}｜探索率 ${explorationRate}`);
