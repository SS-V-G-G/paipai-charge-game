import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Bolt,
  Bomb,
  Bot,
  BookOpen,
  Bird,
  Check,
  ChevronRight,
  CircleDot,
  Copy,
  Crosshair,
  Crown,
  DoorOpen,
  Flower2,
  Flame,
  Heart,
  GripVertical,
  LogOut,
  MoveRight,
  Radio,
  Rocket,
  RotateCcw,
  ScanLine,
  Shield,
  ShieldCheck,
  Sparkles,
  Sun,
  Sword,
  Swords,
  Target,
  Telescope,
  ThumbsDown,
  ThumbsUp,
  Users,
  Waves,
  Wind,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  BASE_CARD_IDS,
  CARD_DEFINITIONS,
  CARD_GROUP_LABELS,
  type BaseCardId,
  type CardDefinition,
  type CardGroup,
  type CardId,
} from "../shared/cards.js";
import type { BotDifficulty, PublicRoomState, RpsChoice, ServerMessage } from "../shared/types.js";

const TOKEN_KEY = "paipai-charge-token";
const NAME_KEY = "paipai-charge-name";
const PLAYER_COLORS = ["#5ee0ca", "#ffb547", "#ff7f78", "#b69cff", "#73b7ff", "#e98bd0", "#a8d86e", "#ff9f5a", "#70d5f0", "#f1df72"];
const HAND_CARD_ORDER: CardId[] = [
  "charge", "rub", "pull", "small_defense", "flower", "shoot", "push", "praise", "contempt", "golden_rooster",
  "small_gun", "cannon", "big_defense", "small_reflect", "flying_knife", "raise_gun", "stab", "bull",
  "shotgun", "big_reflect", "astrology", "big_gun", "free_big_gun", "slash", "backhand_stab", "double_slash",
  "super_flying_knife", "anti_contempt",
];

function getToken() {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing) return existing;
  const token = crypto.randomUUID();
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

const phaseLabel = {
  lobby: "等待准备",
  selecting: "秘密出牌",
  resolving: "正在结算",
  rockPaperScissors: "猜拳时间",
  finished: "本局结束",
} as const;

function cardShortLabel(cardId: CardId) {
  const card = CARD_DEFINITIONS[cardId] as CardDefinition;
  if (card.damage === "infinite") return "无限伤害";
  if (card.damage) return `伤害 ${card.damage}`;
  if (card.tags?.includes("defense")) return "防御";
  if (card.tags?.includes("reflect")) return "反弹";
  if (card.tags?.includes("invincible")) return "无敌";
  if (card.targetMode === "one-other") return "指定目标";
  return "特殊行动";
}

export default function App() {
  const socketRef = useRef<Socket | null>(null);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [joinCode, setJoinCode] = useState(() => location.hash.slice(1).toUpperCase());
  const [roomCode, setRoomCode] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [connection, setConnection] = useState<"offline" | "connecting" | "online">("offline");
  const [error, setError] = useState("");
  const [selectedCard, setSelectedCard] = useState<CardId | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [group, setGroup] = useState<"ALL" | CardGroup>("ALL");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rpsChoice, setRpsChoice] = useState<RpsChoice | null>(null);
  const [playerColorOverrides, setPlayerColorOverrides] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedCard(null);
    setTargets([]);
  }, [room?.round]);

  useEffect(() => {
    setRpsChoice(null);
  }, [room?.rps?.duelId, room?.rps?.attempt]);

  useEffect(() => () => {
    socketRef.current?.disconnect();
  }, []);

  const me = room?.players.find((player) => player.id === playerId);
  const submitted = !!room?.submittedPlayerIds.includes(playerId);
  const rpsSubmitted = !!room?.rps?.submittedPlayerIds.includes(playerId) || rpsChoice !== null;
  const otherAlivePlayers = room?.players.filter((player) => player.alive && player.id !== playerId) ?? [];
  const secondsLeft = room?.deadlineAt ? Math.max(0, Math.ceil((room.deadlineAt - now) / 1000)) : null;
  const playerColors = useMemo(() => Object.fromEntries(
    (room?.players ?? []).map((player, index) => [player.id, playerColorOverrides[player.id] ?? PLAYER_COLORS[index % PLAYER_COLORS.length]]),
  ), [room?.players, playerColorOverrides]);

  const cards = useMemo(() => {
    const ids: CardId[] = [...BASE_CARD_IDS];
    if ((me?.freeBigGuns ?? 0) > 0) ids.push("free_big_gun");
    return ids
      .filter((id) => group === "ALL" || CARD_DEFINITIONS[id].group === group)
      .sort((left, right) => HAND_CARD_ORDER.indexOf(left) - HAND_CARD_ORDER.indexOf(right));
  }, [group, me?.freeBigGuns]);

  const send = (message: unknown) => socketRef.current?.emit("game:message", message);

  const connect = (code: string) => {
    const cleanName = name.trim().slice(0, 12);
    const cleanCode = code.trim().toUpperCase();
    if (!cleanName) return setError("请先输入昵称");
    if (!/^[A-Z0-9]{6}$/.test(cleanCode)) return setError("请输入6位房间码");

    localStorage.setItem(NAME_KEY, cleanName);
    socketRef.current?.disconnect();
    setConnection("connecting");
    setError("");
    const socket = io({
      auth: { roomCode: cleanCode, name: cleanName, token: getToken() },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 4000,
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnection("online"));
    socket.on("disconnect", () => setConnection("connecting"));
    socket.on("connect_error", (reason) => {
      setConnection("offline");
      setError(reason.message || "连接服务器失败");
    });
    socket.on("game:message", (message: ServerMessage) => {
      if (message.type === "welcome") {
        setPlayerId(message.playerId);
        setRoomCode(message.roomCode);
        setJoinCode(message.roomCode);
        location.hash = message.roomCode;
      } else if (message.type === "state") {
        setRoom(message.state);
      } else if (message.type === "error") {
        setError(message.message);
      }
    });
  };

  const createRoom = async (mode: "multiplayer" | "human-vs-bot" = "multiplayer", difficulty: BotDifficulty = "normal") => {
    if (!name.trim()) return setError("请先输入昵称");
    setError("");
    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, difficulty }),
      });
      const data = (await response.json()) as { roomCode?: string; error?: string };
      if (!response.ok || !data.roomCode) throw new Error(data.error ?? "创建房间失败");
      connect(data.roomCode);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建房间失败");
    }
  };

  const leaveRoom = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    setRoom(null);
    setRoomCode("");
    setPlayerId("");
    setConnection("offline");
    setSelectedCard(null);
    setTargets([]);
    location.hash = "";
  };

  const chooseCard = (cardId: CardId) => {
    if (!me || submitted || room?.phase !== "selecting") return;
    setSelectedCard(cardId);
    setTargets([]);
    setError("");
  };

  const toggleTarget = (targetId: string) => {
    if (!selectedCard) return;
    const mode = CARD_DEFINITIONS[selectedCard].targetMode;
    if (mode === "one-other") return setTargets([targetId]);
    if (mode === "two-others") {
      setTargets((current) => current.includes(targetId)
        ? current.filter((id) => id !== targetId)
        : current.length < 2 ? [...current, targetId] : [current[1], targetId]);
    }
  };

  const isCardDisabled = (cardId: CardId) => {
    if (!me || room?.phase !== "selecting" || submitted || !me.alive) return true;
    const card = CARD_DEFINITIONS[cardId];
    if (me.charge < card.cost) return true;
    if (cardId === "charge" && room.astrologyRemaining > 0) return true;
    if (cardId === "free_big_gun" && me.freeBigGuns <= 0) return true;
    if ("limit" in card && card.limit !== undefined) {
      return (me.remainingUses[cardId as keyof typeof me.remainingUses] ?? 0) <= 0;
    }
    if (card.targetMode === "two-others" && otherAlivePlayers.length < 2) return true;
    return false;
  };

  const canSubmit = (() => {
    if (!selectedCard || !me || submitted || room?.phase !== "selecting") return false;
    const mode = CARD_DEFINITIONS[selectedCard].targetMode;
    if (mode === "one-other") return targets.length === 1;
    if (mode === "two-others") return targets.length === 2;
    return targets.length === 0;
  })();

  const submit = () => {
    if (!canSubmit || !selectedCard || !room) return;
    send({ type: "submit", roundId: room.round, cardId: selectedCard, targetIds: targets });
  };

  const submitRps = (choice: RpsChoice) => {
    if (!room?.rps || rpsSubmitted) return;
    setRpsChoice(choice);
    send({ type: "rpsSubmit", duelId: room.rps.duelId, choice });
  };

  const cyclePlayerColor = (targetPlayerId: string) => {
    const current = playerColors[targetPlayerId];
    const currentIndex = PLAYER_COLORS.indexOf(current);
    setPlayerColorOverrides((overrides) => ({
      ...overrides,
      [targetPlayerId]: PLAYER_COLORS[(currentIndex + 1 + PLAYER_COLORS.length) % PLAYER_COLORS.length],
    }));
  };

  if (!room) {
    return (
      <main className="home-shell">
        <section className="home-card">
          <div className="brand-mark"><Bolt size={30} strokeWidth={2.5} /></div>
          <p className="eyebrow">同步回合制卡牌游戏</p>
          <h1>拍拍蓄</h1>
          <p className="home-lead">秘密出牌，同时公开。服务器确定性结算，同一局面与出牌可完全重放。</p>

          <label className="field-label" htmlFor="nickname">你的昵称</label>
          <input id="nickname" className="text-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={12} placeholder="输入昵称" />

          <div className="home-mode-buttons">
            <button className="primary-button" onClick={() => createRoom("multiplayer")} disabled={connection === "connecting"}>
              <Swords size={19} /> 创建联机房间
            </button>
            <button className="secondary-button ai-button" onClick={() => createRoom("human-vs-bot")} disabled={connection === "connecting"}>
              <Bot size={19} /> 1v1 对战基础AI
            </button>
            <button className="secondary-button ai-button" onClick={() => createRoom("human-vs-bot", "hell")} disabled={connection === "connecting"}>
              <Flame size={19} /> 挑战地狱AI
            </button>
          </div>

          <div className="or"><span>或者加入朋友的房间</span></div>
          <div className="join-row">
            <input className="text-input code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} placeholder="六位房间码" />
            <button className="secondary-button" onClick={() => connect(joinCode)}>加入 <ChevronRight size={18} /></button>
          </div>
          {error && <p className="error-message">{error}</p>}
          <div className="home-meta"><Users size={16} /> 支持人机1v1及2—10人联机 · 无需注册</div>
          <p className="training-notice">完成的对局会以匿名形式保存，用于训练和改进AI；不会保存昵称、重连凭证或IP地址。</p>
        </section>
      </main>
    );
  }

  if (room.phase === "lobby") {
    const isHost = room.hostId === playerId;
    const roomBot = room.players.find((player) => player.controller === "bot");
    return (
      <main className="app-shell lobby-shell">
        <TopBar roomCode={roomCode} connection={connection} onLeave={leaveRoom} />
        <section className="lobby-panel">
          <div className="section-heading">
            <div><p className="eyebrow">房间 {roomCode}</p><h1>等待所有人准备</h1></div>
            <span className="player-count"><Users size={17} /> {room.players.length}/10</span>
          </div>
          <div className="lobby-list">
            {room.players.map((player, index) => (
              <div className="lobby-player" key={player.id}>
                <span className="avatar">{player.controller === "bot" ? <Bot size={21} /> : player.name.slice(0, 1)}</span>
                <div className="player-copy"><strong>{player.name}</strong><span>{player.controller === "bot" ? player.botDifficulty === "hell" ? "地狱难度" : "基础策略AI" : player.connected ? "在线" : "等待重连"}</span></div>
                {player.id === room.hostId && <Crown className="host-crown" size={19} />}
                <span className={`ready-pill ${player.ready ? "is-ready" : ""}`}>{player.controller === "bot" ? "AI已就绪" : player.ready ? "已准备" : index === 0 ? "房主" : "未准备"}</span>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <button className="secondary-button large" onClick={() => send({ type: "ready" })}>{me?.ready ? "取消准备" : "准备"}</button>
            {isHost && <button className="primary-button large" disabled={room.players.length < 2 || room.players.some((player) => !player.ready)} onClick={() => send({ type: "startGame" })}><Swords size={19} /> 开始游戏</button>}
          </div>
          <p className="hint">{room.mode === "human-vs-bot" ? roomBot?.botDifficulty === "hell" ? "准备后开始。祝你好运。" : "准备后开始。AI会在每轮开始时独立决定出牌。" : "把房间码发给朋友。所有玩家准备后，由房主开始。"}</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell game-shell">
      <TopBar roomCode={roomCode} connection={connection} onLeave={leaveRoom} />
      <RoundHistoryWindow room={room} playerColors={playerColors} />

      <section className="round-strip">
        <div><span>第 {room.round} 回合</span><strong>{phaseLabel[room.phase]}</strong></div>
        {room.astrologyRemaining > 0 && <span className="status-chip astrology"><Sparkles size={15} /> 禁蓄 {room.astrologyRemaining}轮</span>}
        {secondsLeft !== null && <span className={`timer ${secondsLeft <= 10 ? "urgent" : ""}`}>{secondsLeft}s</span>}
      </section>

      <PlayerRelationshipBoard
        room={room}
        playerId={playerId}
        playerColors={playerColors}
        onCycleColor={cyclePlayerColor}
      />

      {room.phase === "finished" ? (
        <section className="result-panel">
          <Crown size={38} />
          <p className="eyebrow">牌局结束</p>
          <h2>{room.winnerIds.length ? `${room.players.find((player) => player.id === room.winnerIds[0])?.name}获胜` : "本局平局"}</h2>
          {room.hostId === playerId && <button className="primary-button" onClick={() => send({ type: "playAgain" })}>再来一局</button>}
        </section>
      ) : room.phase === "rockPaperScissors" && room.rps ? (
        <section className="rps-panel">
          <p className="eyebrow">特殊结算 · 第 {room.rps.attempt} 次</p>
          <h2>猜拳时间</h2>
          <p className="rps-copy">
            {room.players.find((player) => player.id === room.rps?.contemptPlayerId)?.name} 发起鄙视，
            {room.players.find((player) => player.id === room.rps?.targetPlayerId)?.name} 本轮花费了蓄。
          </p>
          {room.rps.lastAttemptWasTie && <p className="rps-tie">上一轮平局，请继续选择</p>}
          {[room.rps.contemptPlayerId, room.rps.targetPlayerId].includes(playerId) ? (
            <>
              <div className="rps-options">
                {([
                  ["rock", "✊", "石头"],
                  ["scissors", "✌️", "剪刀"],
                  ["paper", "✋", "布"],
                ] as const).map(([choice, symbol, label]) => (
                  <button key={choice} className={rpsChoice === choice ? "selected" : ""} disabled={rpsSubmitted} onClick={() => submitRps(choice)}>
                    <span>{symbol}</span><strong>{label}</strong>
                  </button>
                ))}
              </div>
              <p className="rps-status">{rpsSubmitted ? "已秘密提交，等待对方" : "选择后立即提交；双方提交前不会公开"}</p>
            </>
          ) : <p className="rps-status">你不是本次猜拳参与者，正在等待双方提交。</p>}
        </section>
      ) : (
        <>
          <section className="table-controls">
            <PlayerHud player={me} color={playerColors[playerId]} />
            <section className="hand-panel">
              <div className="hand-heading">
                <div><p className="eyebrow">你的手牌</p><h2>{submitted ? "已锁定，等待其他玩家" : selectedCard ? `已选择：${CARD_DEFINITIONS[selectedCard].name}` : "选择本回合要出的牌"}</h2></div>
                <button className="rules-button" onClick={() => setRulesOpen(true)} aria-label="查看卡牌规则"><BookOpen size={18} /> 卡牌规则</button>
              </div>
              <div className="group-tabs">
                {(["ALL", "B", "C", "D"] as const).map((item) => <button key={item} className={group === item ? "active" : ""} onClick={() => setGroup(item)}>{item === "ALL" ? "全部卡牌" : CARD_GROUP_LABELS[item]}</button>)}
              </div>
              <div className="cards-grid">
                {cards.map((cardId) => {
                  const card = CARD_DEFINITIONS[cardId];
                  const disabled = isCardDisabled(cardId);
                  const limit = "limit" in card ? card.limit : undefined;
                  const remaining = limit !== undefined ? me?.remainingUses[cardId as keyof typeof me.remainingUses] : undefined;
                  return (
                    <button key={cardId} className={`game-card group-${card.group.toLowerCase()} ${selectedCard === cardId ? "selected" : ""}`} disabled={disabled} onClick={() => chooseCard(cardId)}>
                      <span className="card-cost">{card.cost === 0 ? "0" : card.cost}</span>
                      <span className="card-art"><CardGlyph cardId={cardId} /></span>
                      <strong>{card.name}</strong>
                      <small>{cardShortLabel(cardId)}</small>
                      {remaining !== undefined && <em>{remaining}/{limit}</em>}
                      {cardId === "free_big_gun" && <em>{me?.freeBigGuns}张</em>}
                    </button>
                  );
                })}
              </div>
            </section>

            <div className="submit-dock">
              <div><span>当前蓄</span><strong><Bolt size={18} /> {me?.charge ?? 0}</strong></div>
              <button className="primary-button submit-button" disabled={!canSubmit} onClick={submit}>{submitted ? <><Check size={19} /> 已提交</> : <>锁定出牌 <ChevronRight size={19} /></>}</button>
            </div>
          </section>

          {selectedCard && ["one-other", "two-others"].includes(CARD_DEFINITIONS[selectedCard].targetMode) && !submitted && (
            <section className="target-picker" aria-label="选择卡牌目标">
              <div className="target-picker-title">
                <strong>{CARD_DEFINITIONS[selectedCard].name} · 选择目标</strong>
                <span>{CARD_DEFINITIONS[selectedCard].targetMode === "two-others" ? `${targets.length}/2` : `${targets.length}/1`}</span>
              </div>
              <div className="target-picker-options">
                {otherAlivePlayers.map((player) => (
                  <button
                    key={player.id}
                    className={targets.includes(player.id) ? "selected" : ""}
                    onClick={() => toggleTarget(player.id)}
                    style={{ "--player-color": playerColors[player.id] } as CSSProperties}
                  >
                    <span>{player.controller === "bot" ? <Bot size={14} /> : player.name.slice(0, 1)}</span>
                    {player.name}
                  </button>
                ))}
              </div>
              <button className="target-picker-cancel" onClick={() => { setSelectedCard(null); setTargets([]); }}>取消</button>
            </section>
          )}

        </>
      )}

      <section className="log-panel">
        <div className="section-heading compact"><h2>本轮记录</h2><Radio size={18} /></div>
        <div className="event-list">
          {room.events.length === 0 ? <p className="empty-log">等待第一轮结算</p> : room.events.slice().reverse().map((item) => <p key={item.id} className={`event ${item.type}`}>{item.text}</p>)}
        </div>
      </section>

      {rulesOpen && <RulesDrawer onClose={() => setRulesOpen(false)} />}
      {error && <button className="toast" onClick={() => setError("")}>{error}</button>}
    </main>
  );
}

function TopBar({ roomCode, connection, onLeave }: { roomCode: string; connection: "offline" | "connecting" | "online"; onLeave: () => void }) {
  const [copied, setCopied] = useState(false);
  const copyCode = async () => {
    await navigator.clipboard.writeText(roomCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };
  return (
    <header className="topbar">
      <div className="mini-brand"><Bolt size={18} /> 拍拍蓄</div>
      <button className="room-code" onClick={copyCode}>{roomCode} {copied ? <Check size={15} /> : <Copy size={15} />}</button>
      <span className={`connection ${connection}`}>{connection === "online" ? <Wifi size={16} /> : <WifiOff size={16} />}{connection === "online" ? "在线" : "重连中"}</span>
      <button className="icon-button" onClick={onLeave} aria-label="离开房间"><LogOut size={19} /></button>
    </header>
  );
}

function PlayerHud({ player, color }: { player: PublicRoomState["players"][number] | undefined; color: string | undefined }) {
  if (!player) return null;
  return (
    <aside className="player-hud" style={{ "--player-color": color ?? PLAYER_COLORS[0] } as CSSProperties}>
      <div className="player-hud-avatar">{player.controller === "bot" ? <Bot size={24} /> : player.name.slice(0, 1)}</div>
      <div className="player-hud-copy"><strong>{player.name}</strong><span>{player.alive ? "你的状态" : "已出局"}</span></div>
      <div className="player-hud-stats"><b><Heart size={16} /> {player.life}</b><b><Bolt size={16} /> {player.charge}</b></div>
      <div className="player-hud-tags">
        {player.freeBigGuns > 0 && <span>免费大枪 ×{player.freeBigGuns}</span>}
        {(player.goldenRoosterActive || player.goldenRoosterNext) && <span>金鸡独立</span>}
      </div>
    </aside>
  );
}

function CardGlyph({ cardId, size = 34 }: { cardId: CardId; size?: number }) {
  const props = { size, strokeWidth: 1.9 };
  switch (cardId) {
    case "charge": return <Sun {...props} />;
    case "rub": return <Wind {...props} />;
    case "pull": return <MoveRight {...props} />;
    case "small_gun": return <Crosshair {...props} />;
    case "cannon": return <CircleDot {...props} />;
    case "flying_knife": return <Sword {...props} />;
    case "stab": return <Target {...props} />;
    case "bull": return <Bomb {...props} />;
    case "big_gun":
    case "free_big_gun": return <Rocket {...props} />;
    case "shotgun": return <Waves {...props} />;
    case "slash":
    case "double_slash":
    case "backhand_stab":
    case "super_flying_knife": return <Swords {...props} />;
    case "anti_contempt": return <Flame {...props} />;
    case "small_defense":
    case "big_defense": return <Shield {...props} />;
    case "small_reflect":
    case "big_reflect": return <RotateCcw {...props} />;
    case "raise_gun": return <ScanLine {...props} />;
    case "astrology": return <Telescope {...props} />;
    case "flower": return <Flower2 {...props} />;
    case "shoot": return <Crosshair {...props} />;
    case "push": return <ShieldCheck {...props} />;
    case "praise": return <ThumbsUp {...props} />;
    case "golden_rooster": return <Bird {...props} />;
    case "contempt": return <ThumbsDown {...props} />;
    default: return <CircleDot {...props} />;
  }
}

interface BoardPosition {
  x: number;
  y: number;
}

function boardPositions(count: number): BoardPosition[] {
  if (count === 1) return [{ x: 50, y: 50 }];
  if (count === 2) return [{ x: 24, y: 50 }, { x: 76, y: 50 }];
  if (count === 3) return [{ x: 50, y: 18 }, { x: 20, y: 76 }, { x: 80, y: 76 }];
  const radiusX = count > 6 ? 44 : 39;
  const radiusY = count > 6 ? 42 : 38;
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
    return { x: 50 + Math.cos(angle) * radiusX, y: 50 + Math.sin(angle) * radiusY };
  });
}

function arrowPath(source: BoardPosition, target: BoardPosition) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const unitX = dx / length;
  const unitY = dy / length;
  const start = { x: source.x + unitX * 9, y: source.y + unitY * 9 };
  const end = { x: target.x - unitX * 10, y: target.y - unitY * 10 };
  const curve = Math.min(7, length * 0.12);
  const control = {
    x: (start.x + end.x) / 2 - unitY * curve,
    y: (start.y + end.y) / 2 + unitX * curve,
  };
  return {
    d: `M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,
    labelX: control.x,
    labelY: control.y,
  };
}

function PlayerRelationshipBoard({
  room,
  playerId,
  playerColors,
  onCycleColor,
}: {
  room: PublicRoomState;
  playerId: string;
  playerColors: Record<string, string>;
  onCycleColor: (playerId: string) => void;
}) {
  const boardActions = room.peekedActions?.length ? room.peekedActions : room.revealedActions;
  const positions = boardPositions(room.players.length);
  const positionByPlayer = new Map(room.players.map((player, index) => [player.id, positions[index]]));
  const indexByPlayer = new Map(room.players.map((player, index) => [player.id, index]));
  const roundParticipants = new Set(boardActions.map((action) => action.playerId));
  const displayedRound = room.actionHistory.at(-1)?.round;
  const arrows = boardActions.flatMap((action) => {
    const card = CARD_DEFINITIONS[action.cardId];
    const targetIds = card.targetMode === "all-others"
      ? room.players.filter((player) => player.id !== action.playerId && roundParticipants.has(player.id)).map((player) => player.id)
      : action.targetIds;
    return targetIds.map((targetId) => ({ action, targetId }));
  });
  const arrowVisuals = arrows.flatMap(({ action, targetId }, arrowIndex) => {
    const source = positionByPlayer.get(action.playerId);
    const target = positionByPlayer.get(targetId);
    const sourceIndex = indexByPlayer.get(action.playerId);
    if (!source || !target || sourceIndex === undefined) return [];
    return [{
      key: `${action.playerId}-${targetId}-${arrowIndex}`,
      action,
      sourceIndex,
      geometry: arrowPath(source, target),
      color: playerColors[action.playerId],
    }];
  });

  return (
    <section className={`relationship-board ${room.players.length > 6 ? "many-players" : ""}`} aria-label="本回合玩家关系图">
      <div className="relationship-caption">
        <div><span>对局关系图</span><strong>{displayedRound ? `第 ${displayedRound} 回合操作` : "等待首轮公开"}</strong></div>
        <small>箭头表示指向，牌名显示公开操作</small>
      </div>
      <div className="relationship-stage">
        <svg className="relationship-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {room.players.map((player, index) => (
              <marker key={player.id} id={`arrow-${index}`} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M 0 0 L 6 3 L 0 6 z" fill={playerColors[player.id]} />
              </marker>
            ))}
          </defs>
          {arrowVisuals.map(({ key, geometry, color, sourceIndex }) => (
            <path key={key} d={geometry.d} fill="none" stroke={color} strokeWidth="2.2" vectorEffect="non-scaling-stroke" markerEnd={`url(#arrow-${sourceIndex})`} />
          ))}
        </svg>

        {arrowVisuals.map(({ key, action, geometry, color }) => (
          <span
            className="relationship-arrow-label"
            key={`${key}-label`}
            style={{ left: `${geometry.labelX}%`, top: `${geometry.labelY}%`, color, borderColor: color } as CSSProperties}
          >
            {CARD_DEFINITIONS[action.cardId].name}
          </span>
        ))}

        {room.players.map((player, index) => {
          const position = positions[index];
          const action = boardActions.find((item) => item.playerId === player.id);
          const card = action ? CARD_DEFINITIONS[action.cardId] : null;
          return (
            <article
              className={`relationship-player ${player.id === playerId ? "is-me" : ""} ${!player.alive ? "is-dead" : ""}`}
              key={player.id}
              style={{ left: `${position.x}%`, top: `${position.y}%`, "--player-color": playerColors[player.id] } as CSSProperties}
            >
              <div className="relationship-player-main">
                <span className="relationship-avatar">{player.controller === "bot" ? <Bot size={16} /> : player.name.slice(0, 1)}</span>
                <strong>{player.name}{player.id === playerId ? "（你）" : ""}</strong>
                <button className="color-cycle" title={`更换${player.name}的显示颜色`} onClick={() => onCycleColor(player.id)} aria-label={`更换${player.name}的显示颜色`} />
              </div>
              <div className="relationship-stats"><span><Heart size={13} /> {player.life}</span><span><Bolt size={13} /> {player.charge}</span></div>
              {action && card && (
                <span className="table-played-card">
                  <CardGlyph cardId={action.cardId} size={24} />
                  <b>{card.name}</b>
                </span>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RoundHistoryWindow({ room, playerColors }: { room: PublicRoomState; playerColors: Record<string, string> }) {
  const panelRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [position, setPosition] = useState(() => ({
    x: Math.max(8, window.innerWidth - Math.min(370, window.innerWidth - 16)),
    y: 82,
  }));

  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const width = panelRef.current?.offsetWidth ?? 350;
    const height = panelRef.current?.offsetHeight ?? 80;
    setPosition({
      x: Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX)),
      y: Math.max(8, Math.min(window.innerHeight - Math.min(height, 80), event.clientY - drag.offsetY)),
    });
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const playerName = (id: string) => room.players.find((player) => player.id === id)?.name ?? "未知玩家";

  return (
    <aside ref={panelRef} className={`round-history-window ${collapsed ? "is-collapsed" : ""}`} style={{ left: position.x, top: position.y }}>
      <div className="round-history-handle" onPointerDown={beginDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <GripVertical size={18} />
        <strong>逐回合出牌</strong>
        <span>{room.actionHistory.length}</span>
        <button onClick={() => setCollapsed((value) => !value)}>{collapsed ? "展开" : "收起"}</button>
      </div>
      {!collapsed && (
        <div className="round-history-list">
          {room.actionHistory.length === 0 ? <p>尚无已结算回合</p> : room.actionHistory.slice().reverse().map((record, recordIndex) => (
            <section key={`${record.round}-${room.actionHistory.length - recordIndex}`}>
              <h3>第 {record.round} 回合</h3>
              {record.actions.map((action) => {
                const targets = action.targetIds.map(playerName);
                return (
                  <div className="round-action" key={`${record.round}-${action.playerId}`} style={{ "--player-color": playerColors[action.playerId] } as CSSProperties}>
                    <strong>{playerName(action.playerId)}</strong>
                    <span>{CARD_DEFINITIONS[action.cardId].name}{targets.length ? ` → ${targets.join("、")}` : ""}</span>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
}

function RulesDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="rules-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading"><div><p className="eyebrow">快速参考</p><h2>基础规则</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
        <div className="rule-block"><Shield size={19} /><div><strong>防御</strong><p>小防挡不高于4点；大防挡不高于6点。飞刀、戳可破大防。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>攻击对撞</strong><p>两人互相攻击时（包括散弹、超级飞刀、反鄙视等全场攻击），大伤害压掉小伤害；伤害相同则双方攻击抵消。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>反弹</strong><p>小反反弹1—5点，飞刀和戳不能破小反；大反可反弹反鄙视。</p></div></div>
        <div className="rule-block"><Sparkles size={19} /><div><strong>特殊状态</strong><p>抬枪本轮无敌，但会被大枪破除并受到原伤害。赞的双方本轮无敌、各得1蓄，且只有鄙视能击杀。金鸡独立只会受到散弹、劈、双劈伤害。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>射</strong><p>出牌时必须预先指定目标；若目标本轮出花则直接击杀，亮牌后不能改选。</p></div></div>
        <div className="rule-block"><Bolt size={19} /><div><strong>占星术</strong><p>使用者本轮无敌，之后5轮全场不能出蓄，但仍可通过搓、花、拉获得蓄。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>鄙视猜拳</strong><p>1v1时，若鄙视目标本轮使用了需要消耗蓄的牌，双方进入猜拳。平局继续；鄙视方赢则整局平局，鄙视方输则目标获胜。</p></div></div>
        <div className="rule-block"><Radio size={19} /><div><strong>平局判定</strong><p>鄙视方赢得猜拳时判为平局；普通回合若所有存活玩家同时死亡，也直接判为平局。</p></div></div>
        <div className="rule-block"><Radio size={19} /><div><strong>完全可重放</strong><p>相同初始状态、玩家顺序、出牌和猜拳提交会产生完全相同的结果；超时选择也由牌局种子确定。</p></div></div>
        <div className="rule-block"><Bot size={19} /><div><strong>匿名训练数据</strong><p>完成的对局会保存规则版本、AI版本、匿名座位、逐轮动作和胜负，用于离线训练AI；不保存昵称、重连凭证或IP。</p></div></div>
        <div className="all-card-rules">
          <p className="eyebrow">完整卡牌效果</p>
          {(["B", "C", "D"] as const).map((cardGroup) => (
            <section key={cardGroup}>
              <h3>{CARD_GROUP_LABELS[cardGroup]}</h3>
              {Object.values(CARD_DEFINITIONS).filter((card) => card.group === cardGroup).map((card) => (
                <article key={card.id}>
                  <div><strong>{card.name}</strong><span>{card.cost === 0 ? "免费" : `${card.cost}蓄`}</span></div>
                  <p>{card.description}</p>
                </article>
              ))}
            </section>
          ))}
        </div>
        <button className="secondary-button large" onClick={onClose}><DoorOpen size={18} /> 返回牌局</button>
      </aside>
    </div>
  );
}
