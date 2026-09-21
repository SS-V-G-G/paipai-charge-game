import { describe, expect, it } from "vitest";
import { createFreshPlayer, resolveRound, validateAction } from "../shared/engine.js";
import type { RoomState, SubmittedAction } from "../shared/types.js";

function room(): RoomState {
  return {
    roomCode: "TEST01",
    hostId: "p1",
    phase: "selecting",
    round: 1,
    deadlineAt: null,
    players: [
      { ...createFreshPlayer("p1", "甲", "t1"), charge: 20 },
      { ...createFreshPlayer("p2", "乙", "t2"), charge: 20 },
      { ...createFreshPlayer("p3", "丙", "t3"), charge: 20 },
    ],
    astrologyRemaining: 0,
    submittedPlayerIds: [],
    revealedActions: [],
    events: [],
    winnerIds: [],
  };
}

function resolve(actions: SubmittedAction[]) {
  return resolveRound(room(), actions);
}

describe("基础攻击与防御", () => {
  it("飞刀可以破大防", () => {
    const result = resolve([
      { playerId: "p1", cardId: "flying_knife", targetIds: ["p2"] },
      { playerId: "p2", cardId: "big_defense", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(false);
  });

  it("飞刀不能破小反，会被反弹", () => {
    const result = resolve([
      { playerId: "p1", cardId: "flying_knife", targetIds: ["p2"] },
      { playerId: "p2", cardId: "small_reflect", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(true);
  });

  it("反手戳没有特殊破防标签，但8点伤害超过大防上限", () => {
    const result = resolve([
      { playerId: "p1", cardId: "backhand_stab", targetIds: ["p2"] },
      { playerId: "p2", cardId: "big_defense", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(false);
  });
});

describe("特殊规则", () => {
  it("场上出现赞时，鄙视击杀赞的双方而不杀自己", () => {
    const result = resolve([
      { playerId: "p1", cardId: "contempt", targetIds: ["p2"] },
      { playerId: "p2", cardId: "praise", targetIds: ["p3"] },
      { playerId: "p3", cardId: "charge", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(true);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p3")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p2")?.charge).toBe(0);
  });

  it("占星术持续期间禁止选择蓄", () => {
    const state = room();
    state.astrologyRemaining = 3;
    expect(validateAction(state, "p1", "charge", [])).toBe("占星术持续期间不能出蓄");
    expect(validateAction(state, "p1", "rub", [])).toBeNull();
  });
});
