import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BOT_STRATEGY_VERSION, enumerateLegalActions } from "../shared/bot.js";
import { createFreshPlayer, RULES_VERSION } from "../shared/engine.js";
import { TRAINING_SCHEMA_VERSION, classifyTrainingStyle, resolveTrainingRound, styledTrainingContextKey, type SelfPlayGame, type TrainingDecision, type TrainingStyle } from "../shared/training.js";
import type { RoomState, SubmittedAction } from "../shared/types.js";

interface StoredReplay {
  rulesVersion?: string;
  botStrategyVersion?: string;
  botSeed: number;
  mode: RoomState["mode"];
  players: Array<{ seatId: string; controller: "human" | "bot"; botDifficulty?: string }>;
  rounds: Array<{ round: number; actions: Array<{ seatId: string; cardId: SubmittedAction["cardId"]; targetSeatIds: string[] }> }>;
  outcome: { winnerSeatIds: string[] };
}

interface ReplayRow {
  id: string;
  rulesVersion?: string;
  botStrategyVersion?: string;
  replay: StoredReplay;
}

const inputPath = resolve(process.argv[2] ?? "training-data/render-replays.jsonl");
const outputPath = resolve(process.argv[3] ?? "training-data/render-training.jsonl");
mkdirSync(dirname(outputPath), { recursive: true });
const output = createWriteStream(outputPath, { encoding: "utf8" });
let converted = 0;
let skipped = 0;

function initialState(row: ReplayRow): { state: RoomState; seatToId: Map<string, string> } {
  const replay = row.replay;
  const seatToId = new Map(replay.players.map((player, index) => [player.seatId, index === 0 ? "left" : "right"]));
  return {
    seatToId,
    state: {
      roomCode: `REPLAY-${row.id}`,
      mode: replay.mode,
      botSeed: replay.botSeed,
      botStrategyVersion: row.botStrategyVersion ?? replay.botStrategyVersion ?? BOT_STRATEGY_VERSION,
      hostId: "left",
      phase: "selecting",
      round: 1,
      deadlineAt: null,
      players: replay.players.map((player, index) => ({
        ...createFreshPlayer(index === 0 ? "left" : "right", player.seatId, player.seatId, true, player.controller),
        ...(player.botDifficulty && ["easy", "normal", "hard", "hell"].includes(player.botDifficulty)
          ? { botDifficulty: player.botDifficulty as "easy" | "normal" | "hard" | "hell" }
          : {}),
      })),
      astrologyRemaining: 0,
      submittedPlayerIds: [],
      revealedActions: [],
      actionHistory: [],
      rps: null,
      rpsHistory: [],
      events: [],
      winnerIds: [],
    },
  };
}

const lines = createInterface({ input: createReadStream(inputPath, { encoding: "utf8" }), crlfDelay: Infinity });
for await (const line of lines) {
  if (!line.trim()) continue;
  const row = JSON.parse(line) as ReplayRow;
  const rulesVersion = row.rulesVersion ?? row.replay.rulesVersion;
  if (rulesVersion !== RULES_VERSION || row.replay.players.length !== 2) {
    skipped += 1;
    continue;
  }
  const { state: firstState, seatToId } = initialState(row);
  const styleByPlayer = new Map<string, TrainingStyle>();
  for (const player of row.replay.players) {
    const playerId = seatToId.get(player.seatId)!;
    const cards = row.replay.rounds.flatMap((round) => round.actions
      .filter((action) => action.seatId === player.seatId)
      .map((action) => action.cardId));
    styleByPlayer.set(playerId, classifyTrainingStyle(cards));
  }
  let state = firstState;
  const decisions: TrainingDecision[] = [];
  let valid = true;
  for (const round of row.replay.rounds) {
    if (state.phase === "finished") break;
    const actions: SubmittedAction[] = round.actions.map((action) => ({
      playerId: seatToId.get(action.seatId) ?? "",
      cardId: action.cardId,
      targetIds: action.targetSeatIds.map((seatId) => seatToId.get(seatId) ?? ""),
    }));
    if (actions.length !== 2 || actions.some((action) => !action.playerId || action.targetIds.some((id) => !id))) {
      valid = false;
      break;
    }
    for (const action of actions) {
      const legalCardIds = enumerateLegalActions(state, action.playerId).map((candidate) => candidate.cardId);
      if (!legalCardIds.includes(action.cardId)) {
        valid = false;
        break;
      }
      const opponentAction = actions.find((candidate) => candidate.playerId !== action.playerId)!;
      const style = styleByPlayer.get(action.playerId) ?? "balanced";
      decisions.push({
        playerId: action.playerId,
        style,
        contextKey: styledTrainingContextKey(state, action.playerId, style),
        legalCardIds,
        actionCardId: action.cardId,
        opponentActionCardId: opponentAction.cardId,
      });
    }
    if (!valid) break;
    state = resolveTrainingRound(state, actions);
  }
  if (!valid) {
    skipped += 1;
    continue;
  }
  const winnerSeat = row.replay.outcome.winnerSeatIds[0];
  const outcome: SelfPlayGame["outcome"] = !winnerSeat ? "draw" : seatToId.get(winnerSeat) as "left" | "right";
  const game: SelfPlayGame = {
    schemaVersion: TRAINING_SCHEMA_VERSION,
    rulesVersion,
    strategyVersion: row.botStrategyVersion ?? row.replay.botStrategyVersion ?? "unknown",
    gameId: row.id,
    source: "render-replay",
    seed: row.replay.botSeed,
    rounds: row.replay.rounds.length,
    outcome,
    decisions,
  };
  output.write(`${JSON.stringify(game)}\n`);
  converted += 1;
}
output.end();
await new Promise<void>((done, reject) => {
  output.on("finish", done);
  output.on("error", reject);
});
console.log(`已转换 ${converted} 局，跳过 ${skipped} 局（旧规则、非双人或不可重放） -> ${outputPath}`);
