import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { BOT_STRATEGY_VERSION, chooseBotAction, chooseHellBotAction } from "../shared/bot.js";
import { CARD_DEFINITIONS, type CardId } from "../shared/cards.js";
import { createFreshPlayer, resetPlayerForGame, resolveRound, validateAction } from "../shared/engine.js";
import { compareRps, deterministicRpsChoice, findRpsDuel, type RpsDuel } from "../shared/rps.js";
import { databaseHealth, initializeDatabase, recordCompletedGame, trainingGameDiagnostics, trainingStats } from "./database.js";
import { TRAINED_BOT_STRATEGY_VERSION, basicAiStyleLabel, chooseBasicAiAction, selectBasicAiStyle, trainedPolicyHealth } from "./trained-policy.js";
import type {
  ClientMessage,
  BotDifficulty,
  PublicRoomState,
  RoomMode,
  RoomState,
  RpsChoice,
  ServerMessage,
  SubmittedAction,
} from "../shared/types.js";

const app = express();
const httpServer = createServer(app);
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : true;
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
  transports: ["websocket", "polling"],
  pingTimeout: 20_000,
  pingInterval: 25_000,
});

app.use(express.json({ limit: "32kb" }));

function createCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

function seedFromCode(code: string): number {
  return [...code].reduce((seed, character) => Math.imul(seed ^ character.charCodeAt(0), 16777619) >>> 0, 2166136261);
}

class GameRoom {
  readonly code: string;
  state: RoomState;
  private submissions = new Map<string, SubmittedAction>();
  private rpsChoices = new Map<string, RpsChoice>();
  private timer: NodeJS.Timeout | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private gameId: string | null = null;
  private gameSequence = 0;
  private botStyle = selectBasicAiStyle(0, 0);

  constructor(code: string, mode: RoomMode, private readonly botDifficulty: BotDifficulty) {
    this.code = code;
    this.state = {
      roomCode: code,
      mode,
      botSeed: seedFromCode(code),
      botStrategyVersion: botDifficulty === "hell" ? BOT_STRATEGY_VERSION : TRAINED_BOT_STRATEGY_VERSION,
      hostId: "",
      phase: "lobby",
      round: 0,
      deadlineAt: null,
      players: [],
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

  addOrReconnect(name: string, token: string) {
    let player = this.state.players.find((item) => item.reconnectToken === token);
    if (!player) {
      if (this.state.phase !== "lobby") throw new Error("游戏已经开始");
      if (this.state.mode === "human-vs-bot" && this.state.players.some((item) => item.controller === "human")) {
        throw new Error("这是单人人机房间");
      }
      if (this.state.players.length >= 10) throw new Error("房间已满");
      player = createFreshPlayer(crypto.randomUUID(), name.slice(0, 12), token);
      this.state.players.push(player);
      if (!this.state.hostId) this.state.hostId = player.id;
      if (this.state.mode === "human-vs-bot") this.addBot();
    } else {
      player.connected = true;
      player.name = name.slice(0, 12);
    }
    return player;
  }

  private addBot() {
    if (this.state.players.some((item) => item.controller === "bot")) return;
    const botName = this.botDifficulty === "hell" ? "地狱AI" : "基础AI";
    const bot = createFreshPlayer(`bot-${this.code}`, botName, `bot:${this.code}`, true, "bot");
    bot.ready = true;
    bot.botDifficulty = this.botDifficulty;
    this.state.players.push(bot);
  }

  disconnect(playerId: string) {
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) return;
    if (player.controller === "bot") return;
    const stillConnected = io.sockets.adapter.rooms.get(`player:${playerId}`)?.size ?? 0;
    player.connected = stillConnected > 0;
    if (!player.connected && this.state.hostId === player.id && this.state.mode !== "human-vs-bot") {
      this.state.hostId = this.state.players.find((item) => item.connected)?.id ?? player.id;
    }
    this.broadcast();

    if (this.state.phase === "lobby" && !player.connected) {
      setTimeout(() => {
        const current = this.state.players.find((item) => item.id === playerId);
        if (this.state.phase !== "lobby" || current?.connected) return;
        this.state.players = this.state.players.filter((item) => item.id !== playerId);
        if (this.state.hostId === playerId) {
          this.state.hostId = this.state.mode === "human-vs-bot"
            ? ""
            : this.state.players.find((item) => item.connected)?.id ?? "";
        }
        this.broadcast();
      }, 60_000);
    }
  }

  async handle(playerId: string, message: ClientMessage) {
    switch (message.type) {
      case "ready":
        this.toggleReady(playerId);
        break;
      case "startGame":
        this.startGame(playerId);
        break;
      case "submit":
        this.submitAction(playerId, message.roundId, message.cardId, message.targetIds);
        break;
      case "rpsSubmit":
        this.submitRps(playerId, message.duelId, message.choice);
        break;
      case "playAgain":
        this.returnToLobby(playerId);
        break;
    }
  }

  sendInitial(socket: Socket, playerId: string) {
    this.sendSocket(socket, { type: "welcome", playerId, roomCode: this.code });
    this.sendSocket(socket, { type: "state", state: this.publicState(playerId) });
  }

  private toggleReady(playerId: string) {
    if (this.state.phase !== "lobby") throw new Error("当前不能更改准备状态");
    const player = this.state.players.find((item) => item.id === playerId);
    if (!player) throw new Error("玩家不存在");
    if (player.controller === "bot") throw new Error("不能操作AI玩家");
    player.ready = !player.ready;
    this.broadcast();
  }

  private startGame(playerId: string) {
    if (this.state.phase !== "lobby") throw new Error("当前不能开始游戏");
    if (this.state.hostId !== playerId) throw new Error("只有房主可以开始游戏");
    if (this.state.players.length < 2) throw new Error("至少需要2名玩家");
    if (this.state.players.some((player) => !player.ready)) throw new Error("还有玩家没有准备");

    this.gameSequence += 1;
    this.botStyle = selectBasicAiStyle(this.state.botSeed, this.gameSequence);
    this.state.botStrategyVersion = this.botDifficulty === "hell" ? BOT_STRATEGY_VERSION : TRAINED_BOT_STRATEGY_VERSION;
    this.state.players = this.state.players.map((player) => ({
      ...resetPlayerForGame(player),
      name: player.controller === "bot" && this.botDifficulty !== "hell"
        ? `基础AI·${basicAiStyleLabel(this.botStyle)}`
        : player.name,
      ready: player.controller === "bot",
    }));
    this.state.phase = "selecting";
    this.state.round = 1;
    this.state.astrologyRemaining = 0;
    this.state.submittedPlayerIds = [];
    this.state.revealedActions = [];
    this.state.actionHistory = [];
    this.state.rps = null;
    this.state.rpsHistory = [];
    this.state.events = [];
    this.state.winnerIds = [];
    this.gameId = crypto.randomUUID();
    this.submissions.clear();
    this.rpsChoices.clear();
    this.schedule("selecting", 60_000);
    this.queueBotMove();
    this.broadcast();
  }

  private submitAction(playerId: string, roundId: number, cardId: CardId, targetIds: string[]) {
    if (this.state.phase !== "selecting") throw new Error("当前不是出牌阶段");
    if (roundId !== this.state.round) throw new Error("回合编号已经过期");
    if (this.submissions.has(playerId)) throw new Error("本轮已经提交，不能再次修改");
    if (!(cardId in CARD_DEFINITIONS)) throw new Error("未知卡牌");
    const error = validateAction(this.state, playerId, cardId, targetIds);
    if (error) throw new Error(error);

    this.submissions.set(playerId, { playerId, cardId, targetIds: [...new Set(targetIds)] });
    this.state.submittedPlayerIds.push(playerId);
    this.broadcast();
    if (this.submissions.size >= this.state.players.filter((player) => player.alive).length) {
      this.beginReveal();
    } else if (this.state.players.find((player) => player.id === playerId)?.controller === "human") {
      this.queueBotMove();
    }
  }

  private beginReveal() {
    this.clearTimer();
    this.clearBotTimer();
    const actions = [...this.submissions.values()];
    this.state.revealedActions = actions.map((action) => ({ ...action }));
    const duel = findRpsDuel(this.state, actions);
    if (duel) {
      this.startRps(duel);
      return;
    }
    this.resolveNow();
  }

  private startRps(duel: RpsDuel) {
    this.rpsChoices.clear();
    this.state.phase = "rockPaperScissors";
    this.state.rps = {
      ...duel,
      attempt: 1,
      submittedPlayerIds: [],
      lastAttemptWasTie: false,
    };
    this.state.events = [{
      id: `rps-start-${this.state.round}`,
      type: "system",
      text: "鄙视目标本回合花费了蓄，进入猜拳时间",
      sourceId: duel.contemptPlayerId,
      targetIds: [duel.targetPlayerId],
    }];
    this.scheduleRpsTimeout();
    this.queueBotRpsMove();
    this.broadcast();
  }

  private submitRps(playerId: string, duelId: string, choice: RpsChoice) {
    const rps = this.state.rps;
    if (this.state.phase !== "rockPaperScissors" || !rps) throw new Error("当前不是猜拳阶段");
    if (rps.duelId !== duelId) throw new Error("猜拳编号已经过期");
    if (![rps.contemptPlayerId, rps.targetPlayerId].includes(playerId)) throw new Error("你不是本次猜拳参与者");
    if (!["rock", "paper", "scissors"].includes(choice)) throw new Error("未知猜拳选项");
    if (this.rpsChoices.has(playerId)) throw new Error("本轮猜拳已经提交");

    this.rpsChoices.set(playerId, choice);
    rps.submittedPlayerIds.push(playerId);
    if (this.rpsChoices.size === 2) this.settleRps();
    else {
      this.queueBotRpsMove();
      this.broadcast();
    }
  }

  private settleRps() {
    const rps = this.state.rps;
    if (!rps) return;
    const contemptChoice = this.rpsChoices.get(rps.contemptPlayerId);
    const targetChoice = this.rpsChoices.get(rps.targetPlayerId);
    if (!contemptChoice || !targetChoice) return;

    const comparison = compareRps(contemptChoice, targetChoice);
    const result = comparison === "tie" ? "tie" : comparison === "left" ? "contempt-won" : "target-won";
    this.state.rpsHistory.push({
      duelId: rps.duelId,
      gameRound: this.state.round,
      attempt: rps.attempt,
      contemptPlayerId: rps.contemptPlayerId,
      targetPlayerId: rps.targetPlayerId,
      choices: [
        { playerId: rps.contemptPlayerId, choice: contemptChoice },
        { playerId: rps.targetPlayerId, choice: targetChoice },
      ],
      result,
    });

    if (comparison === "tie") {
      this.rpsChoices.clear();
      rps.attempt += 1;
      rps.submittedPlayerIds = [];
      rps.lastAttemptWasTie = true;
      this.state.events.push({
        id: `rps-tie-${this.state.round}-${rps.attempt - 1}`,
        type: "system",
        text: "双方猜拳平局，继续猜拳",
        targetIds: [rps.contemptPlayerId, rps.targetPlayerId],
      });
      this.scheduleRpsTimeout();
      this.queueBotRpsMove();
      this.broadcast();
      return;
    }

    this.clearTimer();
    this.clearBotTimer();
    const contemptPlayerId = rps.contemptPlayerId;
    const targetPlayerId = rps.targetPlayerId;
    this.state = resolveRound(this.state, [...this.submissions.values()]);
    this.state.phase = "finished";
    this.state.deadlineAt = null;
    this.state.submittedPlayerIds = [];
    this.state.rps = null;
    if (comparison === "left") {
      for (const player of this.state.players) {
        player.life = 0;
        player.alive = false;
      }
      this.state.winnerIds = [];
      this.state.events.push({
        id: `rps-result-${this.state.round}-${this.state.rpsHistory.length}`,
        type: "system",
        text: "鄙视发起者赢得猜拳，本局按规则判为平局",
        sourceId: contemptPlayerId,
        targetIds: [targetPlayerId],
      });
    } else {
      for (const player of this.state.players) {
        if (player.id === targetPlayerId) {
          player.life = Math.max(1, player.life);
          player.alive = true;
        } else {
          player.life = 0;
          player.alive = false;
        }
      }
      this.state.winnerIds = [targetPlayerId];
      const targetName = this.state.players.find((player) => player.id === targetPlayerId)?.name ?? "鄙视目标";
      this.state.events.push({
        id: `rps-result-${this.state.round}-${this.state.rpsHistory.length}`,
        type: "system",
        text: `鄙视发起者猜拳落败，${targetName}获得胜利`,
        sourceId: targetPlayerId,
        targetIds: [contemptPlayerId],
      });
    }
    this.submissions.clear();
    this.rpsChoices.clear();
    this.recordFinishedGame();
    this.broadcast();
  }

  private resolveNow() {
    this.clearTimer();
    this.state.phase = "resolving";
    this.state = resolveRound(this.state, [...this.submissions.values()]);
    this.submissions.clear();
    if (this.state.phase === "finished") this.recordFinishedGame();
    if (this.state.phase === "selecting") {
      this.schedule("selecting", 60_000);
      this.queueBotMove();
    }
    this.broadcast();
  }

  private returnToLobby(playerId: string) {
    if (this.state.phase !== "finished") throw new Error("当前不能返回房间");
    if (this.state.hostId !== playerId) throw new Error("只有房主可以发起再来一局");
    this.state.phase = "lobby";
    this.state.round = 0;
    this.state.astrologyRemaining = 0;
    this.state.players = this.state.players.map((player) => ({
      ...resetPlayerForGame(player),
      ready: player.controller === "bot",
    }));
    this.state.submittedPlayerIds = [];
    this.state.revealedActions = [];
    this.state.actionHistory = [];
    this.state.rps = null;
    this.state.rpsHistory = [];
    this.state.events = [];
    this.state.winnerIds = [];
    this.gameId = null;
    this.rpsChoices.clear();
    this.clearTimer();
    this.clearBotTimer();
    this.broadcast();
  }

  private queueBotMove() {
    this.clearBotTimer();
    if (this.state.mode !== "human-vs-bot" || this.state.phase !== "selecting") return;
    const bot = this.state.players.find((player) => player.controller === "bot" && player.alive);
    if (!bot) return;
    const round = this.state.round;
    const difficulty = bot.botDifficulty ?? this.botDifficulty;
    const opponent = this.state.players.find((player) => player.controller === "human" && player.alive);
    const opponentAction = opponent ? this.submissions.get(opponent.id) : undefined;
    if (difficulty === "hell" && !opponentAction) return;
    const decision = difficulty === "hell"
      ? chooseHellBotAction(this.state, bot.id, opponentAction!)
      : difficulty === "normal"
        ? { action: chooseBasicAiAction(this.state, bot.id, this.botStyle) }
        : chooseBotAction(this.state, bot.id, difficulty);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.state.phase !== "selecting" || this.state.round !== round || this.submissions.has(bot.id)) return;
      try {
        this.submitAction(bot.id, round, decision.action.cardId, decision.action.targetIds);
      } catch (error) {
        console.error("AI提交动作失败", error);
      }
    }, difficulty === "hell" ? 280 : 650);
  }

  private queueBotRpsMove() {
    this.clearBotTimer();
    const rps = this.state.rps;
    if (this.state.mode !== "human-vs-bot" || this.state.phase !== "rockPaperScissors" || !rps) return;
    const bot = this.state.players.find((player) => player.controller === "bot" && [rps.contemptPlayerId, rps.targetPlayerId].includes(player.id));
    if (!bot || this.rpsChoices.has(bot.id)) return;
    const attempt = rps.attempt;
    const duelId = rps.duelId;
    const difficulty = bot.botDifficulty ?? this.botDifficulty;
    const opponentId = bot.id === rps.contemptPlayerId ? rps.targetPlayerId : rps.contemptPlayerId;
    const opponentChoice = this.rpsChoices.get(opponentId);
    if (difficulty === "hell" && !opponentChoice) return;
    const choice = difficulty === "hell"
      ? this.winningRpsChoice(opponentChoice!)
      : deterministicRpsChoice(this.state.botSeed, `${duelId}:${attempt}:${bot.id}`);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.state.phase !== "rockPaperScissors" || this.state.rps?.duelId !== duelId || this.state.rps.attempt !== attempt) return;
      try {
        this.submitRps(bot.id, duelId, choice);
      } catch (error) {
        console.error("AI提交猜拳失败", error);
      }
    }, difficulty === "hell" ? 280 : 650);
  }

  private winningRpsChoice(choice: RpsChoice): RpsChoice {
    if (choice === "rock") return "paper";
    if (choice === "paper") return "scissors";
    return "rock";
  }

  private scheduleRpsTimeout() {
    this.clearTimer();
    const rps = this.state.rps;
    if (!rps) return;
    const attempt = rps.attempt;
    this.state.deadlineAt = Date.now() + 60_000;
    this.timer = setTimeout(() => {
      const current = this.state.rps;
      if (this.state.phase !== "rockPaperScissors" || !current || current.attempt !== attempt) return;
      const bot = this.state.players.find((player) => player.controller === "bot"
        && [current.contemptPlayerId, current.targetPlayerId].includes(player.id));
      if (bot?.botDifficulty === "hell") {
        const opponentId = bot.id === current.contemptPlayerId ? current.targetPlayerId : current.contemptPlayerId;
        if (!this.rpsChoices.has(opponentId)) {
          this.rpsChoices.set(opponentId, deterministicRpsChoice(this.state.botSeed, `${current.duelId}:${attempt}:${opponentId}:timeout`));
          current.submittedPlayerIds.push(opponentId);
        }
        if (!this.rpsChoices.has(bot.id)) {
          this.rpsChoices.set(bot.id, this.winningRpsChoice(this.rpsChoices.get(opponentId)!));
          current.submittedPlayerIds.push(bot.id);
        }
        this.settleRps();
        return;
      }
      for (const playerId of [current.contemptPlayerId, current.targetPlayerId]) {
        if (this.rpsChoices.has(playerId)) continue;
        this.rpsChoices.set(playerId, deterministicRpsChoice(this.state.botSeed, `${current.duelId}:${attempt}:${playerId}:timeout`));
        current.submittedPlayerIds.push(playerId);
      }
      this.settleRps();
    }, 60_000);
  }

  private recordFinishedGame() {
    if (!this.gameId || this.state.phase !== "finished") return;
    const completedGameId = this.gameId;
    this.gameId = null;
    if (this.state.mode === "human-vs-bot" && this.botDifficulty === "hell") return;
    void recordCompletedGame(completedGameId, this.state);
  }

  private schedule(phase: "selecting", delay: number) {
    this.clearTimer();
    this.state.deadlineAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      if (this.state.phase !== phase) return;
      const fallback: CardId = this.state.astrologyRemaining > 0 ? "small_defense" : "charge";
      const alivePlayers = this.state.players.filter((item) => item.alive);
      const hellBot = alivePlayers.find((player) => player.controller === "bot" && player.botDifficulty === "hell");
      for (const player of alivePlayers.filter((item) => item.id !== hellBot?.id)) {
        if (!this.submissions.has(player.id)) {
          this.submissions.set(player.id, { playerId: player.id, cardId: fallback, targetIds: [] });
          this.state.submittedPlayerIds.push(player.id);
        }
      }
      if (hellBot && !this.submissions.has(hellBot.id)) {
        const opponent = alivePlayers.find((player) => player.id !== hellBot.id);
        const opponentAction = opponent ? this.submissions.get(opponent.id) : undefined;
        if (opponentAction) {
          const action = chooseHellBotAction(this.state, hellBot.id, opponentAction).action;
          this.submissions.set(hellBot.id, action);
          this.state.submittedPlayerIds.push(hellBot.id);
        }
      }
      for (const player of alivePlayers) {
        if (!this.submissions.has(player.id)) {
          this.submissions.set(player.id, { playerId: player.id, cardId: fallback, targetIds: [] });
          this.state.submittedPlayerIds.push(player.id);
        }
      }
      this.beginReveal();
    }, delay);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.state.deadlineAt = null;
  }

  private clearBotTimer() {
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
  }

  private publicState(viewerId: string): PublicRoomState {
    const viewer = this.state.players.find((player) => player.id === viewerId);
    const canPeek = viewer?.name === "justdabin" && this.state.phase === "selecting";
    const publicState: PublicRoomState = {
      ...this.state,
      players: this.state.players.map(({ reconnectToken: _token, ...player }) => player),
    };
    if (canPeek) {
      publicState.peekedActions = [...this.submissions.values()]
        .filter((action) => action.playerId !== viewerId)
        .map((action) => ({ ...action, targetIds: [...action.targetIds] }));
    }
    return publicState;
  }

  private sendSocket(socket: Socket, message: ServerMessage) {
    socket.emit("game:message", message);
  }

  broadcast() {
    for (const player of this.state.players) {
      io.to(`player:${player.id}`).emit("game:message", {
        type: "state",
        state: this.publicState(player.id),
      } satisfies ServerMessage);
    }
  }
}

const rooms = new Map<string, GameRoom>();

app.post("/api/rooms", (request, response) => {
  const mode: RoomMode = request.body?.mode === "human-vs-bot" ? "human-vs-bot" : "multiplayer";
  const requestedDifficulty = request.body?.difficulty;
  const difficulty: BotDifficulty = ["easy", "normal", "hard", "hell"].includes(requestedDifficulty)
    ? requestedDifficulty
    : "normal";
  let code = createCode();
  while (rooms.has(code)) code = createCode();
  rooms.set(code, new GameRoom(code, mode, difficulty));
  response.status(201).json({ roomCode: code, mode, difficulty });
});

app.get("/api/rooms/:code", (request, response) => {
  const room = rooms.get(request.params.code.toUpperCase());
  if (!room) return response.status(404).json({ error: "房间不存在" });
  return response.json({ roomCode: room.code, mode: room.state.mode, phase: room.state.phase, playerCount: room.state.players.length });
});

app.get("/api/health", (_request, response) => response.json({ ok: true, rooms: rooms.size, database: databaseHealth(), trainedPolicy: trainedPolicyHealth() }));
app.get("/api/training/stats", async (_request, response) => response.json(await trainingStats()));
app.get("/api/training/diagnostics", async (request, response) => {
  const cardId = String(request.query.card ?? "");
  if (cardId && !(cardId in CARD_DEFINITIONS)) return response.status(400).json({ error: "未知卡牌" });
  const requestedMode = String(request.query.mode ?? "");
  const mode = requestedMode === "human-vs-bot" || requestedMode === "multiplayer" ? requestedMode : null;
  const requestedOutcome = String(request.query.outcome ?? "");
  const outcome = requestedOutcome === "draw" ? "draw" : null;
  if (!cardId && !outcome) return response.status(400).json({ error: "请至少指定card或outcome=draw" });
  const limit = Number(request.query.limit ?? 50);
  return response.json({
    cardId: cardId || null,
    mode,
    outcome,
    games: await trainingGameDiagnostics(cardId ? cardId as CardId : null, mode, outcome, Number.isFinite(limit) ? limit : 50),
  });
});

io.on("connection", (socket) => {
  const roomCode = String(socket.handshake.auth.roomCode ?? "").trim().toUpperCase();
  const name = String(socket.handshake.auth.name ?? "").trim();
  const token = String(socket.handshake.auth.token ?? "").trim();
  const room = rooms.get(roomCode);
  if (!room || !name || !token) {
    socket.emit("game:message", { type: "error", code: "JOIN_FAILED", message: !room ? "房间不存在" : "昵称或重连凭证无效" } satisfies ServerMessage);
    socket.disconnect(true);
    return;
  }

  try {
    const player = room.addOrReconnect(name, token);
    socket.data.playerId = player.id;
    socket.data.roomCode = roomCode;
    void socket.join(roomCode);
    void socket.join(`player:${player.id}`);
    room.sendInitial(socket, player.id);
    room.broadcast();
  } catch (error) {
    socket.emit("game:message", { type: "error", code: "JOIN_FAILED", message: error instanceof Error ? error.message : "加入失败" } satisfies ServerMessage);
    socket.disconnect(true);
    return;
  }

  socket.on("game:message", async (message: ClientMessage) => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    try {
      await room.handle(playerId, message);
    } catch (error) {
      socket.emit("game:message", {
        type: "error",
        code: "ACTION_REJECTED",
        message: error instanceof Error ? error.message : "操作失败",
      } satisfies ServerMessage);
    }
  });

  socket.on("disconnect", () => {
    const playerId = socket.data.playerId;
    if (playerId) room.disconnect(playerId);
  });
});

if (process.env.NODE_ENV === "production") {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const clientDir = join(currentDir, "../../client");
  app.use(express.static(clientDir));
  app.get("*splat", (_request, response) => response.sendFile(join(clientDir, "index.html")));
}

const port = Number(process.env.PORT ?? 3001);
await initializeDatabase();
httpServer.listen(port, "0.0.0.0", () => {
  console.log(`拍拍蓄服务器已启动：http://localhost:${port}`);
});
