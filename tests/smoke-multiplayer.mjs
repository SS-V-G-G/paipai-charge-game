import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

const waitForState = (socket, predicate, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    socket.off("game:message", listener);
    reject(new Error("等待房间状态超时"));
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

async function connectPlayer(roomCode, name, token) {
  const socket = io(baseUrl, {
    auth: { roomCode, name, token },
    transports: ["websocket"],
    forceNew: true,
  });
  const playerId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}连接超时`)), 5000);
    socket.on("game:message", (message) => {
      if (message.type === "welcome") {
        clearTimeout(timer);
        resolve(message.playerId);
      }
      if (message.type === "error") {
        clearTimeout(timer);
        reject(new Error(message.message));
      }
    });
  });
  return { socket, playerId };
}

const response = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
const { roomCode } = await response.json();
const a = await connectPlayer(roomCode, "联机甲", "smoke-a");
const b = await connectPlayer(roomCode, "联机乙", "smoke-b");

const readyState = waitForState(a.socket, (state) => state.players.length === 2 && state.players.every((player) => player.ready));
a.socket.emit("game:message", { type: "ready" });
b.socket.emit("game:message", { type: "ready" });
await readyState;

const roundOne = waitForState(a.socket, (state) => state.phase === "selecting" && state.round === 1);
a.socket.emit("game:message", { type: "startGame" });
await roundOne;

const roundTwo = waitForState(a.socket, (state) => state.phase === "selecting" && state.round === 2);
a.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
b.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "small_defense", targetIds: [] });
const finalState = await roundTwo;

const playerA = finalState.players.find((player) => player.id === a.playerId);
if (!playerA || playerA.charge !== 1 || !playerA.alive) throw new Error("联机结算结果不正确");

a.socket.disconnect();
b.socket.disconnect();
console.log(`PASS 房间 ${roomCode}：双玩家连接、准备、开始、出牌和同步结算均正常`);
