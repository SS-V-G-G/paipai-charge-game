import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

const waitForState = (socket, predicate, timeout = 8000) => new Promise((resolve, reject) => {
  if (socket.latestState && predicate(socket.latestState)) return resolve(socket.latestState);
  const timer = setTimeout(() => {
    socket.off("game:message", listener);
    reject(new Error(`等待地狱人机房间状态超时：${socket.latestState?.phase ?? "无状态"} / 回合 ${socket.latestState?.round ?? "?"}`));
  }, timeout);
  const listener = (message) => {
    if (message.type === "error") {
      clearTimeout(timer);
      socket.off("game:message", listener);
      reject(new Error(message.message));
    }
    if (message.type === "state" && predicate(message.state)) {
      clearTimeout(timer);
      socket.off("game:message", listener);
      resolve(message.state);
    }
  };
  socket.on("game:message", listener);
});

const response = await fetch(`${baseUrl}/api/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "human-vs-bot", difficulty: "hell" }),
});
const roomData = await response.json();
if (!response.ok || roomData.difficulty !== "hell") throw new Error("创建地狱人机房间失败");

const socket = io(baseUrl, {
  auth: { roomCode: roomData.roomCode, name: "地狱测试玩家", token: `hell-smoke-${roomData.roomCode}` },
  transports: ["websocket"],
  forceNew: true,
});
socket.on("game:message", (message) => {
  if (message.type === "state") socket.latestState = message.state;
});

let playerId = "";
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("连接地狱人机房间超时")), 8000);
  socket.on("game:message", (message) => {
    if (message.type === "welcome") {
      playerId = message.playerId;
      clearTimeout(timer);
      resolve();
    } else if (message.type === "error") {
      clearTimeout(timer);
      reject(new Error(message.message));
    }
  });
});

const lobby = await waitForState(socket, (state) => state.players.length === 2);
const bot = lobby.players.find((player) => player.controller === "bot");
if (bot?.name !== "地狱AI" || bot.botDifficulty !== "hell") throw new Error("地狱AI身份不正确");

const ready = waitForState(socket, (state) => state.players.every((player) => player.ready));
socket.emit("game:message", { type: "ready" });
await ready;
const started = waitForState(socket, (state) => state.phase === "selecting" && state.round === 1);
socket.emit("game:message", { type: "startGame" });
await started;

const finished = waitForState(socket, (state) => state.phase === "finished", 10_000);
socket.emit("game:message", { type: "submit", roundId: 1, cardId: "flower", targetIds: [] });
const result = await finished;
const actions = result.actionHistory[0]?.actions ?? [];
if (!actions.some((action) => action.playerId === bot.id && action.cardId === "shoot" && action.targetIds[0] === playerId)) {
  throw new Error("地狱AI没有针对花使用射");
}
if (result.winnerIds.length !== 1 || result.winnerIds[0] !== bot.id) throw new Error("地狱AI没有赢得测试对局");

const lobbyAgain = waitForState(socket, (state) => state.phase === "lobby");
socket.emit("game:message", { type: "playAgain" });
await lobbyAgain;
const readyAgain = waitForState(socket, (state) => state.phase === "lobby" && state.players.every((player) => player.ready));
socket.emit("game:message", { type: "ready" });
await readyAgain;
const roundAgain = waitForState(socket, (state) => state.phase === "selecting" && state.round === 1);
socket.emit("game:message", { type: "startGame" });
await roundAgain;

const roundTwo = waitForState(socket, (state) => state.phase === "selecting" && state.round === 2);
socket.emit("game:message", { type: "submit", roundId: 1, cardId: "small_defense", targetIds: [] });
await roundTwo;
const rps = waitForState(socket, (state) => state.phase === "rockPaperScissors");
socket.emit("game:message", { type: "submit", roundId: 2, cardId: "contempt", targetIds: [bot.id] });
const rpsState = await rps;
const rpsFinished = waitForState(socket, (state) => state.phase === "finished" && state.rpsHistory.length > 0);
socket.emit("game:message", { type: "rpsSubmit", duelId: rpsState.rps.duelId, choice: "rock" });
const rpsResult = await rpsFinished;
const botChoice = rpsResult.rpsHistory[0].choices.find((item) => item.playerId === bot.id)?.choice;
if (botChoice !== "paper" || rpsResult.winnerIds[0] !== bot.id) throw new Error("地狱AI没有后手赢得猜拳");

socket.disconnect();
console.log(`PASS 地狱人机房间 ${roomData.roomCode}：出牌与猜拳后手反制、胜负及回放记录均正常`);
