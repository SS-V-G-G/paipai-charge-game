import express from "express";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server, type Socket } from "socket.io";
import { BOT_STRATEGY_VERSION, chooseBotAction } from "../shared/bot.js";
import { CARD_DEFINITIONS, type CardId } from "../shared/cards.js";
import { createFreshPlayer, resetPlayerForGame, resolveRound, validateAction } from "../shared/engine.js";
import { databaseHealth, initializeDatabase, recordCompletedGame, trainingGamesWithCard, trainingStats } from "./database.js";
import type {
  ClientMessage,
  BotDifficulty,
  PublicRoomState,
  RoomMode,
  RoomState,
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
  private timer: NodeJS.Timeout | null = null;
  private botTimer: NodeJS.Timeout | null = null;
  private gameId: string | null = null;

  constructor(code: string, mode: RoomMode, private readonly botDifficulty: BotDifficulty) {
    this.code = code;
    this.state = {
      roomCode: code,
      mode,
      botSeed: seedFromCode(code),
      botStrategyVersion: BOT_STRATEGY_VERSION,
      hostId: "",
      phase: "lobby",
      round: 0,
      deadlineAt: null,
      players: [],
      astrologyRemaining: 0,
      submittedPlayerIds: [],
      revealedActions: [],
      actionHistory: [],
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
    const bot = createFreshPlayer(`bot-${this.code}`, "基础AI", `bot:${this.code}`, true, "bot");
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
      case "playAgain":
        this.returnToLobby(playerId);
        break;
    }
  }

  sendInitial(socket: Socket, playerId: string) {
    this.sendSocket(socket, { type: "welcome", playerId, roomCode: this.code });
    this.sendSocket(socket, { type: "state", state: this.publicState() });
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

    this.state.players = this.state.players.map((player) => ({
      ...resetPlayerForGame(player),
      ready: player.controller === "bot",
    }));
    this.state.phase = "selecting";
    this.state.round = 1;
    this.state.astrologyRemaining = 0;
    this.state.submittedPlayerIds = [];
    this.state.revealedActions = [];
    this.state.actionHistory = [];
    this.state.events = [];
    this.state.winnerIds = [];
    this.gameId = crypto.randomUUID();
    this.submissions.clear();
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
    if (this.submissions.size >= this.state.players.filter((player) => player.alive).length) this.beginReveal();
  }

  private beginReveal() {
    this.clearTimer();
    this.clearBotTimer();
    const actions = [...this.submissions.values()];
    this.state.revealedActions = actions.map((action) => ({ ...action }));
    this.resolveNow();
  }

  private resolveNow() {
    this.clearTimer();
    this.state.phase = "resolving";
    this.state = resolveRound(this.state, [...this.submissions.values()]);
    this.submissions.clear();
    if (this.state.phase === "finished" && this.gameId) {
      const completedGameId = this.gameId;
      this.gameId = null;
      void recordCompletedGame(completedGameId, this.state);
    }
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
    this.state.events = [];
    this.state.winnerIds = [];
    this.gameId = null;
    this.clearBotTimer();
    this.broadcast();
  }

  private queueBotMove() {
    this.clearBotTimer();
    if (this.state.mode !== "human-vs-bot" || this.state.phase !== "selecting") return;
    const bot = this.state.players.find((player) => player.controller === "bot" && player.alive);
    if (!bot) return;
    const round = this.state.round;
    const decision = chooseBotAction(this.state, bot.id, bot.botDifficulty ?? this.botDifficulty);
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      if (this.state.phase !== "selecting" || this.state.round !== round || this.submissions.has(bot.id)) return;
      try {
        this.submitAction(bot.id, round, decision.action.cardId, decision.action.targetIds);
      } catch (error) {
        console.error("AI提交动作失败", error);
      }
    }, 650);
  }

  private schedule(phase: "selecting", delay: number) {
    this.clearTimer();
    this.state.deadlineAt = Date.now() + delay;
    this.timer = setTimeout(() => {
      if (this.state.phase !== phase) return;
      const fallback: CardId = this.state.astrologyRemaining > 0 ? "small_defense" : "charge";
      for (const player of this.state.players.filter((item) => item.alive)) {
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

  private publicState(): PublicRoomState {
    return {
      ...this.state,
      players: this.state.players.map(({ reconnectToken: _token, ...player }) => player),
    };
  }

  private sendSocket(socket: Socket, message: ServerMessage) {
    socket.emit("game:message", message);
  }

  broadcast() {
    io.to(this.code).emit("game:message", { type: "state", state: this.publicState() } satisfies ServerMessage);
  }
}

const rooms = new Map<string, GameRoom>();

app.post("/api/rooms", (request, response) => {
  const mode: RoomMode = request.body?.mode === "human-vs-bot" ? "human-vs-bot" : "multiplayer";
  const requestedDifficulty = request.body?.difficulty;
  const difficulty: BotDifficulty = ["easy", "normal", "hard"].includes(requestedDifficulty)
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

app.get("/api/health", (_request, response) => response.json({ ok: true, rooms: rooms.size, database: databaseHealth() }));
app.get("/api/training/stats", async (_request, response) => response.json(await trainingStats()));
app.get("/api/training/diagnostics", async (request, response) => {
  const cardId = String(request.query.card ?? "");
  if (!(cardId in CARD_DEFINITIONS)) return response.status(400).json({ error: "未知卡牌" });
  const requestedMode = String(request.query.mode ?? "");
  const mode = requestedMode === "human-vs-bot" || requestedMode === "multiplayer" ? requestedMode : null;
  const limit = Number(request.query.limit ?? 50);
  return response.json({
    cardId,
    mode,
    games: await trainingGamesWithCard(cardId as CardId, mode, Number.isFinite(limit) ? limit : 50),
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
