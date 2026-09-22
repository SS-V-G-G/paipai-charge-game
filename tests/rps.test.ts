import { describe, expect, it } from "vitest";
import { createFreshPlayer } from "../shared/engine.js";
import { compareRps, deterministicRpsChoice, findRpsDuel } from "../shared/rps.js";
import type { RoomState } from "../shared/types.js";

function room(): RoomState {
  return {
    roomCode: "RPS001",
    mode: "human-vs-bot",
    botSeed: 17,
    botStrategyVersion: "test",
    hostId: "p1",
    phase: "selecting",
    round: 3,
    deadlineAt: null,
    players: [
      { ...createFreshPlayer("p1", "甲", "t1"), charge: 5 },
      { ...createFreshPlayer("p2", "乙", "t2"), charge: 5 },
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

describe("鄙视猜拳", () => {
  it("覆盖石头剪刀布的胜负与平局", () => {
    expect(compareRps("rock", "scissors")).toBe("left");
    expect(compareRps("scissors", "paper")).toBe("left");
    expect(compareRps("paper", "rock")).toBe("left");
    expect(compareRps("rock", "paper")).toBe("right");
    expect(compareRps("paper", "paper")).toBe("tie");
  });

  it("仅当1v1中鄙视目标当回合花费蓄时触发", () => {
    const state = room();
    expect(findRpsDuel(state, [
      { playerId: "p1", cardId: "contempt", targetIds: ["p2"] },
      { playerId: "p2", cardId: "small_gun", targetIds: ["p1"] },
    ])).toEqual({ duelId: "rps-3-p1-p2", contemptPlayerId: "p1", targetPlayerId: "p2" });
    expect(findRpsDuel(state, [
      { playerId: "p1", cardId: "contempt", targetIds: ["p2"] },
      { playerId: "p2", cardId: "charge", targetIds: [] },
    ])).toBeNull();
  });

  it("超时和AI选择可由种子完全重放", () => {
    const first = deterministicRpsChoice(42, "round-1-player-2");
    expect(deterministicRpsChoice(42, "round-1-player-2")).toBe(first);
  });
});
