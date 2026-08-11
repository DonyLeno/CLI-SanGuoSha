export enum CardType {
  Slash = "杀",
  FireSlash = "火杀",
  ThunderSlash = "雷杀",
  Dodge = "闪",
  Peach = "桃",
  Wine = "酒",
  Dismantle = "过河拆桥",
  Snatch = "顺手牵羊",
  Duel = "决斗",
  ExNihilo = "无中生有",
  Barbarian = "南蛮入侵",
  ArrowRain = "万箭齐发",
  Collateral = "借刀杀人",
  Negate = "无懈可击",
  PeachGarden = "桃园结义",
  Harvest = "五谷丰登",
  FireAttack = "火攻",
  IronChain = "铁索连环",
  Crossbow = "诸葛连弩",
  FemaleSword = "雌雄双股剑",
  QinggangSword = "青釭剑",
  IceSword = "寒冰剑",
  GudingBlade = "古锭刀",
  SerpentSpear = "丈八蛇矛",
  GreenDragonBlade = "青龙偃月刀",
  RockCleavingAxe = "贯石斧",
  Halberd = "方天画戟",
  KylinBow = "麒麟弓",
  ZhuqueFan = "朱雀羽扇",
  EightDiagram = "八卦阵",
  NiohShield = "仁王盾",
  VineArmor = "藤甲",
  SilverLion = "白银狮子",
  Dilu = "的卢",
  JueYing = "绝影",
  ZhuaHuangFeiDian = "爪黄飞电",
  HuaLiu = "骅骝",
  ChiTu = "赤兔",
  DaYuan = "大宛",
  ZiXing = "紫骍",
  WoodenOx = "木牛流马",
  Indulgence = "乐不思蜀",
  SuppliesCut = "兵粮寸断",
  Lightning = "闪电",
}

export type CardColor = "red" | "black" | "colorless";
export type CardSuit = "heart" | "diamond" | "club" | "spade" | "none";
export type CardRank = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13;
export type CardCategory = "basic" | "trick" | "equip";
export type CardSubtype =
  | "none"
  | "delayed-trick"
  | "weapon"
  | "armor"
  | "defense-horse"
  | "attack-horse"
  | "treasure";
export type DamageNature = "normal" | "fire" | "thunder";
export type CardPack = "standard" | "maneuvering" | "project-extension";

export type Card = {
  id: string;
  type: CardType;
  color: CardColor;
  suit: CardSuit;
  rank: number;
};

export type CardDefinition = {
  type: CardType;
  category: CardCategory;
  subtype: CardSubtype;
  trueName: CardType;
  damageNature: DamageNature | null;
};

const basic = (type: CardType, damageNature: DamageNature | null = null): CardDefinition => ({
  type,
  category: "basic",
  subtype: "none",
  trueName:
    type === CardType.FireSlash || type === CardType.ThunderSlash
      ? CardType.Slash
      : type,
  damageNature,
});

const trick = (type: CardType, delayed = false, damageNature: DamageNature | null = null): CardDefinition => ({
  type,
  category: "trick",
  subtype: delayed ? "delayed-trick" : "none",
  trueName: type,
  damageNature,
});

const equip = (type: CardType, subtype: Exclude<CardSubtype, "none" | "delayed-trick">): CardDefinition => ({
  type,
  category: "equip",
  subtype,
  trueName: type,
  damageNature: null,
});

export const CARD_DEFINITIONS: Readonly<Record<CardType, CardDefinition>> = {
  [CardType.Slash]: basic(CardType.Slash, "normal"),
  [CardType.FireSlash]: basic(CardType.FireSlash, "fire"),
  [CardType.ThunderSlash]: basic(CardType.ThunderSlash, "thunder"),
  [CardType.Dodge]: basic(CardType.Dodge),
  [CardType.Peach]: basic(CardType.Peach),
  [CardType.Wine]: basic(CardType.Wine),
  [CardType.Dismantle]: trick(CardType.Dismantle),
  [CardType.Snatch]: trick(CardType.Snatch),
  [CardType.Duel]: trick(CardType.Duel, false, "normal"),
  [CardType.ExNihilo]: trick(CardType.ExNihilo),
  [CardType.Barbarian]: trick(CardType.Barbarian, false, "normal"),
  [CardType.ArrowRain]: trick(CardType.ArrowRain, false, "normal"),
  [CardType.Collateral]: trick(CardType.Collateral),
  [CardType.Negate]: trick(CardType.Negate),
  [CardType.PeachGarden]: trick(CardType.PeachGarden),
  [CardType.Harvest]: trick(CardType.Harvest),
  [CardType.FireAttack]: trick(CardType.FireAttack, false, "fire"),
  [CardType.IronChain]: trick(CardType.IronChain),
  [CardType.Crossbow]: equip(CardType.Crossbow, "weapon"),
  [CardType.FemaleSword]: equip(CardType.FemaleSword, "weapon"),
  [CardType.QinggangSword]: equip(CardType.QinggangSword, "weapon"),
  [CardType.IceSword]: equip(CardType.IceSword, "weapon"),
  [CardType.GudingBlade]: equip(CardType.GudingBlade, "weapon"),
  [CardType.SerpentSpear]: equip(CardType.SerpentSpear, "weapon"),
  [CardType.GreenDragonBlade]: equip(CardType.GreenDragonBlade, "weapon"),
  [CardType.RockCleavingAxe]: equip(CardType.RockCleavingAxe, "weapon"),
  [CardType.Halberd]: equip(CardType.Halberd, "weapon"),
  [CardType.KylinBow]: equip(CardType.KylinBow, "weapon"),
  [CardType.ZhuqueFan]: equip(CardType.ZhuqueFan, "weapon"),
  [CardType.EightDiagram]: equip(CardType.EightDiagram, "armor"),
  [CardType.NiohShield]: equip(CardType.NiohShield, "armor"),
  [CardType.VineArmor]: equip(CardType.VineArmor, "armor"),
  [CardType.SilverLion]: equip(CardType.SilverLion, "armor"),
  [CardType.Dilu]: equip(CardType.Dilu, "defense-horse"),
  [CardType.JueYing]: equip(CardType.JueYing, "defense-horse"),
  [CardType.ZhuaHuangFeiDian]: equip(CardType.ZhuaHuangFeiDian, "defense-horse"),
  [CardType.HuaLiu]: equip(CardType.HuaLiu, "defense-horse"),
  [CardType.ChiTu]: equip(CardType.ChiTu, "attack-horse"),
  [CardType.DaYuan]: equip(CardType.DaYuan, "attack-horse"),
  [CardType.ZiXing]: equip(CardType.ZiXing, "attack-horse"),
  [CardType.WoodenOx]: equip(CardType.WoodenOx, "treasure"),
  [CardType.Indulgence]: trick(CardType.Indulgence, true),
  [CardType.SuppliesCut]: trick(CardType.SuppliesCut, true),
  [CardType.Lightning]: trick(CardType.Lightning, true, "thunder"),
};

type CardSpec = { type: CardType; suit: Exclude<CardSuit, "none">; rank: Exclude<CardRank, 0>; pack: CardPack };
const specs: CardSpec[] = [];

const add = (
  pack: CardPack,
  type: CardType,
  suit: Exclude<CardSuit, "none">,
  ...ranks: Array<Exclude<CardRank, 0>>
): void => {
  for (const rank of ranks) specs.push({ pack, type, suit, rank });
};

const S = "standard" as const;
add(S, CardType.Slash, "spade", 7, 8, 8, 9, 9, 10, 10);
add(S, CardType.Slash, "club", 2, 3, 4, 5, 6, 7, 8, 8, 9, 9, 10, 10, 11, 11);
add(S, CardType.Slash, "heart", 10, 10, 11);
add(S, CardType.Slash, "diamond", 6, 7, 8, 9, 10, 13);
add(S, CardType.Dodge, "heart", 2, 2, 13);
add(S, CardType.Dodge, "diamond", 2, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11);
add(S, CardType.Peach, "heart", 3, 4, 6, 7, 8, 9, 12);
add(S, CardType.Peach, "diamond", 12);
add(S, CardType.Dismantle, "spade", 3, 4, 12);
add(S, CardType.Dismantle, "club", 3, 4);
add(S, CardType.Dismantle, "heart", 12);
add(S, CardType.Snatch, "spade", 3, 4, 11);
add(S, CardType.Snatch, "diamond", 3, 4);
add(S, CardType.Duel, "spade", 1);
add(S, CardType.Duel, "club", 1);
add(S, CardType.Duel, "diamond", 1);
add(S, CardType.Collateral, "club", 12, 13);
add(S, CardType.ExNihilo, "heart", 7, 8, 9, 11);
add(S, CardType.Negate, "spade", 11);
add(S, CardType.Negate, "club", 12, 13);
add(S, CardType.Negate, "diamond", 12);
add(S, CardType.Barbarian, "spade", 7, 13);
add(S, CardType.Barbarian, "club", 7);
add(S, CardType.ArrowRain, "heart", 1);
add(S, CardType.PeachGarden, "heart", 1);
add(S, CardType.Harvest, "heart", 3, 4);
add(S, CardType.Lightning, "spade", 1);
add(S, CardType.Lightning, "heart", 12);
add(S, CardType.Indulgence, "spade", 6);
add(S, CardType.Indulgence, "club", 6);
add(S, CardType.Indulgence, "heart", 6);
add(S, CardType.Crossbow, "club", 1);
add(S, CardType.Crossbow, "diamond", 1);
add(S, CardType.QinggangSword, "spade", 6);
add(S, CardType.IceSword, "spade", 2);
add(S, CardType.FemaleSword, "spade", 2);
add(S, CardType.GreenDragonBlade, "spade", 5);
add(S, CardType.SerpentSpear, "spade", 12);
add(S, CardType.RockCleavingAxe, "diamond", 5);
add(S, CardType.Halberd, "diamond", 12);
add(S, CardType.KylinBow, "heart", 5);
add(S, CardType.EightDiagram, "spade", 2);
add(S, CardType.EightDiagram, "club", 2);
add(S, CardType.NiohShield, "club", 2);
add(S, CardType.Dilu, "club", 5);
add(S, CardType.JueYing, "spade", 5);
add(S, CardType.ZhuaHuangFeiDian, "heart", 13);
add(S, CardType.ChiTu, "heart", 5);
add(S, CardType.DaYuan, "spade", 13);
add(S, CardType.ZiXing, "diamond", 13);

const M = "maneuvering" as const;
add(M, CardType.ThunderSlash, "club", 5, 6, 7, 8);
add(M, CardType.ThunderSlash, "spade", 4, 5, 6, 7, 8);
add(M, CardType.FireSlash, "heart", 4, 7, 10);
add(M, CardType.FireSlash, "diamond", 4, 5);
add(M, CardType.Wine, "spade", 3, 9);
add(M, CardType.Wine, "club", 3, 9);
add(M, CardType.Wine, "diamond", 9);
add(M, CardType.IronChain, "spade", 11, 12);
add(M, CardType.IronChain, "club", 10, 11, 12, 13);
add(M, CardType.FireAttack, "heart", 2, 3);
add(M, CardType.FireAttack, "diamond", 12);
add(M, CardType.SuppliesCut, "spade", 10);
add(M, CardType.SuppliesCut, "club", 4);
add(M, CardType.GudingBlade, "spade", 1);
add(M, CardType.ZhuqueFan, "diamond", 1);
add(M, CardType.VineArmor, "spade", 2);
add(M, CardType.VineArmor, "club", 2);
add(M, CardType.SilverLion, "club", 1);
add(M, CardType.HuaLiu, "diamond", 13);
add(M, CardType.Dodge, "heart", 8, 9, 11, 12);
add(M, CardType.Dodge, "diamond", 6, 7, 8, 10, 11);
add(M, CardType.Peach, "heart", 5, 6);
add(M, CardType.Peach, "diamond", 2, 3);
add(M, CardType.Negate, "heart", 1, 13);
add(M, CardType.Negate, "spade", 13);

add("project-extension", CardType.WoodenOx, "diamond", 5);

const suitColor = (suit: CardSuit): CardColor => {
  if (suit === "heart" || suit === "diamond") return "red";
  if (suit === "club" || suit === "spade") return "black";
  return "colorless";
};

export const STANDARD_CARD_LIBRARY: Card[] = specs
  .filter((spec) => spec.pack === "standard")
  .map((spec, index) => ({ ...spec, id: `standard-${index + 1}`, color: suitColor(spec.suit) }));

export const MANEUVERING_CARD_LIBRARY: Card[] = specs
  .filter((spec) => spec.pack === "maneuvering")
  .map((spec, index) => ({ ...spec, id: `maneuvering-${index + 1}`, color: suitColor(spec.suit) }));

export const PROJECT_EXTENSION_CARD_LIBRARY: Card[] = specs
  .filter((spec) => spec.pack === "project-extension")
  .map((spec, index) => ({ ...spec, id: `project-extension-${index + 1}`, color: suitColor(spec.suit) }));

export const CARD_LIBRARY: Card[] = [
  ...STANDARD_CARD_LIBRARY,
  ...MANEUVERING_CARD_LIBRARY,
  ...PROJECT_EXTENSION_CARD_LIBRARY,
];

export const CARD_LIBRARY_SUMMARY: Array<{ type: CardType; count: number }> = Object.values(CardType)
  .map((type) => ({ type, count: CARD_LIBRARY.filter((card) => card.type === type).length }))
  .filter((item) => item.count > 0);

export const createDeck = (): Card[] => CARD_LIBRARY.map((card) => ({ ...card }));

export const formatCardRank = (rank: number): string => {
  if (rank === 1) return "A";
  if (rank === 11) return "J";
  if (rank === 12) return "Q";
  if (rank === 13) return "K";
  return rank > 0 ? String(rank) : "";
};

export const formatCardSuit = (suit: CardSuit): string => ({
  heart: "♥",
  diamond: "♦",
  club: "♣",
  spade: "♠",
  none: "",
})[suit];

export const formatCard = (card: Pick<Card, "type" | "suit" | "rank">): string => {
  const face = `${formatCardSuit(card.suit)}${formatCardRank(card.rank)}`;
  return face ? `${face} ${card.type}` : card.type;
};

export const shuffle = <T>(items: T[], rng: () => number): T[] => {
  const copied = [...items];
  for (let i = copied.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const current = copied[i];
    const target = copied[j];
    if (current === undefined || target === undefined) continue;
    copied[i] = target;
    copied[j] = current;
  }
  return copied;
};
