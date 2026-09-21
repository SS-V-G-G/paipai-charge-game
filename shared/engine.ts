import { CARD_DEFINITIONS, LIMITED_STARTING_USES, type CardDefinition, type CardId } from "./cards.js";
import type { GameEvent, PlayerPrivateState, RoomState, SubmittedAction } from "./types.js";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function event(
  events: GameEvent[],
  type: GameEvent["type"],
  text: string,
  sourceId?: string,
  targetIds?: string[],
  amount?: number | "infinite",
) {
  events.push({
    id: `${Date.now()}-${events.length}-${Math.random().toString(36).slice(2, 7)}`,
    type,
    text,
    sourceId,
    targetIds,
    amount,
  });
}

export function createFreshPlayer(
  id: string,
  name: string,
  reconnectToken: string,
  connected = true,
): PlayerPrivateState {
  return {
    id,
    name,
    reconnectToken,
    life: 1,
    charge: 0,
    alive: true,
    ready: false,
    connected,
    remainingUses: { ...LIMITED_STARTING_USES },
    freeBigGuns: 0,
    goldenRoosterActive: false,
    goldenRoosterNext: false,
  };
}

export function resetPlayerForGame(player: PlayerPrivateState): PlayerPrivateState {
  return {
    ...player,
    life: 1,
    charge: 0,
    alive: true,
    ready: false,
    remainingUses: { ...LIMITED_STARTING_USES },
    freeBigGuns: 0,
    goldenRoosterActive: false,
    goldenRoosterNext: false,
  };
}

export function validateAction(
  state: RoomState,
  playerId: string,
  cardId: CardId,
  targetIds: string[],
): string | null {
  const player = state.players.find((item) => item.id === playerId);
  const card = CARD_DEFINITIONS[cardId];
  if (!player?.alive) return "你当前不能行动";
  if (!card) return "未知卡牌";
  if (cardId === "charge" && state.astrologyRemaining > 0) return "占星术持续期间不能出蓄";
  if (cardId === "free_big_gun" && player.freeBigGuns <= 0) return "你没有免费大枪";
  if (player.charge < card.cost) return "蓄不足";
  if ("limit" in card && card.limit !== undefined) {
    const remaining = player.remainingUses[cardId as keyof typeof player.remainingUses];
    if (!remaining || remaining <= 0) return "这张牌的次数已经用完";
  }

  const uniqueTargets = [...new Set(targetIds)];
  const aliveOthers = state.players.filter((item) => item.alive && item.id !== playerId);
  const legalIds = new Set(aliveOthers.map((item) => item.id));
  if (uniqueTargets.some((id) => !legalIds.has(id))) return "包含无效目标";

  if (card.targetMode === "one-other" && uniqueTargets.length !== 1) return "请选择一名目标";
  if (card.targetMode === "two-others" && uniqueTargets.length !== 2) return "请选择两名不同目标";
  if (["none", "all-others", "post-reveal-flower"].includes(card.targetMode) && uniqueTargets.length !== 0) {
    return "这张牌不应在提交时指定目标";
  }
  if (card.targetMode === "two-others" && aliveOthers.length < 2) return "场上没有足够的合法目标";
  return null;
}

interface PendingDamage {
  sourceId: string;
  targetId: string;
  cardId: CardId | "reflection";
  amount: number | "infinite";
  reflectable: boolean;
}

export function resolveRound(
  current: RoomState,
  submitted: SubmittedAction[],
  shootTargets: Record<string, string | undefined> = {},
): RoomState {
  const state = copy(current);
  const events: GameEvent[] = [];
  const actions = new Map(submitted.map((action) => [action.playerId, action]));
  const players = new Map(state.players.map((player) => [player.id, player]));
  const names = (ids: string[]) => ids.map((id) => players.get(id)?.name ?? "未知玩家").join("、");

  for (const action of submitted) {
    const player = players.get(action.playerId)!;
    const card = CARD_DEFINITIONS[action.cardId] as CardDefinition;
    player.charge -= card.cost;
    if (action.cardId === "free_big_gun") player.freeBigGuns -= 1;
    if ("limit" in card && card.limit !== undefined) {
      const key = action.cardId as keyof typeof player.remainingUses;
      player.remainingUses[key] -= 1;
    }
    event(events, "card", `${player.name}使用了${card.name}`, player.id, action.targetIds);
  }

  const flowers = new Set(submitted.filter((action) => action.cardId === "flower").map((action) => action.playerId));
  const brokenFlowers = new Set<string>();
  for (const action of submitted.filter((item) => item.cardId === "shoot")) {
    const targetId = shootTargets[action.playerId];
    if (targetId && flowers.has(targetId)) {
      brokenFlowers.add(targetId);
      event(events, "blocked", `${players.get(action.playerId)?.name}击碎了${players.get(targetId)?.name}的花`, action.playerId, [targetId]);
    }
  }

  const invincible = new Set<string>();
  const praiseParticipants = new Set<string>();
  for (const action of submitted) {
    if (action.cardId === "flower" && !brokenFlowers.has(action.playerId)) invincible.add(action.playerId);
    if (action.cardId === "push" || action.cardId === "astrology") invincible.add(action.playerId);
    if (action.cardId === "praise") {
      invincible.add(action.playerId);
      praiseParticipants.add(action.playerId);
      for (const targetId of action.targetIds) {
        invincible.add(targetId);
        praiseParticipants.add(targetId);
      }
    }
  }

  const chargeDelta = new Map<string, number>();
  const clearCharge = new Set<string>();
  const clearLife = new Set<string>();
  let astrologyAdded = 0;
  const addCharge = (playerId: string, amount: number) => {
    chargeDelta.set(playerId, (chargeDelta.get(playerId) ?? 0) + amount);
  };

  for (const action of submitted) {
    const player = players.get(action.playerId)!;
    switch (action.cardId) {
      case "charge":
        addCharge(player.id, 1);
        break;
      case "rub":
        addCharge(player.id, 2);
        break;
      case "flower":
        if (!brokenFlowers.has(player.id)) addCharge(player.id, 2);
        break;
      case "raise_gun":
        player.freeBigGuns += 1;
        event(events, "resource", `${player.name}获得了一张免费大枪`, player.id);
        break;
      case "astrology":
        astrologyAdded += 5;
        break;
      case "golden_rooster":
        player.goldenRoosterNext = true;
        break;
      case "pull": {
        const targetAction = actions.get(action.targetIds[0]);
        if (targetAction?.cardId === "charge") {
          clearLife.add(player.id);
          event(events, "damage", `${player.name}拉中了蓄，生命被清零`, player.id, [player.id], "infinite");
        } else if (targetAction?.cardId === "small_reflect") {
          addCharge(player.id, 6);
        } else if (targetAction?.cardId === "big_reflect") {
          addCharge(player.id, 12);
        } else {
          addCharge(player.id, 3);
        }
        break;
      }
      case "contempt":
        clearCharge.add(action.targetIds[0]);
        if (praiseParticipants.size > 0) {
          for (const id of praiseParticipants) clearLife.add(id);
          event(events, "damage", `${player.name}的鄙视击中了所有赞的参与者`, player.id, [...praiseParticipants], "infinite");
        } else {
          clearLife.add(player.id);
        }
        break;
    }
  }

  const pendingDamage: PendingDamage[] = [];
  for (const action of submitted) {
    const card = CARD_DEFINITIONS[action.cardId] as CardDefinition;
    if (card.damage === undefined) continue;
    const targets = card.targetMode === "all-others"
      ? state.players.filter((player) => player.alive && player.id !== action.playerId).map((player) => player.id)
      : action.targetIds;
    for (const targetId of targets) {
      pendingDamage.push({
        sourceId: action.playerId,
        targetId,
        cardId: action.cardId,
        amount: card.damage,
        reflectable: true,
      });
    }
  }

  const finalDamage: PendingDamage[] = [];
  const checkStateProtection = (damage: PendingDamage): boolean => {
    const target = players.get(damage.targetId);
    if (!target?.alive) return true;
    if (invincible.has(target.id)) {
      event(events, "blocked", `${target.name}处于无敌状态，免疫了伤害`, damage.sourceId, [target.id], damage.amount);
      return true;
    }
    if (target.goldenRoosterActive) {
      const sourceCard = damage.cardId === "reflection" ? undefined : CARD_DEFINITIONS[damage.cardId] as CardDefinition;
      if (!sourceCard?.tags?.includes("golden-rooster-hit")) {
        event(events, "blocked", `${target.name}以金鸡独立避开了伤害`, damage.sourceId, [target.id], damage.amount);
        return true;
      }
    }
    return false;
  };

  for (const damage of pendingDamage) {
    if (checkStateProtection(damage)) continue;
    const target = players.get(damage.targetId)!;
    const targetAction = actions.get(target.id);
    const amountNumber = damage.amount === "infinite" ? Number.POSITIVE_INFINITY : damage.amount;

    if (targetAction?.cardId === "small_defense" && amountNumber <= 4) {
      event(events, "blocked", `${target.name}的小防挡住了伤害`, damage.sourceId, [target.id], damage.amount);
      continue;
    }
    if (targetAction?.cardId === "big_defense") {
      const sourceCard = damage.cardId === "reflection" ? undefined : CARD_DEFINITIONS[damage.cardId] as CardDefinition;
      const breaksBigDefense = sourceCard?.tags?.includes("break-big-defense");
      if (amountNumber <= 6 && !breaksBigDefense) {
        event(events, "blocked", `${target.name}的大防挡住了伤害`, damage.sourceId, [target.id], damage.amount);
        continue;
      }
    }
    if (damage.reflectable && targetAction?.cardId === "small_reflect" && amountNumber >= 1 && amountNumber <= 5) {
      const reflected: PendingDamage = { ...damage, sourceId: target.id, targetId: damage.sourceId, cardId: "reflection", reflectable: false };
      event(events, "reflected", `${target.name}用小反将伤害反给了${players.get(damage.sourceId)?.name}`, target.id, [damage.sourceId], damage.amount);
      if (!checkStateProtection(reflected)) finalDamage.push(reflected);
      continue;
    }
    if (damage.reflectable && targetAction?.cardId === "big_reflect") {
      const reflected: PendingDamage = { ...damage, sourceId: target.id, targetId: damage.sourceId, cardId: "reflection", reflectable: false };
      event(events, "reflected", `${target.name}用大反将伤害反给了${players.get(damage.sourceId)?.name}`, target.id, [damage.sourceId], damage.amount);
      if (!checkStateProtection(reflected)) finalDamage.push(reflected);
      continue;
    }
    finalDamage.push(damage);
  }

  const damageTotals = new Map<string, number | "infinite">();
  for (const damage of finalDamage) {
    const previous = damageTotals.get(damage.targetId) ?? 0;
    const total = previous === "infinite" || damage.amount === "infinite" ? "infinite" : previous + damage.amount;
    damageTotals.set(damage.targetId, total);
    event(events, "damage", `${players.get(damage.targetId)?.name}受到${damage.amount === "infinite" ? "无限" : damage.amount}点伤害`, damage.sourceId, [damage.targetId], damage.amount);
  }

  for (const [playerId, amount] of damageTotals) {
    const player = players.get(playerId)!;
    player.life = amount === "infinite" ? 0 : Math.max(0, player.life - amount);
  }
  for (const playerId of clearLife) players.get(playerId)!.life = 0;

  for (const [playerId, amount] of chargeDelta) {
    const player = players.get(playerId)!;
    player.charge += amount;
    event(events, "resource", `${player.name}获得${amount}蓄`, player.id, undefined, amount);
  }
  for (const playerId of clearCharge) players.get(playerId)!.charge = 0;

  for (const player of state.players) {
    if (player.alive && player.life <= 0) {
      player.alive = false;
      event(events, "death", `${player.name}死亡`, player.id, [player.id]);
    }
    player.goldenRoosterActive = player.goldenRoosterNext;
    player.goldenRoosterNext = false;
  }

  state.astrologyRemaining = Math.max(0, state.astrologyRemaining - 1) + astrologyAdded;
  state.events = events.slice(-80);
  state.revealedActions = submitted.map((action) => ({ ...action }));
  state.submittedPlayerIds = [];

  const survivors = state.players.filter((player) => player.alive);
  if (survivors.length <= 1) {
    state.phase = "finished";
    state.winnerIds = survivors.map((player) => player.id);
    event(state.events, "system", survivors.length === 1 ? `${survivors[0].name}获得胜利` : "所有玩家同时死亡，本局平局", undefined, state.winnerIds);
  } else {
    state.phase = "selecting";
    state.round += 1;
    state.winnerIds = [];
  }
  return state;
}

export function playerNames(state: RoomState, ids: string[]): string {
  return namesFrom(state.players, ids);
}

function namesFrom(players: PlayerPrivateState[], ids: string[]): string {
  return ids.map((id) => players.find((player) => player.id === id)?.name ?? id).join("、");
}
