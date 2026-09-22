import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chooseBotAction } from "../shared/bot.js";
import { RULES_VERSION } from "../shared/engine.js";
import { TRAINING_SCHEMA_VERSION, TRAINING_STYLES, chooseTrainedAction, type TrainedPolicyModel, type TrainingStyle } from "../shared/training.js";
import type { RoomState, SubmittedAction } from "../shared/types.js";

export const TRAINED_BOT_STRATEGY_VERSION = "styled-policy-v2-10k";
const defaultModelPath = resolve(process.cwd(), "models/styled-policy-v2-10k.json");
const modelPath = process.env.BASIC_AI_MODEL_PATH?.trim() || defaultModelPath;

let model: TrainedPolicyModel | null = null;
let loadError: string | null = null;
try {
  const candidate = JSON.parse(readFileSync(modelPath, "utf8")) as TrainedPolicyModel;
  if (candidate.schemaVersion !== TRAINING_SCHEMA_VERSION) throw new Error(`训练模型格式版本不匹配: ${candidate.schemaVersion}`);
  if (candidate.rulesVersion !== RULES_VERSION) throw new Error(`训练模型规则版本不匹配: ${candidate.rulesVersion}`);
  model = candidate;
  console.log(`基础AI已加载训练模型：${candidate.games}局 / ${candidate.decisions}决策`);
} catch (error) {
  loadError = error instanceof Error ? error.message : "训练模型加载失败";
  console.warn(`基础AI训练模型不可用，将回退原策略：${loadError}`);
}

export function selectBasicAiStyle(seed: number, gameSequence: number): TrainingStyle {
  const mixed = Math.imul((seed ^ gameSequence) >>> 0, 2654435761) >>> 0;
  return TRAINING_STYLES[mixed % TRAINING_STYLES.length];
}

export function basicAiStyleLabel(style: TrainingStyle): string {
  return {
    balanced: "均衡",
    aggressive: "进攻",
    defensive: "防守",
    economy: "经济",
    trickster: "技巧",
    chaotic: "混沌",
  }[style];
}

export function chooseBasicAiAction(state: RoomState, playerId: string, style: TrainingStyle): SubmittedAction {
  return model
    ? chooseTrainedAction(state, playerId, model, style)
    : chooseBotAction(state, playerId, "normal").action;
}

export function trainedPolicyHealth() {
  return {
    loaded: Boolean(model),
    strategyVersion: TRAINED_BOT_STRATEGY_VERSION,
    modelGames: model?.games ?? 0,
    modelDecisions: model?.decisions ?? 0,
    error: loadError ? "训练模型不可用" : null,
  };
}
