import { Pool } from "pg";
import type { CardId } from "../shared/cards.js";
import { RULES_VERSION } from "../shared/engine.js";
import type { RoomState } from "../shared/types.js";

const DATA_POLICY_VERSION = "anonymous-training-v1";
const connectionString = process.env.DATABASE_URL?.trim();
const pool = connectionString
  ? new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

let ready = false;
let lastError: string | null = null;

export interface TrainingReplay {
  schemaVersion: 1;
  rulesVersion: string;
  botStrategyVersion: string;
  botSeed: number;
  mode: RoomState["mode"];
  players: Array<{
    seatId: string;
    controller: "human" | "bot";
    botDifficulty?: string;
  }>;
  rounds: Array<{
    round: number;
    actions: Array<{
      seatId: string;
      cardId: string;
      targetSeatIds: string[];
    }>;
  }>;
  outcome: {
    winnerSeatIds: string[];
    finalPlayers: Array<{
      seatId: string;
      alive: boolean;
      life: number;
      charge: number;
    }>;
  };
}

export function buildTrainingReplay(state: RoomState): TrainingReplay {
  const seatByPlayerId = new Map(state.players.map((player, index) => [player.id, `seat-${index + 1}`]));
  const seat = (playerId: string) => seatByPlayerId.get(playerId) ?? "unknown-seat";

  return {
    schemaVersion: 1,
    rulesVersion: RULES_VERSION,
    botStrategyVersion: state.botStrategyVersion,
    botSeed: state.botSeed,
    mode: state.mode,
    players: state.players.map((player) => ({
      seatId: seat(player.id),
      controller: player.controller,
      ...(player.botDifficulty ? { botDifficulty: player.botDifficulty } : {}),
    })),
    rounds: state.actionHistory.map((record) => ({
      round: record.round,
      actions: record.actions.map((action) => ({
        seatId: seat(action.playerId),
        cardId: action.cardId,
        targetSeatIds: action.targetIds.map(seat),
      })),
    })),
    outcome: {
      winnerSeatIds: state.winnerIds.map(seat),
      finalPlayers: state.players.map((player) => ({
        seatId: seat(player.id),
        alive: player.alive,
        life: player.life,
        charge: player.charge,
      })),
    },
  };
}

export async function initializeDatabase(): Promise<void> {
  if (!pool) {
    lastError = "DATABASE_URL未配置";
    return;
  }
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS training_games (
        id UUID PRIMARY KEY,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        rules_version TEXT NOT NULL,
        bot_strategy_version TEXT NOT NULL,
        room_mode TEXT NOT NULL,
        bot_difficulty TEXT,
        bot_seed BIGINT NOT NULL,
        player_count SMALLINT NOT NULL,
        round_count INTEGER NOT NULL,
        outcome TEXT NOT NULL,
        data_policy_version TEXT NOT NULL,
        replay JSONB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS training_games_completed_at_idx
        ON training_games (completed_at DESC);
      CREATE INDEX IF NOT EXISTS training_games_rules_version_idx
        ON training_games (rules_version, bot_strategy_version);
    `);
    ready = true;
    lastError = null;
  } catch (error) {
    ready = false;
    lastError = error instanceof Error ? error.message : "数据库初始化失败";
    console.error("训练数据库初始化失败，游戏将继续运行但不会记录对局", error);
  }
}

export async function recordCompletedGame(gameId: string, state: RoomState): Promise<boolean> {
  if (!pool || !ready || state.phase !== "finished") return false;
  const replay = buildTrainingReplay(state);
  const winner = replay.outcome.winnerSeatIds.length === 0
    ? "draw"
    : replay.outcome.winnerSeatIds.join(",");
  const botDifficulty = replay.players.find((player) => player.controller === "bot")?.botDifficulty ?? null;
  try {
    await pool.query(
      `INSERT INTO training_games (
        id, rules_version, bot_strategy_version, room_mode, bot_difficulty,
        bot_seed, player_count, round_count, outcome, data_policy_version, replay
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      ON CONFLICT (id) DO NOTHING`,
      [
        gameId,
        RULES_VERSION,
        state.botStrategyVersion,
        state.mode,
        botDifficulty,
        state.botSeed,
        state.players.length,
        state.actionHistory.length,
        winner,
        DATA_POLICY_VERSION,
        JSON.stringify(replay),
      ],
    );
    return true;
  } catch (error) {
    lastError = error instanceof Error ? error.message : "对局记录失败";
    console.error("保存匿名训练对局失败", error);
    return false;
  }
}

export function databaseHealth() {
  return {
    configured: Boolean(pool),
    ready,
    error: lastError ? "数据库暂不可用" : null,
  };
}

export async function trainingStats() {
  if (!pool || !ready) return { ...databaseHealth(), games: 0, rounds: 0, databaseBytes: 0, trainingTableBytes: 0 };
  try {
    const result = await pool.query<{
      games: string;
      rounds: string;
      database_bytes: string;
      training_table_bytes: string;
    }>(
      `SELECT
        COUNT(*) AS games,
        COALESCE(SUM(round_count), 0) AS rounds,
        pg_database_size(current_database()) AS database_bytes,
        pg_total_relation_size('training_games') AS training_table_bytes
      FROM training_games`,
    );
    return {
      ...databaseHealth(),
      games: Number(result.rows[0]?.games ?? 0),
      rounds: Number(result.rows[0]?.rounds ?? 0),
      databaseBytes: Number(result.rows[0]?.database_bytes ?? 0),
      trainingTableBytes: Number(result.rows[0]?.training_table_bytes ?? 0),
    };
  } catch (error) {
    lastError = error instanceof Error ? error.message : "统计查询失败";
    return { ...databaseHealth(), games: 0, rounds: 0, databaseBytes: 0, trainingTableBytes: 0 };
  }
}

export async function trainingGamesWithCard(cardId: CardId, mode: RoomState["mode"] | null, limit = 50) {
  if (!pool || !ready) return [];
  const result = await pool.query<{
    id: string;
    completed_at: Date;
    rules_version: string;
    bot_strategy_version: string;
    outcome: string;
    replay: TrainingReplay;
  }>(
    `SELECT id, completed_at, rules_version, bot_strategy_version, outcome, replay
    FROM training_games AS game
    WHERE ($1::text IS NULL OR game.room_mode = $1)
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(game.replay->'rounds') AS round_record,
             jsonb_array_elements(round_record->'actions') AS action_record
        WHERE action_record->>'cardId' = $2
      )
    ORDER BY completed_at DESC
    LIMIT $3`,
    [mode, cardId, Math.max(1, Math.min(limit, 100))],
  );
  return result.rows.map((row) => ({
    id: row.id,
    completedAt: row.completed_at,
    rulesVersion: row.rules_version,
    botStrategyVersion: row.bot_strategy_version,
    outcome: row.outcome,
    replay: row.replay,
  }));
}
