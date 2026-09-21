import { CARD_DEFINITIONS, LIMITED_STARTING_USES, type CardDefinition, type CardId } from "./cards.js";
import type { GameEvent, PlayerController, PlayerPrivateState, RoomState, SubmittedAction } from "./types.js";

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
    id: `event-${events.length + 1}`,
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
  controller: PlayerController = "human",
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
    controller,
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
  if (["none", "all-others"].includes(card.targetMode) && uniqueTargets.length !== 0) {
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
): RoomState {
  const state = copy(current);
  const playerOrder = new Map(state.players.map((player, index) => [player.id, index]));
  submitted = submitted.slice().sort(
    (left, right) => (playerOrder.get(left.playerId) ?? Number.MAX_SAFE_INTEGER) - (playerOrder.get(right.playerId) ?? Number.MAX_SAFE_INTEGER),
  );
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

  const praiseParticipants = new Set<string>();
  for (const action of submitted) {
    if (action.cardId === "praise") {
      praiseParticipants.add(action.playerId);
      for (const targetId of action.targetIds) {
        praiseParticipants.add(targetId);
      }
    }
  }

  const flowers = new Set(submitted.filter((action) => action.cardId === "flower").map((action) => action.playerId));
  const brokenFlowers = new Set<string>();
  const shootFlowerVictims = new Set<string>();
  for (const action of submitted.filter((item) => item.cardId === "shoot")) {
    const targetId = action.targetIds[0];
    if (!targetId || !flowers.has(targetId)) continue;
    if (praiseParticipants.has(targetId)) {
      event(events, "blocked", `${players.get(targetId)?.name}受到赞的保护，射无法将其击杀`, action.playerId, [targetId]);
      continue;
    }
    brokenFlowers.add(targetId);
    shootFlowerVictims.add(targetId);
    event(events, "damage", `${players.get(action.playerId)?.name}射中了${players.get(targetId)?.name}的花，直接将其击杀`, action.playerId, [targetId], "infinite");
  }

  const invincible = new Set<string>();
  const raiseGunPlayers = new Set<string>();
  for (const action of submitted) {
    if (action.cardId === "flower" && !brokenFlowers.has(action.playerId)) invincible.add(action.playerId);
    if (action.cardId === "push" || action.cardId === "astrology") invincible.add(action.playerId);
    if (action.cardId === "raise_gun") {
      invincible.add(action.playerId);
      raiseGunPlayers.add(action.playerId);
    }
    if (action.cardId === "praise") {
      invincible.add(action.playerId);
      for (const targetId of action.targetIds) invincible.add(targetId);
    }
  }

  const chargeDelta = new Map<string, number>();
  const clearCharge = new Set<string>();
  const clearLife = new Set<string>(shootFlowerVictims);
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
      case "praise":
        addCharge(player.id, 1);
        for (const targetId of action.targetIds) addCharge(targetId, 1);
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

  const attackActions = submitted.filter((action) => {
    const card = CARD_DEFINITIONS[action.cardId] as CardDefinition;
    return card.damage !== undefined && card.tags?.includes("attack");
  });
  const suppressedAttackers = new Set<string>();
  const numericDamage = (action: SubmittedAction) => {
    const amount = (CARD_DEFINITIONS[action.cardId] as CardDefinition).damage;
    return amount === "infinite" ? Number.POSITIVE_INFINITY : amount ?? 0;
  };
  for (let leftIndex = 0; leftIndex < attackActions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < attackActions.length; rightIndex += 1) {
      const left = attackActions[leftIndex];
      const right = attackActions[rightIndex];
      if (!left.targetIds.includes(right.playerId) || !right.targetIds.includes(left.playerId)) continue;
      const leftDamage = numericDamage(left);
      const rightDamage = numericDamage(right);
      const leftCard = CARD_DEFINITIONS[left.cardId] as CardDefinition;
      const rightCard = CARD_DEFINITIONS[right.cardId] as CardDefinition;
      if (leftDamage === rightDamage) {
        suppressedAttackers.add(left.playerId);
        suppressedAttackers.add(right.playerId);
        event(events, "clash", `${players.get(left.playerId)?.name}的${leftCard.name}与${players.get(right.playerId)?.name}的${rightCard.name}伤害相同，双方攻击抵消`, left.playerId, [right.playerId]);
      } else {
        const winner = leftDamage > rightDamage ? left : right;
        const loser = winner === left ? right : left;
        const winnerCard = CARD_DEFINITIONS[winner.cardId] as CardDefinition;
        const loserCard = CARD_DEFINITIONS[loser.cardId] as CardDefinition;
        suppressedAttackers.add(loser.playerId);
        event(events, "clash", `${players.get(winner.playerId)?.name}的${winnerCard.name}压掉了${players.get(loser.playerId)?.name}的${loserCard.name}`, winner.playerId, [loser.playerId]);
      }
    }
  }

  const pendingDamage: PendingDamage[] = [];
  for (const action of submitted) {
    const card = CARD_DEFINITIONS[action.cardId] as CardDefinition;
    if (card.damage === undefined) continue;
    if (suppressedAttackers.has(action.playerId)) continue;
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
      const sourceCard = damage.cardId === "reflection" ? undefined : CARD_DEFINITIONS[damage.cardId] as CardDefinition;
      if (raiseGunPlayers.has(target.id) && sourceCard?.tags?.includes("break-raise-gun")) {
        event(events, "break", `${players.get(damage.sourceId)?.name}用${sourceCard.name}破除了${target.name}的抬枪无敌`, damage.sourceId, [target.id], damage.amount);
        return false;
      }
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
  state.actionHistory.push({
    round: state.round,
    actions: submitted.map((action) => ({ ...action, targetIds: [...action.targetIds] })),
  });
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
