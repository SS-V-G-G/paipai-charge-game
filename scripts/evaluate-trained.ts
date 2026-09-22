import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BOT_STRATEGY_VERSION, chooseBotAction } from "../shared/bot.js";
import { createFreshPlayer } from "../shared/engine.js";
import { TRAINING_STYLES, chooseTrainedAction, resolveTrainingRound, type TrainedPolicyModel, type TrainingStyle } from "../shared/training.js";
import type { RoomState } from "../shared/types.js";

const modelPath = resolve(process.argv[2] ?? "models/self-play-policy.json");
const gameCount = Math.max(1, Number(process.argv[3] ?? 500));
const maxRounds = Math.max(1, Number(process.argv[4] ?? 80));
const model = JSON.parse(readFileSync(modelPath, "utf8")) as TrainedPolicyModel;

function createState(seed: number): RoomState {
  return {
    roomCode: `EVAL-${seed}`,
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

const results = { trained: 0, baseline: 0, draw: 0, timeout: 0 };
const styleResults = Object.fromEntries(TRAINING_STYLES.map((style) => [style, { wins: 0, games: 0 }])) as Record<TrainingStyle, { wins: number; games: number }>;
let totalRounds = 0;
for (let index = 0; index < gameCount; index += 1) {
  const seed = 100_000 + index;
  const trainedId = index % 2 === 0 ? "left" : "right";
  const baselineId = trainedId === "left" ? "right" : "left";
  const style = TRAINING_STYLES[(seed * 2654435761 >>> 0) % TRAINING_STYLES.length];
  styleResults[style].games += 1;
  let state = createState(seed);
  while (state.phase !== "finished" && state.actionHistory.length < maxRounds) {
    const trainedAction = chooseTrainedAction(state, trainedId, model, style);
    const baselineAction = chooseBotAction(state, baselineId, "normal").action;
    state = resolveTrainingRound(state, [trainedAction, baselineAction]);
  }
  totalRounds += state.actionHistory.length;
  if (state.phase !== "finished") results.timeout += 1;
  else if (state.winnerIds.length === 0) results.draw += 1;
  else if (state.winnerIds[0] === trainedId) {
    results.trained += 1;
    styleResults[style].wins += 1;
  }
  else results.baseline += 1;
}

const decisive = results.trained + results.baseline;
console.log(`模型 ${model.modelType}｜训练数据 ${model.games} 局 / ${model.decisions} 决策`);
console.log(`评估 ${gameCount} 局｜平均回合 ${(totalRounds / gameCount).toFixed(2)}｜训练策略胜 ${results.trained}｜基线胜 ${results.baseline}｜平局 ${results.draw}｜超时 ${results.timeout}`);
console.log(`训练策略决胜局胜率 ${decisive > 0 ? (results.trained / decisive * 100).toFixed(1) : "0.0"}%`);
console.log(`风格胜率 ${TRAINING_STYLES.map((style) => `${style}:${(styleResults[style].wins / Math.max(1, styleResults[style].games) * 100).toFixed(1)}%`).join("｜")}`);
