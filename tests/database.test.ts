import { describe, expect, it } from "vitest";
import { buildTrainingReplay } from "../server/database.js";
import { createFreshPlayer } from "../shared/engine.js";
import type { RoomState } from "../shared/types.js";

describe("匿名训练记录", () => {
  it("保留完整动作但移除昵称、凭证、房间码和内部玩家ID", () => {
    const state: RoomState = {
      roomCode: "SECRET",
      mode: "human-vs-bot",
      botSeed: 42,
      botStrategyVersion: "lookahead-v1",
      hostId: "private-human-id",
      phase: "finished",
      round: 2,
      deadlineAt: null,
      players: [
        { ...createFreshPlayer("private-human-id", "真实昵称", "secret-token"), alive: true },
        { ...createFreshPlayer("private-bot-id", "基础AI", "bot-secret", true, "bot"), alive: false, life: 0, botDifficulty: "normal" },
      ],
      astrologyRemaining: 0,
      submittedPlayerIds: [],
      revealedActions: [],
      actionHistory: [{
        round: 1,
        actions: [
          { playerId: "private-human-id", cardId: "charge", targetIds: [] },
          { playerId: "private-bot-id", cardId: "small_defense", targetIds: [] },
        ],
      }],
      events: [],
      winnerIds: ["private-human-id"],
    };

    const replay = buildTrainingReplay(state);
    const serialized = JSON.stringify(replay);
    expect(replay.rounds[0].actions[0]).toEqual({ seatId: "seat-1", cardId: "charge", targetSeatIds: [] });
    expect(replay.outcome.winnerSeatIds).toEqual(["seat-1"]);
    expect(serialized).not.toContain("真实昵称");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("private-human-id");
    expect(serialized).not.toContain("SECRET");
  });
});
