import { describe, expect, it } from "vitest";
import { createFreshPlayer, resolveRound, validateAction } from "../shared/engine.js";
import type { RoomState, SubmittedAction } from "../shared/types.js";

function room(): RoomState {
  return {
    roomCode: "TEST01",
    mode: "multiplayer",
    botSeed: 12345,
    botStrategyVersion: "test",
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
    actionHistory: [],
    rps: null,
    rpsHistory: [],
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

  it("互相攻击时大伤害压掉小伤害", () => {
    const result = resolve([
      { playerId: "p1", cardId: "small_gun", targetIds: ["p2"] },
      { playerId: "p2", cardId: "cannon", targetIds: ["p1"] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(true);
    expect(result.events.some((item) => item.type === "clash" && item.text.includes("压掉"))).toBe(true);
  });

  it("互相攻击且伤害相同时双方抵消", () => {
    const result = resolve([
      { playerId: "p1", cardId: "small_gun", targetIds: ["p2"] },
      { playerId: "p2", cardId: "small_gun", targetIds: ["p1"] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(true);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(true);
    expect(result.events.some((item) => item.type === "clash" && item.text.includes("双方攻击抵消"))).toBe(true);
  });

  it("全场攻击会参与互攻，并以大伤害压掉小伤害", () => {
    const state = room();
    state.players = state.players.slice(0, 2);
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "super_flying_knife", targetIds: [] },
      { playerId: "p2", cardId: "small_gun", targetIds: ["p1"] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(true);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(false);
    expect(result.winnerIds).toEqual(["p1"]);
    expect(result.events.some((item) => item.type === "clash" && item.text.includes("超级飞刀压掉"))).toBe(true);
  });

  it("全场攻击与同伤害定向攻击互相抵消", () => {
    const state = room();
    state.players = state.players.slice(0, 2);
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "shotgun", targetIds: [] },
      { playerId: "p2", cardId: "small_gun", targetIds: ["p1"] },
    ]);
    expect(result.players.every((player) => player.alive)).toBe(true);
    expect(result.phase).toBe("selecting");
  });

  it("普通结算全员同时死亡时直接判为平局", () => {
    const state = room();
    state.players = state.players.slice(0, 2);
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "contempt", targetIds: ["p2"] },
      { playerId: "p2", cardId: "contempt", targetIds: ["p1"] },
    ]);
    expect(result.phase).toBe("finished");
    expect(result.round).toBe(1);
    expect(result.players.every((player) => !player.alive && player.life === 0)).toBe(true);
    expect(result.winnerIds).toEqual([]);
    expect(result.events.at(-1)?.text).toContain("本局平局");
  });
});

describe("特殊规则", () => {
  it("拉改为全场判定，任一其他玩家出蓄时自己生命清零", () => {
    const state = room();
    expect(validateAction(state, "p1", "pull", [])).toBeNull();
    expect(validateAction(state, "p1", "pull", ["p2"])).toBe("这张牌不应在提交时指定目标");
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "pull", targetIds: [] },
      { playerId: "p2", cardId: "small_reflect", targetIds: [] },
      { playerId: "p3", cardId: "charge", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p1")?.charge).toBe(20);
  });

  it("拉按全场小反和大反人数累计获得蓄", () => {
    const state = room();
    state.players.push({ ...createFreshPlayer("p4", "丁", "t4"), charge: 20 });
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "pull", targetIds: [] },
      { playerId: "p2", cardId: "small_reflect", targetIds: [] },
      { playerId: "p3", cardId: "small_reflect", targetIds: [] },
      { playerId: "p4", cardId: "big_reflect", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.charge).toBe(44);
  });

  it("全场无人出蓄、小反、大反时，拉获得3蓄", () => {
    const result = resolve([
      { playerId: "p1", cardId: "pull", targetIds: [] },
      { playerId: "p2", cardId: "small_defense", targetIds: [] },
      { playerId: "p3", cardId: "flower", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.charge).toBe(23);
  });

  it("金鸡独立状态免疫拉中蓄的生命清零", () => {
    const state = room();
    state.players.find((player) => player.id === "p1")!.goldenRoosterActive = true;
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "pull", targetIds: [] },
      { playerId: "p2", cardId: "charge", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(true);
    expect(result.events.some((item) => item.type === "blocked" && item.text.includes("金鸡独立"))).toBe(true);
  });

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

  it("抬枪本轮无敌并获得免费大枪", () => {
    const result = resolve([
      { playerId: "p1", cardId: "small_gun", targetIds: ["p2"] },
      { playerId: "p2", cardId: "raise_gun", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    const target = result.players.find((player) => player.id === "p2");
    expect(target?.alive).toBe(true);
    expect(target?.freeBigGuns).toBe(1);
  });

  it("大枪破除抬枪无敌后造成原本的6点伤害", () => {
    const state = room();
    const target = state.players.find((player) => player.id === "p2")!;
    target.life = 10;
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "big_gun", targetIds: ["p2"] },
      { playerId: "p2", cardId: "raise_gun", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p2")?.life).toBe(4);
    expect(result.events.some((item) => item.type === "break" && item.text.includes("抬枪无敌"))).toBe(true);
  });

  it("赞使双方无敌并各获得1蓄", () => {
    const result = resolve([
      { playerId: "p1", cardId: "praise", targetIds: ["p2"] },
      { playerId: "p2", cardId: "small_defense", targetIds: [] },
      { playerId: "p3", cardId: "super_flying_knife", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p1")?.alive).toBe(true);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(true);
    expect(result.players.find((player) => player.id === "p1")?.charge).toBe(21);
    expect(result.players.find((player) => player.id === "p2")?.charge).toBe(21);
  });

  it("射必须事先指定目标，并直接击杀该目标出的花", () => {
    const state = room();
    expect(validateAction(state, "p1", "shoot", [])).toBe("请选择一名目标");
    expect(validateAction(state, "p1", "shoot", ["p2"])).toBeNull();
    const result = resolveRound(state, [
      { playerId: "p1", cardId: "shoot", targetIds: ["p2"] },
      { playerId: "p2", cardId: "flower", targetIds: [] },
      { playerId: "p3", cardId: "small_defense", targetIds: [] },
    ]);
    expect(result.players.find((player) => player.id === "p2")?.alive).toBe(false);
    expect(result.players.find((player) => player.id === "p2")?.charge).toBe(20);
  });

  it("相同局面与出牌在不同到达顺序下产生完全相同的可重放结果", () => {
    const actions: SubmittedAction[] = [
      { playerId: "p1", cardId: "small_gun", targetIds: ["p2"] },
      { playerId: "p2", cardId: "cannon", targetIds: ["p1"] },
      { playerId: "p3", cardId: "charge", targetIds: [] },
    ];
    const forward = resolveRound(room(), actions);
    const reverse = resolveRound(room(), actions.slice().reverse());
    expect(reverse).toEqual(forward);
  });
});
