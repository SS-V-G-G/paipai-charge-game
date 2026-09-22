import { describe, expect, it } from "vitest";
import { chooseBotAction } from "../shared/bot.js";
import { createFreshPlayer } from "../shared/engine.js";
import { chooseTrainedAction, styledTrainingContextKey, trainingContextKey, type TrainedPolicyModel } from "../shared/training.js";
import type { RoomState } from "../shared/types.js";

function room(): RoomState {
  return {
    roomCode: "TRAIN",
    mode: "human-vs-bot",
    botSeed: 1,
    botStrategyVersion: "test",
    hostId: "left",
    phase: "selecting",
    round: 1,
    deadlineAt: null,
    players: [createFreshPlayer("left", "左", "left"), createFreshPlayer("right", "右", "right")],
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

describe("训练策略", () => {
  it("训练上下文不读取本轮隐藏提交", () => {
    const clean = room();
    const submitted = room();
    submitted.submittedPlayerIds = ["right"];
    expect(trainingContextKey(submitted, "left")).toBe(trainingContextKey(clean, "left"));
  });

  it("样本不足时回退基础策略", () => {
    const state = room();
    const context = styledTrainingContextKey(state, "left", "balanced");
    const model: TrainedPolicyModel = {
      schemaVersion: 2,
      modelType: "tabular-monte-carlo-v1",
      rulesVersion: "test",
      sourceStrategyVersion: "test",
      createdAt: "2026-09-22T00:00:00.000Z",
      games: 1,
      decisions: 2,
      global: { charge: { count: 1, valueSum: 0, valueSquareSum: 0 }, flower: { count: 1, valueSum: 1, valueSquareSum: 1 } },
      contexts: { [context]: { charge: { count: 1, valueSum: 0, valueSquareSum: 0 }, flower: { count: 1, valueSum: 1, valueSquareSum: 1 } } },
    };
    expect(chooseTrainedAction(state, "left", model)).toEqual(chooseBotAction(state, "left", "normal").action);
  });

  it("证据充分时选择显著优于基线的合法动作", () => {
    const state = room();
    const context = styledTrainingContextKey(state, "left", "balanced");
    const baselineCard = chooseBotAction(state, "left", "normal").action.cardId;
    const candidateCard = baselineCard === "flower" ? "push" : "flower";
    const model: TrainedPolicyModel = {
      schemaVersion: 2,
      modelType: "tabular-monte-carlo-v1",
      rulesVersion: "test",
      sourceStrategyVersion: "test",
      createdAt: "2026-09-22T00:00:00.000Z",
      games: 50,
      decisions: 50,
      global: {
        [baselineCard]: { count: 20, valueSum: -20, valueSquareSum: 20 },
        [candidateCard]: { count: 30, valueSum: 30, valueSquareSum: 30 },
      },
      contexts: {
        [context]: {
          [baselineCard]: { count: 20, valueSum: -20, valueSquareSum: 20 },
          [candidateCard]: { count: 30, valueSum: 30, valueSquareSum: 30 },
        },
      },
    };
    expect(chooseTrainedAction(state, "left", model).cardId).toBe(candidateCard);
  });
});
