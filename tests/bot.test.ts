import { describe, expect, it } from "vitest";
import { BOT_STRATEGY_VERSION, chooseBotAction, chooseHellBotAction, enumerateLegalActions } from "../shared/bot.js";
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
    rps: null,
    rpsHistory: [],
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

describe("地狱AI", () => {
  it("始终返回规则引擎认可的合法后手", () => {
    const state = botRoom();
    const opponentAction = { playerId: "human", cardId: "flower" as const, targetIds: [] };
    const decision = chooseHellBotAction(state, "bot", opponentAction);
    expect(validateAction(state, "bot", decision.action.cardId, decision.action.targetIds)).toBeNull();
    expect(decision.action).toEqual({ playerId: "bot", cardId: "shoot", targetIds: ["human"] });
    const result = resolveRound(state, [opponentAction, decision.action]);
    expect(result.winnerIds).toEqual(["bot"]);
  });

  it("面对小枪选择确定获胜的反制", () => {
    const state = botRoom();
    state.players.find((player) => player.id === "bot")!.charge = 2;
    const opponentAction = { playerId: "human", cardId: "small_gun" as const, targetIds: ["bot"] };
    const decision = chooseHellBotAction(state, "bot", opponentAction);
    expect(resolveRound(state, [opponentAction, decision.action]).winnerIds).toEqual(["bot"]);
  });

  it("面对拉时出蓄直接获胜", () => {
    const state = botRoom();
    const opponentAction = { playerId: "human", cardId: "pull" as const, targetIds: [] };
    const decision = chooseHellBotAction(state, "bot", opponentAction);
    expect(decision.action.cardId).toBe("charge");
    expect(resolveRound(state, [opponentAction, decision.action]).winnerIds).toEqual(["bot"]);
  });

  it("初始局面的每种合法出牌都不能直接击败地狱AI", () => {
    const state = botRoom();
    for (const opponentAction of enumerateLegalActions(state, "human")) {
      const decision = chooseHellBotAction(state, "bot", opponentAction);
      const result = resolveRound(state, [opponentAction, decision.action]);
      const bot = result.players.find((player) => player.id === "bot")!;
      const human = result.players.find((player) => player.id === "human")!;
      expect(bot.alive || !human.alive, `${opponentAction.cardId} 击败了地狱AI`).toBe(true);
    }
  });
});
