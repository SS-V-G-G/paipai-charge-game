import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

const waitForState = (socket, predicate, timeout = 8000) => new Promise((resolve, reject) => {
  if (socket.latestState && predicate(socket.latestState)) {
    resolve(socket.latestState);
    return;
  }
  const timer = setTimeout(() => {
    socket.off("game:message", listener);
    reject(new Error("等待人机房间状态超时"));
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
  body: JSON.stringify({ mode: "human-vs-bot", difficulty: "normal" }),
});
const roomData = await response.json();
if (!response.ok || roomData.mode !== "human-vs-bot") throw new Error("创建人机房间失败");

const socket = io(baseUrl, {
  auth: { roomCode: roomData.roomCode, name: "人机测试玩家", token: `bot-smoke-${roomData.roomCode}` },
  transports: ["websocket"],
  forceNew: true,
});
socket.on("game:message", (message) => {
  if (message.type === "state") socket.latestState = message.state;
});

let playerId = "";
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("连接人机房间超时")), 8000);
  socket.on("game:message", (message) => {
    if (message.type === "welcome") {
      playerId = message.playerId;
      clearTimeout(timer);
      resolve();
    }
    if (message.type === "error") {
      clearTimeout(timer);
      reject(new Error(message.message));
    }
  });
});

const lobby = await waitForState(socket, (state) => state.players.length === 2 && state.players.some((player) => player.controller === "bot"));
const bot = lobby.players.find((player) => player.controller === "bot");
if (!bot?.ready || !bot.connected) throw new Error("AI没有正确加入并准备");

const ready = waitForState(socket, (state) => state.players.every((player) => player.ready));
socket.emit("game:message", { type: "ready" });
await ready;

const roundOne = waitForState(socket, (state) => state.phase === "selecting" && state.round === 1);
socket.emit("game:message", { type: "startGame" });
await roundOne;

const resolved = waitForState(socket, (state) => state.actionHistory.length === 1, 10_000);
socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
const result = await resolved;

const record = result.actionHistory[0];
if (!record || record.actions.length !== 2 || !record.actions.some((action) => action.playerId === bot.id)) {
  throw new Error("AI没有完成独立出牌或回合历史不完整");
}
if (!result.players.some((player) => player.id === playerId)) throw new Error("真人玩家状态丢失");

socket.disconnect();
console.log(`PASS 人机房间 ${roomData.roomCode}：AI加入、准备、独立出牌和可重放记录均正常`);
