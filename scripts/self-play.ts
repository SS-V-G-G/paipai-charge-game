import { BOT_STRATEGY_VERSION, chooseBotAction } from "../shared/bot.js";
import { createFreshPlayer, resolveRound } from "../shared/engine.js";
import { compareRps, deterministicRpsChoice, findRpsDuel } from "../shared/rps.js";
import type { BotDifficulty, RoomState } from "../shared/types.js";

const gameCount = Math.max(1, Number(process.argv[2] ?? 100));
const maxRounds = Math.max(1, Number(process.argv[3] ?? 100));
const leftDifficulty = (process.argv[4] ?? "normal") as BotDifficulty;
const rightDifficulty = (process.argv[5] ?? "normal") as BotDifficulty;
const wins = { left: 0, right: 0, draw: 0, timeout: 0 };
const cardCounts = new Map<string, number>();
let totalRounds = 0;

function createState(seed: number): RoomState {
  return {
    roomCode: `SIM${String(seed).padStart(3, "0")}`,
    mode: "human-vs-bot",
    botSeed: seed,
    botStrategyVersion: BOT_STRATEGY_VERSION,
    hostId: "left",
    phase: "selecting",
    round: 1,
    deadlineAt: null,
    players: [
      { ...createFreshPlayer("left", "左AI", "left", true, "bot"), botDifficulty: leftDifficulty },
      { ...createFreshPlayer("right", "右AI", "right", true, "bot"), botDifficulty: rightDifficulty },
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

for (let game = 1; game <= gameCount; game += 1) {
  let state = createState(game);
  while (state.phase !== "finished" && state.actionHistory.length < maxRounds) {
    const left = chooseBotAction(state, "left", leftDifficulty).action;
    const right = chooseBotAction(state, "right", rightDifficulty).action;
    cardCounts.set(left.cardId, (cardCounts.get(left.cardId) ?? 0) + 1);
    cardCounts.set(right.cardId, (cardCounts.get(right.cardId) ?? 0) + 1);
    const duel = findRpsDuel(state, [left, right]);
    if (!duel) {
      state = resolveRound(state, [left, right]);
      continue;
    }

    let attempt = 1;
    let comparison: ReturnType<typeof compareRps> = "tie";
    while (comparison === "tie") {
      const contemptChoice = deterministicRpsChoice(state.botSeed, `${duel.duelId}:${attempt}:${duel.contemptPlayerId}`);
      const targetChoice = deterministicRpsChoice(state.botSeed, `${duel.duelId}:${attempt}:${duel.targetPlayerId}`);
      comparison = compareRps(contemptChoice, targetChoice);
      state.rpsHistory.push({
        duelId: duel.duelId,
        gameRound: state.round,
        attempt,
        contemptPlayerId: duel.contemptPlayerId,
        targetPlayerId: duel.targetPlayerId,
        choices: [
          { playerId: duel.contemptPlayerId, choice: contemptChoice },
          { playerId: duel.targetPlayerId, choice: targetChoice },
        ],
        result: comparison === "tie" ? "tie" : comparison === "left" ? "contempt-won" : "target-won",
      });
      attempt += 1;
    }
    state = resolveRound(state, [left, right]);
    state.phase = "finished";
    if (comparison === "left") {
      state.players.forEach((player) => { player.alive = false; player.life = 0; });
      state.winnerIds = [];
    } else {
      state.players.forEach((player) => {
        player.alive = player.id === duel.targetPlayerId;
        player.life = player.alive ? Math.max(1, player.life) : 0;
      });
      state.winnerIds = [duel.targetPlayerId];
    }
  }
  totalRounds += state.actionHistory.length;
  if (state.phase !== "finished") wins.timeout += 1;
  else if (state.winnerIds.length === 0) wins.draw += 1;
  else if (state.winnerIds[0] === "left") wins.left += 1;
  else wins.right += 1;
}

const popularCards = [...cardCounts.entries()]
  .sort((left, right) => right[1] - left[1])
  .slice(0, 8)
  .map(([cardId, count]) => `${cardId}:${count}`)
  .join("  ");

console.log(`策略 ${BOT_STRATEGY_VERSION}｜${leftDifficulty} vs ${rightDifficulty}`);
console.log(`对局 ${gameCount}｜平均回合 ${(totalRounds / gameCount).toFixed(2)}｜左胜 ${wins.left}｜右胜 ${wins.right}｜平局 ${wins.draw}｜超时 ${wins.timeout}`);
console.log(`常用牌 ${popularCards}`);
