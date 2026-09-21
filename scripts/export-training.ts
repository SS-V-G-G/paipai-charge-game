import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("请先设置DATABASE_URL");

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
try {
  const result = await pool.query<{
    id: string;
    completed_at: Date;
    replay: unknown;
  }>("SELECT id, completed_at, replay FROM training_games ORDER BY completed_at ASC");
  for (const row of result.rows) {
    process.stdout.write(`${JSON.stringify({ id: row.id, completedAt: row.completed_at, replay: row.replay })}\n`);
  }
} finally {
  await pool.end();
}
