import { describe, expect, it } from "vitest";
import { BOT_STRATEGY_VERSION, chooseBotAction, enumerateLegalActions } from "../shared/bot.js";
import { createFreshPlayer, resolveRound, validateAction } from "../shared/engine.js";
import type { RoomState } from "../shared/types.js";

function botRoom(): RoomState {
  return {
    roomCode: "BOT001",
    mode: "human-vs-bot",
    botSeed: 20260921,
    botStrategyVersion: BOT_STRATEGY_VERSION,
    hostId: "human",
    phase: "selecting",
    round: 1,
    deadlineAt: null,
    players: [
      createFreshPlayer("human", "玩家", "human-token"),
      { ...createFreshPlayer("bot", "基础AI", "bot-token", true, "bot"), botDifficulty: "normal" },
    ],
    astrologyRemaining: 0,
    submittedPlayerIds: [],
    revealedActions: [],
    actionHistory: [],
    events: [],
    winnerIds: [],
  };
}

describe("基础策略AI", () => {
  it("只枚举规则引擎认可的合法动作", () => {
    const state = botRoom();
    const actions = enumerateLegalActions(state, "bot");
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) {
      expect(validateAction(state, action.playerId, action.cardId, action.targetIds)).toBeNull();
    }
  });

  it("相同状态和种子产生完全相同的决定", () => {
    const first = chooseBotAction(botRoom(), "bot", "normal");
    const second = chooseBotAction(botRoom(), "bot", "normal");
    expect(second).toEqual(first);
  });

  it("真人是否已经提交不会泄露暗牌或改变AI决定", () => {
    const clean = botRoom();
    const submitted = botRoom();
    submitted.submittedPlayerIds = ["human"];
    expect(chooseBotAction(submitted, "bot").action).toEqual(chooseBotAction(clean, "bot").action);
  });

  it("连续自博弈始终提交合法动作并记录可重放历史", () => {
    let state = botRoom();
    for (let turn = 0; turn < 30 && state.phase !== "finished"; turn += 1) {
      const botAction = chooseBotAction(state, "bot", "normal").action;
      const humanAction = chooseBotAction(state, "human", "normal").action;
      expect(validateAction(state, botAction.playerId, botAction.cardId, botAction.targetIds)).toBeNull();
      expect(validateAction(state, humanAction.playerId, humanAction.cardId, humanAction.targetIds)).toBeNull();
      const previousHistoryLength = state.actionHistory.length;
      state = resolveRound(state, [botAction, humanAction]);
      expect(state.actionHistory).toHaveLength(previousHistoryLength + 1);
    }
    expect(state.actionHistory.length).toBeGreaterThan(0);
  });
});
