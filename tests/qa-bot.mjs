import { io } from "socket.io-client";

const roomCode = process.argv[2];
if (!roomCode) throw new Error("需要房间码");

const socket = io("http://localhost:3001", {
  auth: { roomCode, name: "测试乙", token: `qa-bot-${roomCode}` },
  transports: ["websocket"],
});

let playerId = "";
socket.on("game:message", (message) => {
  if (message.type === "welcome") playerId = message.playerId;
  if (message.type !== "state" || !playerId) return;
  const me = message.state.players.find((player) => player.id === playerId);
  if (!me) return;
  if (message.state.phase === "lobby" && !me.ready) socket.emit("game:message", { type: "ready" });
  if (message.state.phase === "selecting" && me.alive && !message.state.submittedPlayerIds.includes(playerId)) {
    socket.emit("game:message", {
      type: "submit",
      roundId: message.state.round,
      cardId: message.state.astrologyRemaining > 0 ? "small_defense" : "charge",
      targetIds: [],
    });
  }
});

socket.on("connect", () => console.log(`QA bot connected to ${roomCode}`));
socket.on("connect_error", (error) => console.error(error.message));
setInterval(() => {}, 60_000);
