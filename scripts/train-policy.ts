import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { RULES_VERSION } from "../shared/engine.js";
import {
  TRAINING_SCHEMA_VERSION,
  trainingReward,
  type ActionValueStat,
  type SelfPlayGame,
  type TrainedPolicyModel,
} from "../shared/training.js";
import type { CardId } from "../shared/cards.js";

const inputPaths = (process.argv[2] ?? "training-data/self-play.jsonl")
  .split(",")
  .map((path) => resolve(path.trim()));
const outputPath = resolve(process.argv[3] ?? "models/self-play-policy.json");
const global: Partial<Record<CardId, ActionValueStat>> = {};
const contexts: TrainedPolicyModel["contexts"] = {};
let games = 0;
let decisions = 0;
let sourceStrategyVersion = "unknown";

function update(target: Partial<Record<CardId, ActionValueStat>>, cardId: CardId, reward: number) {
  const stat = target[cardId] ?? { count: 0, valueSum: 0, valueSquareSum: 0 };
  stat.count += 1;
  stat.valueSum += reward;
  stat.valueSquareSum += reward * reward;
  target[cardId] = stat;
}

for (const inputPath of inputPaths) {
  const lines = createInterface({ input: createReadStream(inputPath, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line.trim()) continue;
    const game = JSON.parse(line) as SelfPlayGame;
    if (game.schemaVersion !== TRAINING_SCHEMA_VERSION) throw new Error(`不支持的数据版本: ${game.schemaVersion}`);
    if (game.rulesVersion !== RULES_VERSION) continue;
    sourceStrategyVersion = game.strategyVersion;
    games += 1;
    for (const decision of game.decisions) {
      const reward = trainingReward(game, decision.playerId);
      update(global, decision.actionCardId, reward);
      const context = contexts[decision.contextKey] ?? {};
      update(context, decision.actionCardId, reward);
      contexts[decision.contextKey] = context;
      decisions += 1;
    }
  }
}

if (games === 0) throw new Error("没有与当前规则版本匹配的训练数据");
const model: TrainedPolicyModel = {
  schemaVersion: TRAINING_SCHEMA_VERSION,
  modelType: "tabular-monte-carlo-v1",
  rulesVersion: RULES_VERSION,
  sourceStrategyVersion,
  createdAt: new Date().toISOString(),
  games,
  decisions,
  global,
  contexts,
};
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
console.log(`已训练 ${games} 局 / ${decisions} 个决策 / ${Object.keys(contexts).length} 个局面 -> ${outputPath}`);
