import { io } from "socket.io-client";

const baseUrl = process.env.TEST_SERVER_URL ?? "http://localhost:3001";

const waitForState = (socket, predicate, timeout = 8000) => new Promise((resolve, reject) => {
  if (socket.latestState && predicate(socket.latestState)) return resolve(socket.latestState);
  const timer = setTimeout(() => {
    socket.off("game:message", listener);
    reject(new Error("等待猜拳状态超时"));
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
    const timer = setTimeout(() => reject(new Error(`${name}连接超时`)), 8000);
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

async function runScenario(label, contemptChoice, targetChoice, expectedResult) {
  const response = await fetch(`${baseUrl}/api/rooms`, { method: "POST" });
  const { roomCode } = await response.json();
  const contempt = await connectPlayer(roomCode, `${label}鄙视方`, `${label}-contempt-${roomCode}`);
  const target = await connectPlayer(roomCode, `${label}目标方`, `${label}-target-${roomCode}`);

  await waitForState(contempt.socket, (state) => state.players.length === 2);
  const ready = waitForState(contempt.socket, (state) => state.players.every((player) => player.ready));
  contempt.socket.emit("game:message", { type: "ready" });
  target.socket.emit("game:message", { type: "ready" });
  await ready;

  const roundOne = waitForState(contempt.socket, (state) => state.phase === "selecting" && state.round === 1);
  contempt.socket.emit("game:message", { type: "startGame" });
  await roundOne;

  const roundTwo = waitForState(contempt.socket, (state) => state.phase === "selecting" && state.round === 2);
  contempt.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
  target.socket.emit("game:message", { type: "submit", roundId: 1, cardId: "charge", targetIds: [] });
  await roundTwo;

  const rpsOne = waitForState(contempt.socket, (state) => state.phase === "rockPaperScissors" && state.rps?.attempt === 1);
  contempt.socket.emit("game:message", { type: "submit", roundId: 2, cardId: "contempt", targetIds: [target.playerId] });
  target.socket.emit("game:message", { type: "submit", roundId: 2, cardId: "small_gun", targetIds: [contempt.playerId] });
  const first = await rpsOne;
  if (first.rps.submittedPlayerIds.length !== 0) throw new Error("猜拳开始时不应已有提交");

  const rpsTwo = waitForState(contempt.socket, (state) => state.phase === "rockPaperScissors" && state.rps?.attempt === 2);
  contempt.socket.emit("game:message", { type: "rpsSubmit", duelId: first.rps.duelId, choice: "paper" });
  target.socket.emit("game:message", { type: "rpsSubmit", duelId: first.rps.duelId, choice: "paper" });
  const second = await rpsTwo;
  if (!second.rps.lastAttemptWasTie || second.rpsHistory[0]?.result !== "tie") throw new Error("猜拳平局没有正确重开");

  const finished = waitForState(contempt.socket, (state) => state.phase === "finished");
  contempt.socket.emit("game:message", { type: "rpsSubmit", duelId: second.rps.duelId, choice: contemptChoice });
  target.socket.emit("game:message", { type: "rpsSubmit", duelId: second.rps.duelId, choice: targetChoice });
  const result = await finished;

  if (result.rpsHistory.length !== 2 || result.rpsHistory[1]?.result !== expectedResult) throw new Error("猜拳历史不完整");
  if (result.actionHistory.length !== 2) throw new Error("触发猜拳的出牌没有进入回放记录");
  if (expectedResult === "contempt-won" && result.winnerIds.length !== 0) throw new Error("鄙视方赢得猜拳时没有判为平局");
  if (expectedResult === "target-won" && result.winnerIds[0] !== target.playerId) throw new Error("鄙视方猜拳落败时目标没有获胜");

  contempt.socket.disconnect();
  target.socket.disconnect();
  return roomCode;
}

const drawRoom = await runScenario("平局", "rock", "scissors", "contempt-won");
const winRoom = await runScenario("目标胜", "scissors", "rock", "target-won");
console.log(`PASS 猜拳房间 ${drawRoom}/${winRoom}：隐藏提交、平局重开、特殊平局及鄙视方判负均正常`);
