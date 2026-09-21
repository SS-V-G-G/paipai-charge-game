import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

const waitForState = (socket, predicate, timeout = 10_000) => new Promise((resolve, reject) => {
  if (socket.latestState && predicate(socket.latestState)) return resolve(socket.latestState);
  const timer = setTimeout(() => {
    socket.off("game:message", listener);
    reject(new Error("等待训练记录测试状态超时"));
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
  socket.on("game:message", (message) => {
    if (message.type === "state") socket.latestState = message.state;
  });
  const playerId = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name}连接超时`)), 10_000);
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

const initialStats = await fetch(`${baseUrl}/api/training/stats`).then((response) => response.json());
if (!initialStats.ready) {
  console.log("SKIP 训练数据库尚未配置");
  process.exit(0);
}

const roomResponse = await fetch(`${baseUrl}/api/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "multiplayer" }),
});
const { roomCode } = await roomResponse.json();
const left = await connectPlayer(roomCode, "匿名测试甲", `training-left-${roomCode}`);
const right = await connectPlayer(roomCode, "匿名测试乙", `training-right-${roomCode}`);

await waitForState(left.socket, (state) => state.players.length === 2);
const ready = waitForState(left.socket, (state) => state.players.every((player) => player.ready));
left.socket.emit("game:message", { type: "ready" });
right.socket.emit("game:message", { type: "ready" });
await ready;

const roundOne = waitForState(left.socket, (state) => state.phase === "selecting" && state.round === 1);
left.socket.emit("game:message", { type: "startGame" });
await roundOne;

const roundTwo = waitForState(left.socket, (state) => state.phase === "selecting" && state.round === 2);
left.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
right.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
await roundTwo;

const finished = waitForState(left.socket, (state) => state.phase === "finished");
left.socket.emit("game:message", { type: "submit", roundId: 2, cardId: "small_gun", targetIds: [right.playerId] });
right.socket.emit("game:message", { type: "submit", roundId: 2, cardId: "charge", targetIds: [] });
await finished;

let finalStats = initialStats;
for (let attempt = 0; attempt < 10; attempt += 1) {
  finalStats = await fetch(`${baseUrl}/api/training/stats`).then((response) => response.json());
  if (finalStats.games > initialStats.games) break;
  await new Promise((resolve) => setTimeout(resolve, 500));
}

left.socket.disconnect();
right.socket.disconnect();
if (finalStats.games <= initialStats.games) throw new Error("已完成对局但训练数据库记录数没有增加");
console.log(`PASS 匿名训练记录：对局 ${initialStats.games} → ${finalStats.games}，回合 ${initialStats.rounds} → ${finalStats.rounds}`);
