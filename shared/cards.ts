export type CardGroup = "B" | "C" | "D";
export type TargetMode = "none" | "one-other" | "two-others" | "all-others";

export interface CardDefinition {
  id: string;
  name: string;
  group: CardGroup;
  cost: number;
  limit?: number;
  targetMode: TargetMode;
  damage?: number | "infinite";
  description: string;
  tags?: string[];
}

export const CARD_DEFINITIONS = {
  small_gun: { id: "small_gun", name: "小枪", group: "B", cost: 1, targetMode: "one-other", damage: 1, description: "对一名玩家造成1点伤害。", tags: ["attack"] },
  cannon: { id: "cannon", name: "炮", group: "B", cost: 2, targetMode: "one-other", damage: 2, description: "对一名玩家造成2点伤害。", tags: ["attack"] },
  flying_knife: { id: "flying_knife", name: "飞刀", group: "B", cost: 3, targetMode: "one-other", damage: 3, description: "造成3点伤害，可以破大防，但不能破小反。", tags: ["attack", "break-big-defense"] },
  stab: { id: "stab", name: "戳", group: "B", cost: 4, targetMode: "one-other", damage: 4, description: "造成4点伤害，可以破大防，但不能破小反。", tags: ["attack", "break-big-defense"] },
  bull: { id: "bull", name: "牛", group: "B", cost: 5, targetMode: "one-other", damage: 5, description: "对一名玩家造成5点伤害。", tags: ["attack"] },
  big_gun: { id: "big_gun", name: "大枪", group: "B", cost: 6, targetMode: "one-other", damage: 6, description: "造成6点伤害；可破抬枪无敌，破除后仍造成原本的6点伤害。", tags: ["attack", "break-raise-gun"] },
  shotgun: { id: "shotgun", name: "散弹", group: "B", cost: 5, targetMode: "all-others", damage: 1, description: "对所有其他玩家各造成1点伤害。", tags: ["attack", "golden-rooster-hit"] },
  slash: { id: "slash", name: "劈", group: "B", cost: 7, targetMode: "one-other", damage: 7, description: "对一名玩家造成7点伤害。", tags: ["attack", "golden-rooster-hit"] },
  backhand_stab: { id: "backhand_stab", name: "反手戳", group: "B", cost: 8, targetMode: "one-other", damage: 8, description: "造成8点伤害；没有特殊破防标签。", tags: ["attack"] },
  double_slash: { id: "double_slash", name: "双劈", group: "B", cost: 10, targetMode: "two-others", damage: 7, description: "选择两名不同玩家，各造成7点伤害。", tags: ["attack", "golden-rooster-hit"] },
  super_flying_knife: { id: "super_flying_knife", name: "超级飞刀", group: "B", cost: 12, targetMode: "all-others", damage: 12, description: "对所有其他玩家各造成12点伤害。", tags: ["attack"] },
  anti_contempt: { id: "anti_contempt", name: "反鄙视", group: "B", cost: 14, targetMode: "all-others", damage: "infinite", description: "对所有其他玩家造成无限伤害，可以被大反反弹。", tags: ["attack"] },
  big_defense: { id: "big_defense", name: "大防", group: "B", cost: 1, targetMode: "none", description: "抵挡不高于6点的伤害；飞刀和戳可破大防。", tags: ["defense"] },
  small_reflect: { id: "small_reflect", name: "小反", group: "B", cost: 2, targetMode: "none", description: "反弹1至5点伤害；飞刀和戳会被正常反弹。", tags: ["reflect"] },
  big_reflect: { id: "big_reflect", name: "大反", group: "B", cost: 5, targetMode: "none", description: "反弹伤害，包括反鄙视的无限伤害。", tags: ["reflect"] },
  raise_gun: { id: "raise_gun", name: "抬枪", group: "B", cost: 3, targetMode: "none", description: "本轮无敌，并获得一张蓄费为0的免费大枪；该无敌可被大枪破除。", tags: ["invincible"] },
  astrology: { id: "astrology", name: "占星术", group: "B", cost: 5, targetMode: "none", description: "本轮无敌；后续5轮全场不能出蓄，重复使用叠加时长。", tags: ["invincible"] },

  rub: { id: "rub", name: "搓", group: "C", cost: 0, limit: 1, targetMode: "none", description: "获得2蓄，没有防御效果。" },
  flower: { id: "flower", name: "花", group: "C", cost: 0, limit: 2, targetMode: "none", description: "本轮无敌并获得2蓄；被射击碎时整张牌失效。", tags: ["invincible"] },
  shoot: { id: "shoot", name: "射", group: "C", cost: 0, limit: 1, targetMode: "one-other", description: "出牌时预先指定一名玩家；若其本轮出花，则直接击杀。亮牌后不能更换目标。" },
  push: { id: "push", name: "推", group: "C", cost: 0, limit: 1, targetMode: "none", description: "本轮无敌。", tags: ["invincible"] },
  praise: { id: "praise", name: "赞", group: "C", cost: 0, limit: 1, targetMode: "one-other", description: "本轮自己和目标无敌，只有鄙视可以击杀；双方各获得1蓄。", tags: ["invincible"] },
  golden_rooster: { id: "golden_rooster", name: "金鸡独立", group: "C", cost: 0, limit: 2, targetMode: "none", description: "下一轮进入金鸡独立状态，仅散弹、劈、双劈能够造成伤害。" },

  charge: { id: "charge", name: "蓄", group: "D", cost: 0, targetMode: "none", description: "获得1蓄。" },
  pull: { id: "pull", name: "拉", group: "D", cost: 0, targetMode: "one-other", description: "目标出蓄则自己生命清零；否则获得3蓄，小反为6，大反为12。" },
  small_defense: { id: "small_defense", name: "小防", group: "D", cost: 0, targetMode: "none", description: "抵挡不高于4点的伤害。", tags: ["defense"] },
  contempt: { id: "contempt", name: "鄙视", group: "D", cost: 0, targetMode: "one-other", description: "清空自己生命和目标蓄；场上有赞时改为击杀所有赞的参与者。" },

  free_big_gun: { id: "free_big_gun", name: "免费大枪", group: "D", cost: 0, targetMode: "one-other", damage: 6, description: "由抬枪获得，用后消耗一张；可破抬枪无敌并造成原本的6点伤害。", tags: ["attack", "derived", "break-raise-gun"] },
} as const satisfies Record<string, Omit<CardDefinition, "id"> & { id: string }>;

export type CardId = keyof typeof CARD_DEFINITIONS;
export type BaseCardId = Exclude<CardId, "free_big_gun">;
export type LimitedCardId = "rub" | "flower" | "shoot" | "push" | "praise" | "golden_rooster";

export const BASE_CARD_IDS = Object.keys(CARD_DEFINITIONS).filter(
  (id) => id !== "free_big_gun",
) as BaseCardId[];

export const LIMITED_STARTING_USES: Record<LimitedCardId, number> = {
  rub: 1,
  flower: 2,
  shoot: 1,
  push: 1,
  praise: 1,
  golden_rooster: 2,
};

export const CARD_GROUP_LABELS: Record<CardGroup, string> = {
  B: "耗蓄 · 无限",
  C: "免费 · 有限",
  D: "免费 · 无限",
};
