import { useEffect, useMemo, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import {
  Bolt,
  Check,
  ChevronRight,
  CircleHelp,
  Copy,
  Crown,
  DoorOpen,
  Heart,
  LogOut,
  Radio,
  Shield,
  Sparkles,
  Swords,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  BASE_CARD_IDS,
  CARD_DEFINITIONS,
  CARD_GROUP_LABELS,
  type BaseCardId,
  type CardGroup,
  type CardId,
} from "../shared/cards.js";
import type { PublicRoomState, ServerMessage } from "../shared/types.js";

const TOKEN_KEY = "paipai-charge-token";
const NAME_KEY = "paipai-charge-name";

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
  finished: "本局结束",
} as const;

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
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setSelectedCard(null);
    setTargets([]);
  }, [room?.round]);

  useEffect(() => () => {
    socketRef.current?.disconnect();
  }, []);

  const me = room?.players.find((player) => player.id === playerId);
  const submitted = !!room?.submittedPlayerIds.includes(playerId);
  const otherAlivePlayers = room?.players.filter((player) => player.alive && player.id !== playerId) ?? [];
  const secondsLeft = room?.deadlineAt ? Math.max(0, Math.ceil((room.deadlineAt - now) / 1000)) : null;

  const cards = useMemo(() => {
    const ids: CardId[] = [...BASE_CARD_IDS];
    if ((me?.freeBigGuns ?? 0) > 0) ids.push("free_big_gun");
    return ids.filter((id) => group === "ALL" || CARD_DEFINITIONS[id].group === group);
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

  const createRoom = async () => {
    if (!name.trim()) return setError("请先输入昵称");
    setError("");
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
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

          <button className="primary-button" onClick={createRoom} disabled={connection === "connecting"}>
            <Swords size={19} /> 创建房间
          </button>

          <div className="or"><span>或者加入朋友的房间</span></div>
          <div className="join-row">
            <input className="text-input code-input" value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} maxLength={6} placeholder="六位房间码" />
            <button className="secondary-button" onClick={() => connect(joinCode)}>加入 <ChevronRight size={18} /></button>
          </div>
          {error && <p className="error-message">{error}</p>}
          <div className="home-meta"><Users size={16} /> 支持2—10人 · 无需注册 · 手机可玩</div>
        </section>
      </main>
    );
  }

  if (room.phase === "lobby") {
    const isHost = room.hostId === playerId;
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
                <span className="avatar">{player.name.slice(0, 1)}</span>
                <div className="player-copy"><strong>{player.name}</strong><span>{player.connected ? "在线" : "等待重连"}</span></div>
                {player.id === room.hostId && <Crown className="host-crown" size={19} />}
                <span className={`ready-pill ${player.ready ? "is-ready" : ""}`}>{player.ready ? "已准备" : index === 0 ? "房主" : "未准备"}</span>
              </div>
            ))}
          </div>
          <div className="lobby-actions">
            <button className="secondary-button large" onClick={() => send({ type: "ready" })}>{me?.ready ? "取消准备" : "准备"}</button>
            {isHost && <button className="primary-button large" disabled={room.players.length < 2 || room.players.some((player) => !player.ready)} onClick={() => send({ type: "startGame" })}><Swords size={19} /> 开始游戏</button>}
          </div>
          <p className="hint">把房间码发给朋友。所有玩家准备后，由房主开始。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell game-shell">
      <TopBar roomCode={roomCode} connection={connection} onLeave={leaveRoom} />

      <section className="round-strip">
        <div><span>第 {room.round} 回合</span><strong>{phaseLabel[room.phase]}</strong></div>
        {room.astrologyRemaining > 0 && <span className="status-chip astrology"><Sparkles size={15} /> 禁蓄 {room.astrologyRemaining}轮</span>}
        {secondsLeft !== null && <span className={`timer ${secondsLeft <= 10 ? "urgent" : ""}`}>{secondsLeft}s</span>}
      </section>

      <section className="players-grid" aria-label="玩家状态">
        {room.players.map((player) => {
          const action = room.revealedActions.find((item) => item.playerId === player.id);
          return (
            <button
              className={`player-seat ${player.id === playerId ? "is-me" : ""} ${!player.alive ? "is-dead" : ""} ${targets.includes(player.id) ? "is-target" : ""}`}
              key={player.id}
              onClick={() => player.id !== playerId && player.alive && toggleTarget(player.id)}
              disabled={player.id === playerId || !player.alive || !selectedCard}
            >
              <span className="avatar small">{player.name.slice(0, 1)}</span>
              <span className="seat-name">{player.name}{player.id === playerId ? "（你）" : ""}</span>
              <span className="seat-stats"><Heart size={14} /> {player.life} <Bolt size={14} /> {player.charge}</span>
              <span className="seat-state">
                {!player.connected ? "掉线" : !player.alive ? "已死亡" : room.submittedPlayerIds.includes(player.id) ? "已提交" : "选择中"}
              </span>
              {player.goldenRoosterActive && <span className="mini-status">金鸡独立</span>}
              {action && <span className="revealed-card">{CARD_DEFINITIONS[action.cardId].name}</span>}
            </button>
          );
        })}
      </section>

      {room.phase === "finished" ? (
        <section className="result-panel">
          <Crown size={38} />
          <p className="eyebrow">牌局结束</p>
          <h2>{room.winnerIds.length ? `${room.players.find((player) => player.id === room.winnerIds[0])?.name}获胜` : "本局平局"}</h2>
          {room.hostId === playerId && <button className="primary-button" onClick={() => send({ type: "playAgain" })}>再来一局</button>}
        </section>
      ) : (
        <>
          <section className="hand-panel">
            <div className="hand-heading">
              <div><p className="eyebrow">你的手牌</p><h2>{submitted ? "已锁定，等待其他玩家" : selectedCard ? `已选择：${CARD_DEFINITIONS[selectedCard].name}` : "选择本回合要出的牌"}</h2></div>
              <button className="icon-button" onClick={() => setRulesOpen(true)} aria-label="查看规则"><CircleHelp size={20} /></button>
            </div>
            <div className="group-tabs">
              {(["ALL", "B", "C", "D"] as const).map((item) => <button key={item} className={group === item ? "active" : ""} onClick={() => setGroup(item)}>{item === "ALL" ? "全部" : `${item}类`}</button>)}
            </div>
            <div className="cards-grid">
              {cards.map((cardId) => {
                const card = CARD_DEFINITIONS[cardId];
                const disabled = isCardDisabled(cardId);
                const remaining = "limit" in card && card.limit !== undefined ? me?.remainingUses[cardId as keyof typeof me.remainingUses] : undefined;
                return (
                  <button key={cardId} className={`game-card ${selectedCard === cardId ? "selected" : ""}`} disabled={disabled} onClick={() => chooseCard(cardId)}>
                    <span className="card-cost">{card.cost === 0 ? "免费" : `${card.cost}蓄`}</span>
                    <strong>{card.name}</strong>
                    <span>{card.description}</span>
                    {remaining !== undefined && <em>剩余 {remaining}</em>}
                    {cardId === "free_big_gun" && <em>持有 {me?.freeBigGuns}</em>}
                  </button>
                );
              })}
            </div>
          </section>

          {selectedCard && ["one-other", "two-others"].includes(CARD_DEFINITIONS[selectedCard].targetMode) && !submitted && (
            <section className="target-panel">
              <strong>选择目标</strong>
              <span>{CARD_DEFINITIONS[selectedCard].targetMode === "two-others" ? `已选择 ${targets.length}/2` : "点击上方玩家"}</span>
              <div className="target-chips">{targets.map((id) => <button key={id} onClick={() => toggleTarget(id)}>{room.players.find((player) => player.id === id)?.name} ×</button>)}</div>
            </section>
          )}

          <div className="submit-dock">
            <div><span>当前蓄</span><strong><Bolt size={18} /> {me?.charge ?? 0}</strong></div>
            <button className="primary-button submit-button" disabled={!canSubmit} onClick={submit}>{submitted ? <><Check size={19} /> 已提交</> : <>锁定出牌 <ChevronRight size={19} /></>}</button>
          </div>
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

function RulesDrawer({ onClose }: { onClose: () => void }) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="rules-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="section-heading"><div><p className="eyebrow">快速参考</p><h2>基础规则</h2></div><button className="icon-button" onClick={onClose}>×</button></div>
        <div className="rule-block"><Shield size={19} /><div><strong>防御</strong><p>小防挡不高于4点；大防挡不高于6点。飞刀、戳可破大防。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>攻击对撞</strong><p>两人互相攻击时，大伤害压掉小伤害；伤害相同则双方攻击抵消。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>反弹</strong><p>小反反弹1—5点，飞刀和戳不能破小反；大反可反弹反鄙视。</p></div></div>
        <div className="rule-block"><Sparkles size={19} /><div><strong>特殊状态</strong><p>抬枪本轮无敌，但会被大枪破除并受到原伤害。赞的双方本轮无敌、各得1蓄，且只有鄙视能击杀。金鸡独立只会受到散弹、劈、双劈伤害。</p></div></div>
        <div className="rule-block"><Swords size={19} /><div><strong>射</strong><p>出牌时必须预先指定目标；若目标本轮出花则直接击杀，亮牌后不能改选。</p></div></div>
        <div className="rule-block"><Bolt size={19} /><div><strong>占星术</strong><p>使用者本轮无敌，之后5轮全场不能出蓄，但仍可通过搓、花、拉获得蓄。</p></div></div>
        <div className="rule-block"><Radio size={19} /><div><strong>完全可重放</strong><p>结算不使用随机数；相同初始状态、玩家顺序和出牌提交会产生完全相同的结果与事件顺序。</p></div></div>
        <button className="secondary-button large" onClick={onClose}><DoorOpen size={18} /> 返回牌局</button>
      </aside>
    </div>
  );
}
