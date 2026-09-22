import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { BASE_CARD_IDS } from "../shared/cards.js";

const baseUrl = (process.argv[2] ?? "https://paipai-charge-game.onrender.com").replace(/\/$/, "");
const outputPath = resolve(process.argv[3] ?? "training-data/render-replays.jsonl");
const games = new Map<string, unknown>();

for (const cardId of BASE_CARD_IDS) {
  const response = await fetch(`${baseUrl}/api/training/diagnostics?card=${encodeURIComponent(cardId)}&limit=100`);
  if (!response.ok) throw new Error(`下载 ${cardId} 回放失败: HTTP ${response.status}`);
  const payload = await response.json() as { games: Array<{ id: string }> };
  for (const game of payload.games) games.set(game.id, game);
}
const drawResponse = await fetch(`${baseUrl}/api/training/diagnostics?outcome=draw&limit=100`);
if (!drawResponse.ok) throw new Error(`下载平局回放失败: HTTP ${drawResponse.status}`);
const drawPayload = await drawResponse.json() as { games: Array<{ id: string }> };
for (const game of drawPayload.games) games.set(game.id, game);

mkdirSync(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { encoding: "utf8" });
for (const game of games.values()) output.write(`${JSON.stringify(game)}\n`);
output.end();
await new Promise<void>((done, reject) => {
  output.on("finish", done);
  output.on("error", reject);
});
console.log(`已从 Render 公开诊断接口下载并去重 ${games.size} 局 -> ${outputPath}`);
