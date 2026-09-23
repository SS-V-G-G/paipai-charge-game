import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

function connectPlayer(roomCode, name, token) {
  const socket = io(baseUrl, { auth: { roomCode, name, token }, transports: ["websocket"], forceNew: true });
  socket.on("game:message", (message) => {
    if (message.type === "state") socket.latestState = message.state;
  });
  return socket;
}

function waitForMessage(socket, predicate, timeout = 10_000) {
  return new Promise((resolve, reject) => {
    const inspect = (message) => {
      if (message.type === "error") finish(() => reject(new Error(message.message)));
      if (predicate(message)) finish(() => resolve(message));
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`等待组合攻击状态超时：${socket.latestState?.phase ?? "无状态"}`))), timeout);
    const finish = (callback) => {
      clearTimeout(timer);
      socket.off("game:message", inspect);
      callback();
    };
    socket.on("game:message", inspect);
  });
}

async function welcome(socket) {
  return (await waitForMessage(socket, (message) => message.type === "welcome")).playerId;
}

async function state(socket, predicate) {
  if (socket.latestState && predicate(socket.latestState)) return socket.latestState;
  return (await waitForMessage(socket, (message) => message.type === "state" && predicate(message.state))).state;
}

const response = await fetch(`${baseUrl}/api/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "multiplayer" }),
});
const created = await response.json();
if (!response.ok || !created.roomCode) throw new Error("创建组合攻击测试房间失败");

const left = connectPlayer(created.roomCode, "组合甲", `combo-left-${created.roomCode}`);
const leftId = await welcome(left);
const right = connectPlayer(created.roomCode, "组合乙", `combo-right-${created.roomCode}`);
const rightId = await welcome(right);
await state(left, (value) => value.players.length === 2);

left.emit("game:message", { type: "ready" });
right.emit("game:message", { type: "ready" });
await state(left, (value) => value.players.every((player) => player.ready));
left.emit("game:message", { type: "startGame" });
await state(left, (value) => value.phase === "selecting" && value.round === 1);

for (let round = 1; round <= 6; round += 1) {
  left.emit("game:message", { type: "submit", roundId: round, plays: [{ cardId: "charge", targetIds: [] }] });
  right.emit("game:message", { type: "submit", roundId: round, plays: [{ cardId: "charge", targetIds: [] }] });
  await state(left, (value) => value.phase === "selecting" && value.round === round + 1);
}

left.emit("game:message", {
  type: "submit",
  roundId: 7,
  plays: [
    { cardId: "stab", targetIds: [rightId] },
    { cardId: "cannon", targetIds: [rightId] },
  ],
});
right.emit("game:message", { type: "submit", roundId: 7, plays: [{ cardId: "small_reflect", targetIds: [] }] });
const finished = await state(left, (value) => value.phase === "finished");
const lastRound = finished.actionHistory.at(-1);
const leftActions = lastRound.actions.filter((action) => action.playerId === leftId);
if (leftActions.length !== 2) throw new Error(`组合攻击未完整写入回放：${leftActions.length}`);
if (finished.events.filter((event) => event.type === "reflected").length !== 2) throw new Error("戳和炮没有被小反分别反弹");
if (!finished.winnerIds.includes(rightId)) throw new Error("组合攻击独立结算结果错误");

left.disconnect();
right.disconnect();
console.log(`PASS 组合攻击房间 ${created.roomCode}：不同攻击同目标、独立反弹与回放均正常`);
