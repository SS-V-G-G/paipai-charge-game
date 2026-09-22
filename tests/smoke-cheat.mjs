import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

function connectPlayer(roomCode, name, token) {
  const socket = io(baseUrl, {
    auth: { roomCode, name, token },
    transports: ["websocket"],
    forceNew: true,
  });
  socket.states = [];
  socket.on("game:message", (message) => {
    if (message.type === "state") {
      socket.latestState = message.state;
      socket.states.push(message.state);
    }
  });
  return socket;
}

function waitForState(socket, predicate, timeout = 8000) {
  return new Promise((resolve, reject) => {
    if (socket.latestState && predicate(socket.latestState)) return resolve(socket.latestState);
    const timer = setTimeout(() => {
      socket.off("game:message", listener);
      reject(new Error(`等待彩蛋测试状态超时：${socket.latestState?.phase ?? "无状态"}`));
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
}

async function waitForWelcome(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("等待玩家连接超时")), 8000);
    socket.on("game:message", (message) => {
      if (message.type === "welcome") {
        clearTimeout(timer);
        resolve(message.playerId);
      } else if (message.type === "error") {
        clearTimeout(timer);
        reject(new Error(message.message));
      }
    });
  });
}

const response = await fetch(`${baseUrl}/api/rooms`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "multiplayer" }),
});
const room = await response.json();
if (!response.ok || !room.roomCode) throw new Error("创建彩蛋测试房间失败");

const easterEgg = connectPlayer(room.roomCode, "justdabin", `peek-${room.roomCode}`);
const easterEggId = await waitForWelcome(easterEgg);
const ordinary = connectPlayer(room.roomCode, "普通玩家", `normal-${room.roomCode}`);
const ordinaryId = await waitForWelcome(ordinary);
await waitForState(easterEgg, (state) => state.players.length === 2);

easterEgg.emit("game:message", { type: "ready" });
ordinary.emit("game:message", { type: "ready" });
await waitForState(easterEgg, (state) => state.players.every((player) => player.ready));
const started = waitForState(easterEgg, (state) => state.phase === "selecting" && state.round === 1);
easterEgg.emit("game:message", { type: "startGame" });
await started;

const peeked = waitForState(easterEgg, (state) => state.peekedActions?.some((action) => action.playerId === ordinaryId && action.cardId === "charge"));
ordinary.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
await peeked;
await new Promise((resolve) => setTimeout(resolve, 100));

if (ordinary.latestState?.peekedActions !== undefined) throw new Error("普通玩家收到了暗牌数据");
if (easterEgg.latestState.peekedActions.some((action) => action.playerId === easterEggId)) throw new Error("彩蛋玩家不应收到自己的暗牌副本");

easterEgg.disconnect();
ordinary.disconnect();
console.log(`PASS 彩蛋房间 ${room.roomCode}：仅 justdabin 收到对手暗牌`);
