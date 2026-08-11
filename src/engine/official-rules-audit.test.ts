import assert from "node:assert/strict";
import test from "node:test";
import { Card, CardType } from "./cards.js";
import { computeDistanceBetween } from "./resolve.js";
import { SanGuoGame } from "./game.js";
import { GameAction, Player, PlayerRole, SkillName, TurnPhase } from "./types.js";

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  suit,
  rank,
  color: suit === "heart" || suit === "diamond" ? "red" : suit === "none" ? "colorless" : "black",
});

type Runtime = {
  players: Player[];
  currentPlayerIndex: number;
  phase: TurnPhase;
  deck: Card[];
  discardPile: Card[];
  applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    nature?: "normal" | "fire" | "thunder",
  ): Promise<void>;
};

const setup = async (count = 4): Promise<{ game: SanGuoGame; runtime: Runtime }> => {
  const game = new SanGuoGame(() => 0);
  await game.initNetworkGame(
    Array.from({ length: count }, (_, index) => ({ id: `p${index}`, name: `玩家${index}` })),
    3,
    false,
  );
  const runtime = game as unknown as Runtime;
  for (const player of runtime.players) {
    player.skills = [];
    player.hand = [];
    player.weapon = null;
    player.armor = null;
    player.defenseHorse = null;
    player.attackHorse = null;
    player.treasure = null;
    player.treasureCards = [];
    player.equippedCards = {};
    player.delayedTricks = [];
    player.chained = false;
    player.faceDown = false;
    player.alive = true;
    game.setDecisionHandler(player.id, () => ({ choice: "pass" }));
  }
  runtime.currentPlayerIndex = 0;
  runtime.phase = TurnPhase.Play;
  return { game, runtime };
};

const playActionFor = (game: SanGuoGame, player: Player, type: CardType): Extract<GameAction, { type: "play" }> => {
  const action = game.getPlayableActions(player.id).find(
    (candidate) => candidate.type === "play" && candidate.label === `使用 ${type}`,
  );
  assert.ok(action?.type === "play", `应存在“使用 ${type}”动作`);
  return action;
};

// 每一项都必须落到一个实际行为测试族；此清单防止以后新增枚举却漏掉规则核验。
const skillAudit: ReadonlyArray<readonly [SkillName, string]> = [
  [SkillName.Heroic, "摸牌阶段技能"],
  [SkillName.Roar, "杀次数限制"],
  [SkillName.Assault, "主动伤害技能"],
  [SkillName.JuShou, "翻面与结束阶段"],
  [SkillName.JieWei, "装备转化与移动场上牌"],
  [SkillName.JianXiong, "伤害牌获得"],
  [SkillName.HuJia, "势力响应"],
  [SkillName.QingGuo, "闪转化"],
  [SkillName.LuoShen, "连续判定"],
  [SkillName.GangLie, "受伤后判定"],
  [SkillName.LuoYi, "摸牌改写与伤害"],
  [SkillName.TuXi, "摸牌来源改写"],
  [SkillName.TianDu, "判定牌获得"],
  [SkillName.YiJi, "逐点伤害分牌"],
  [SkillName.FanKui, "伤害来源取牌"],
  [SkillName.GuiCai, "改判"],
  [SkillName.RenDe, "交牌与回复"],
  [SkillName.JiJiang, "势力响应"],
  [SkillName.WuSheng, "杀转化"],
  [SkillName.LongDan, "杀闪互换"],
  [SkillName.MaShu, "距离修正"],
  [SkillName.TieQi, "杀指定目标后判定"],
  [SkillName.GuanXing, "牌堆顶底排序"],
  [SkillName.KongCheng, "目标合法性"],
  [SkillName.JiZhi, "锦囊触发摸牌"],
  [SkillName.QiCai, "锦囊距离"],
  [SkillName.ZhiHeng, "精确弃牌摸牌"],
  [SkillName.QiXi, "过河拆桥转化"],
  [SkillName.KeJi, "弃牌阶段跳过"],
  [SkillName.JiuYuan, "吴势力桃额外回复"],
  [SkillName.FanJian, "声明花色与匿名选牌"],
  [SkillName.KuRou, "失去体力摸牌"],
  [SkillName.QianXun, "目标合法性"],
  [SkillName.LianYing, "失去最后手牌"],
  [SkillName.GuoSe, "乐不思蜀转化"],
  [SkillName.LiuLi, "杀目标转移"],
  [SkillName.JieYin, "双目标回复"],
  [SkillName.XiaoJi, "装备离场"],
  [SkillName.WuShuang, "双闪双杀响应"],
  [SkillName.LiJian, "不可无懈的决斗"],
  [SkillName.BiYue, "结束阶段摸牌"],
  [SkillName.QingNang, "弃手牌回复"],
  [SkillName.JiJiu, "回合外桃转化"],
  [SkillName.JiAng, "红杀与决斗指定目标"],
  [SkillName.HunZi, "觉醒"],
  [SkillName.YingHun, "损失体力值分支"],
  [SkillName.ZhiBa, "拼点与觉醒后拒绝"],
];

const cardAudit: ReadonlyArray<readonly [CardType, string]> = [
  [CardType.Slash, "杀与闪"], [CardType.FireSlash, "属性伤害与铁索"],
  [CardType.ThunderSlash, "属性伤害与铁索"], [CardType.Dodge, "杀与闪"],
  [CardType.Peach, "出牌回复与濒死"], [CardType.Wine, "杀伤害与濒死自救"],
  [CardType.Dismantle, "区域选牌"], [CardType.Snatch, "距离与区域选牌"],
  [CardType.Duel, "轮流打杀"], [CardType.ExNihilo, "选择目标摸牌"],
  [CardType.Barbarian, "逐目标杀响应"], [CardType.ArrowRain, "逐目标闪响应"],
  [CardType.Collateral, "武器持有者与杀目标"], [CardType.Negate, "无懈链"],
  [CardType.PeachGarden, "全体回复"], [CardType.Harvest, "逐人自选亮出牌"],
  [CardType.FireAttack, "展示与同花色弃牌"], [CardType.IronChain, "一至二目标与重铸"],
  [CardType.Crossbow, "杀次数"], [CardType.FemaleSword, "异性分支"],
  [CardType.QinggangSword, "无视防具"], [CardType.IceSword, "防止伤害依次弃牌"],
  [CardType.GudingBlade, "空手伤害"], [CardType.SerpentSpear, "两牌转化杀"],
  [CardType.GreenDragonBlade, "闪后追杀"], [CardType.RockCleavingAxe, "弃两牌强制命中"],
  [CardType.Halberd, "最后手牌额外目标"], [CardType.KylinBow, "自选弃坐骑"],
  [CardType.ZhuqueFan, "普通杀转火杀"], [CardType.EightDiagram, "逐次判定闪"],
  [CardType.NiohShield, "黑色杀无效"], [CardType.VineArmor, "普通杀与群体锦囊无效/火伤+1"],
  [CardType.SilverLion, "伤害封顶与离场回复"],
  [CardType.Dilu, "+1坐骑"], [CardType.JueYing, "+1坐骑"],
  [CardType.ZhuaHuangFeiDian, "+1坐骑"], [CardType.HuaLiu, "+1坐骑"],
  [CardType.ChiTu, "-1坐骑"], [CardType.DaYuan, "-1坐骑"], [CardType.ZiXing, "-1坐骑"],
  [CardType.WoodenOx, "置粮/使用/打出/即时移动"],
  [CardType.Indulgence, "判定跳过出牌"], [CardType.SuppliesCut, "判定跳过摸牌"],
  [CardType.Lightning, "判定伤害与循环转移"],
];

void test("官方规则审计清单覆盖每个技能和每种卡牌/装备且无重复", () => {
  assert.deepEqual(new Set(skillAudit.map(([skill]) => skill)), new Set(Object.values(SkillName)));
  assert.equal(skillAudit.length, Object.values(SkillName).length);
  assert.deepEqual(new Set(cardAudit.map(([type]) => type)), new Set(Object.values(CardType)));
  assert.equal(cardAudit.length, Object.values(CardType).length);
  assert.ok(skillAudit.every(([, family]) => family.length > 0));
  assert.ok(cardAudit.every(([, family]) => family.length > 0));
});

void test("桃和无中生有可选择包括自己在内的合法角色；酒按项目规则只能对自己使用", async () => {
  const { game, runtime } = await setup(3);
  const user = runtime.players[0]!;
  const beneficiary = runtime.players[1]!;
  user.hp -= 1;
  beneficiary.hp -= 1;
  user.hand = [makeCard("peach", CardType.Peach), makeCard("wine", CardType.Wine, "spade"), makeCard("ex", CardType.ExNihilo)];
  runtime.deck = [makeCard("draw-1", CardType.Dodge), makeCard("draw-2", CardType.Slash)];

  const peach = playActionFor(game, user, CardType.Peach);
  assert.ok(peach.targets.includes(user.id) && peach.targets.includes(beneficiary.id));
  await game.playAction(user.id, peach, beneficiary.id);
  assert.equal(beneficiary.hp, beneficiary.maxHp);

  const wine = playActionFor(game, user, CardType.Wine);
  assert.deepEqual(wine.targets, [user.id]);
  const rejected = await game.playAction(user.id, wine, beneficiary.id);
  assert.deepEqual(rejected, ["酒只能对自己使用"]);
  assert.ok(user.hand.some((card) => card.id === "wine"), "非法目标不能消耗酒");
  await game.playAction(user.id, wine, user.id);
  assert.equal(user.hand.some((card) => card.id === "wine"), false);

  const exNihilo = playActionFor(game, user, CardType.ExNihilo);
  assert.ok(exNihilo.targets.includes(user.id) && exNihilo.targets.includes(beneficiary.id));
  await game.playAction(user.id, exNihilo, beneficiary.id);
  assert.equal(beneficiary.hand.length, 2);
});

void test("火攻和铁索连环可选择自己，但最后一张手牌火攻不能以自己为目标", async () => {
  const { game, runtime } = await setup(3);
  const user = runtime.players[0]!;
  user.hand = [makeCard("fire", CardType.FireAttack), makeCard("cost", CardType.Peach)];
  game.setDecisionHandler(user.id, (request) => {
    if (request.kind === "choose-card") {
      const source = request.sources.find((candidate) => candidate.sourceId === "reveal:cost");
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    if (request.kind === "choose-discard") return { choice: "card", sourceId: "hand:cost" };
    return { choice: "pass" };
  });
  const fire = playActionFor(game, user, CardType.FireAttack);
  assert.ok(fire.targets.includes(user.id));
  const hpBefore = user.hp;
  await game.playAction(user.id, fire, user.id);
  assert.equal(user.hp, hpBefore - 1);

  user.hand = [makeCard("chain", CardType.IronChain, "club", 10)];
  const chain = playActionFor(game, user, CardType.IronChain);
  assert.ok(chain.targets.includes(user.id));
  await game.playAction(user.id, chain, user.id);
  assert.equal(user.chained, true);

  user.hand = [makeCard("last-fire", CardType.FireAttack)];
  runtime.players[1]!.hand = [makeCard("other-hand", CardType.Dodge)];
  const lastFire = playActionFor(game, user, CardType.FireAttack);
  assert.equal(lastFire.targets.includes(user.id), false);
});

void test("借刀杀人可令持刀者攻击使用者本人，且无杀时仍先确定目标再交出武器", async () => {
  const { game, runtime } = await setup(3);
  const user = runtime.players[0]!;
  const holder = runtime.players[1]!;
  const onlyOther = runtime.players[2]!;
  user.hand = [makeCard("collateral", CardType.Collateral, "club", 12)];
  holder.weapon = CardType.Crossbow;
  holder.equippedCards = { weapon: makeCard("weapon", CardType.Crossbow, "club", 1) };
  onlyOther.skills = [SkillName.KongCheng];
  onlyOther.hand = [];
  let victimChosenBeforeHandOver = false;
  game.setDecisionHandler(user.id, (request) => {
    if (request.kind === "collateral") {
      assert.ok(request.victims.includes(user.id));
      victimChosenBeforeHandOver = true;
      return { choice: "target", targetId: user.id };
    }
    return { choice: "pass" };
  });
  game.setDecisionHandler(holder.id, (request) => request.kind === "collateral"
    ? { choice: "pass" }
    : { choice: "pass" });
  const action = playActionFor(game, user, CardType.Collateral);
  assert.ok(action.targets.includes(holder.id));
  await game.playAction(user.id, action, holder.id);
  assert.equal(victimChosenBeforeHandOver, true);
  assert.equal(holder.weapon, null);
  assert.ok(user.hand.some((card) => card.id === "weapon"));
});

void test("强袭按攻击范围选目标，且不能把木牛流马下的武器牌当弃置费用", async () => {
  const { game, runtime } = await setup(4);
  const dianWei = runtime.players[0]!;
  const distant = runtime.players[2]!;
  dianWei.skills = [SkillName.Assault];
  dianWei.weapon = CardType.GreenDragonBlade;
  dianWei.equippedCards = { weapon: makeCard("blade", CardType.GreenDragonBlade, "spade", 5) };
  dianWei.treasure = CardType.WoodenOx;
  dianWei.treasureCards = [makeCard("grain-weapon", CardType.KylinBow)];
  const action = game.getPlayableActions(dianWei.id).find(
    (candidate) => candidate.type === "skill" && candidate.skill === SkillName.Assault,
  );
  assert.ok(action?.type === "skill" && action.targets.includes(distant.id));
  game.setDecisionHandler(dianWei.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "choose-discard") {
      assert.equal(request.sources.some((source) => source.sourceId === "treasure:grain-weapon"), false);
      const weapon = request.sources.find((source) => source.origin === "weapon");
      return weapon ? { choice: "card", sourceId: weapon.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const hpBefore = distant.hp;
  await game.playAction(dianWei.id, action, distant.id);
  assert.equal(distant.hp, hpBefore - 1);
  assert.equal(dianWei.treasureCards[0]?.id, "grain-weapon");
});

void test("裸衣少摸一张后，本回合杀造成的伤害增加1点", async () => {
  const { game, runtime } = await setup(3);
  const xuChu = runtime.players[0]!;
  const target = runtime.players[1]!;
  xuChu.skills = [SkillName.LuoYi];
  runtime.deck = [makeCard("luoyi-slash", CardType.Slash)];
  game.setOptionalEffectDecision(xuChu.id, SkillName.LuoYi, true);
  await game.startTurn();
  assert.equal(xuChu.hand.length, 1);
  const hpBefore = target.hp;
  await game.playAction(xuChu.id, playActionFor(game, xuChu, CardType.Slash), target.id);
  assert.equal(target.hp, hpBefore - 2);
});

void test("诸葛连弩与咆哮都允许在出牌阶段继续使用第二张杀", async () => {
  for (const mode of ["crossbow", "roar"] as const) {
    const { game, runtime } = await setup(3);
    const attacker = runtime.players[0]!;
    const target = runtime.players[1]!;
    attacker.hand = [makeCard(`${mode}-1`, CardType.Slash), makeCard(`${mode}-2`, CardType.Slash)];
    if (mode === "crossbow") attacker.weapon = CardType.Crossbow;
    else attacker.skills = [SkillName.Roar];
    await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
    assert.ok(game.getPlayableActions(attacker.id).some((action) => action.type === "play" && action.label === `使用 ${CardType.Slash}`));
  }
});

void test("青釭剑和古锭刀为锁定效果，不询问发动且分别无视防具/对空手目标增伤", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  let optionalPrompts = 0;
  game.setDecisionHandler(attacker.id, (request) => {
    if (request.kind === "optional-effect") optionalPrompts += 1;
    return { choice: "pass" };
  });
  attacker.weapon = CardType.QinggangSword;
  target.armor = CardType.NiohShield;
  attacker.hand = [makeCard("black-slash", CardType.Slash, "spade")];
  const beforeQinggang = target.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.hp, beforeQinggang - 1);
  assert.equal(optionalPrompts, 0);

  (runtime as { phase: TurnPhase }).phase = TurnPhase.Play;
  (runtime as { currentPlayerIndex: number }).currentPlayerIndex = 0;
  (game as unknown as { slashUsedThisTurn: boolean }).slashUsedThisTurn = false;
  attacker.weapon = CardType.GudingBlade;
  target.armor = null;
  target.hand = [];
  attacker.hand = [makeCard("guding-slash", CardType.Slash, "club")];
  const beforeGuding = target.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.hp, beforeGuding - 2);
  assert.equal(optionalPrompts, 0);
});

void test("丈八蛇矛由玩家选择两张手牌/粮，混色虚拟杀不受仁王盾影响", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.weapon = CardType.SerpentSpear;
  attacker.treasure = CardType.WoodenOx;
  attacker.hand = [makeCard("red-cost", CardType.Peach, "heart")];
  attacker.treasureCards = [makeCard("black-grain", CardType.Dismantle, "club")];
  target.armor = CardType.NiohShield;
  game.setDecisionHandler(attacker.id, (request) => {
    if (request.kind === "choose-discard") {
      const wanted = request.reason.includes("1/2") ? "hand:red-cost" : "treasure:black-grain";
      return { choice: "card", sourceId: wanted };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(attacker.id).find(
    (candidate) => candidate.type === "play" && candidate.cardIndex === -1,
  );
  assert.ok(action?.type === "play");
  const hpBefore = target.hp;
  await game.playAction(attacker.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(attacker.hand.length, 0);
  assert.equal(attacker.treasureCards.length, 0);
});

void test("丈八蛇矛可在南蛮入侵或决斗中将两张手牌/粮当杀打出", async () => {
  const { game, runtime } = await setup(3);
  const user = runtime.players[0]!;
  const responder = runtime.players[1]!;
  user.hand = [makeCard("barbarian", CardType.Barbarian)];
  responder.weapon = CardType.SerpentSpear;
  responder.hand = [makeCard("serpent-cost-1", CardType.Peach), makeCard("serpent-cost-2", CardType.Dodge, "club")];
  game.setDecisionHandler(responder.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "choose-discard") {
      const wanted = request.reason.includes("1/2") ? "hand:serpent-cost-1" : "hand:serpent-cost-2";
      return { choice: "card", sourceId: wanted };
    }
    return { choice: "pass" };
  });
  const hpBefore = responder.hp;
  const logs = await game.playAction(user.id, playActionFor(game, user, CardType.Barbarian));
  assert.equal(responder.hp, hpBefore);
  assert.equal(responder.hand.length, 0);
  assert.ok(logs.some((line) => line.includes(CardType.SerpentSpear) && line.includes("当杀打出")));
});

void test("主动激将接受蜀势力角色以丈八蛇矛提供的虚拟杀", async () => {
  const { game, runtime } = await setup(3);
  const lord = runtime.players[0]!;
  const shuResponder = runtime.players[1]!;
  const target = runtime.players[2]!;
  lord.role = PlayerRole.Lord;
  lord.skills = [SkillName.JiJiang];
  shuResponder.general = "关羽";
  shuResponder.weapon = CardType.SerpentSpear;
  shuResponder.hand = [makeCard("jijiang-cost-1", CardType.Peach), makeCard("jijiang-cost-2", CardType.Dodge, "club")];
  game.setDecisionHandler(shuResponder.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "choose-discard") {
      const wanted = request.reason.includes("1/2") ? "hand:jijiang-cost-1" : "hand:jijiang-cost-2";
      return { choice: "card", sourceId: wanted };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(lord.id).find(
    (candidate) => candidate.type === "skill" && candidate.skill === SkillName.JiJiang,
  );
  assert.ok(action?.type === "skill");
  const hpBefore = target.hp;
  await game.playAction(lord.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(shuResponder.hand.length, 0);
});

void test("流离的弃置费用不能使用木牛流马下的粮", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const daQiao = runtime.players[1]!;
  daQiao.skills = [SkillName.LiuLi];
  daQiao.treasure = CardType.WoodenOx;
  daQiao.treasureCards = [makeCard("liuli-grain", CardType.Peach)];
  attacker.hand = [makeCard("liuli-slash", CardType.Slash)];
  let discardPrompted = false;
  game.setDecisionHandler(daQiao.id, (request) => {
    if (request.kind === "collateral") return { choice: "target", targetId: runtime.players[2]!.id };
    if (request.kind === "choose-discard") {
      discardPrompted = true;
      assert.equal(request.sources.some((source) => source.sourceId === "treasure:liuli-grain"), false);
    }
    return { choice: "pass" };
  });
  const hpBefore = daQiao.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), daQiao.id);
  assert.equal(discardPrompted, true);
  assert.equal(daQiao.hp, hpBefore - 1);
  assert.equal(daQiao.treasureCards[0]?.id, "liuli-grain");
});

void test("寒冰剑依次由攻击者选择两张牌，并防止本次伤害", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.weapon = CardType.IceSword;
  attacker.hand = [makeCard("slash", CardType.Slash)];
  target.hand = [makeCard("hidden", CardType.Peach)];
  target.defenseHorse = CardType.Dilu;
  target.equippedCards = { defenseHorse: makeCard("dilu", CardType.Dilu, "club", 5) };
  game.setOptionalEffectDecision(attacker.id, CardType.IceSword, true);
  let pick = 0;
  game.setDecisionHandler(attacker.id, (request) => {
    if (request.kind === "choose-card") {
      pick += 1;
      return { choice: "card", sourceId: pick === 1 ? "defenseHorse" : "hand-random" };
    }
    return { choice: "pass" };
  });
  const hpBefore = target.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.hp, hpBefore);
  assert.equal(target.defenseHorse, null);
  assert.equal(target.hand.length, 0);
});

void test("贯石斧费用由攻击者选择且不能弃置正在发动的贯石斧", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.weapon = CardType.RockCleavingAxe;
  attacker.equippedCards = { weapon: makeCard("axe", CardType.RockCleavingAxe, "diamond", 5) };
  attacker.hand = [makeCard("slash", CardType.Slash), makeCard("cost-1", CardType.Peach), makeCard("cost-2", CardType.Wine, "spade")];
  target.hand = [makeCard("dodge", CardType.Dodge)];
  game.setDecisionHandler(target.id, (request) => request.kind === "respond"
    ? { choice: "card", sourceId: "hand:dodge" }
    : { choice: "pass" });
  game.setOptionalEffectDecision(attacker.id, CardType.RockCleavingAxe, true);
  game.setDecisionHandler(attacker.id, (request) => {
    if (request.kind === "choose-discard") {
      assert.equal(request.sources.some((source) => source.sourceId === "weapon"), false);
      const id = request.reason.includes("1/2") ? "hand:cost-1" : "hand:cost-2";
      return { choice: "card", sourceId: id };
    }
    return { choice: "pass" };
  });
  const hpBefore = target.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(attacker.weapon, CardType.RockCleavingAxe);
});

void test("方天画戟的额外目标由使用者逐名选择并可提前取消", async () => {
  const { game, runtime } = await setup(4);
  const attacker = runtime.players[0]!;
  const primary = runtime.players[1]!;
  const selected = runtime.players[2]!;
  const untouched = runtime.players[3]!;
  attacker.weapon = CardType.Halberd;
  attacker.hand = [makeCard("last-slash", CardType.Slash, "diamond")];
  let prompt = 0;
  game.setDecisionHandler(attacker.id, (request) => {
    if (request.kind === "collateral") {
      prompt += 1;
      return prompt === 1 ? { choice: "target", targetId: selected.id } : { choice: "pass" };
    }
    return { choice: "pass" };
  });
  const hp = new Map(runtime.players.map((player) => [player.id, player.hp]));
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), primary.id);
  assert.equal(primary.hp, (hp.get(primary.id) ?? 0) - 1);
  assert.equal(selected.hp, (hp.get(selected.id) ?? 0) - 1);
  assert.equal(untouched.hp, hp.get(untouched.id));
});

void test("麒麟弓由攻击者选择弃置哪一匹坐骑", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.weapon = CardType.KylinBow;
  attacker.hand = [makeCard("slash", CardType.Slash)];
  target.defenseHorse = CardType.Dilu;
  target.attackHorse = CardType.ChiTu;
  target.equippedCards = {
    defenseHorse: makeCard("dilu", CardType.Dilu, "club", 5),
    attackHorse: makeCard("chitu", CardType.ChiTu, "heart", 5),
  };
  game.setOptionalEffectDecision(attacker.id, CardType.KylinBow, true);
  game.setDecisionHandler(attacker.id, (request) => request.kind === "choose-card"
    ? { choice: "card", sourceId: "attackHorse" }
    : { choice: "pass" });
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.attackHorse, null);
  assert.equal(target.defenseHorse, CardType.Dilu);
});

void test("朱雀羽扇把普通杀转为火杀，藤甲令火焰伤害+1", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.weapon = CardType.ZhuqueFan;
  attacker.hand = [makeCard("slash", CardType.Slash, "spade")];
  target.armor = CardType.VineArmor;
  game.setOptionalEffectDecision(attacker.id, CardType.ZhuqueFan, true);
  const hpBefore = target.hp;
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.equal(target.hp, hpBefore - 2);
});

void test("白银狮子锁定伤害为1，失去时回复1点体力", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  target.armor = CardType.SilverLion;
  target.equippedCards = { armor: makeCard("lion", CardType.SilverLion, "club", 1) };
  const hpBefore = target.hp;
  await runtime.applyDamage(attacker, target, 3, "测试伤害", []);
  assert.equal(target.hp, hpBefore - 1);
  target.hp -= 1;
  attacker.hand = [makeCard("dismantle", CardType.Dismantle, "spade", 3)];
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Dismantle), target.id, "armor");
  assert.equal(target.armor, null);
  assert.equal(target.hp, hpBefore - 1);
});

void test("每一匹+1/-1坐骑都应用相同的官方距离修正", () => {
  const base = (id: string): Player => ({
    id, name: id, role: PlayerRole.Rebel, gender: "男", general: "吕布", skills: [], isAI: false,
    hp: 4, maxHp: 4, hand: [], weapon: null, armor: null, defenseHorse: null, attackHorse: null,
    treasure: null, treasureCards: [], equippedCards: {}, delayedTricks: [], alive: true, faceDown: false,
  });
  const attacker = base("a");
  const target = base("b");
  const third = base("c");
  const fourth = base("d");
  const players = [attacker, third, target, fourth];
  assert.equal(computeDistanceBetween(players, attacker, target), 2);
  for (const horse of [CardType.Dilu, CardType.JueYing, CardType.ZhuaHuangFeiDian, CardType.HuaLiu] as const) {
    target.defenseHorse = horse;
    assert.equal(computeDistanceBetween(players, attacker, target), 3, `${horse}应令其他角色到自己的距离+1`);
  }
  target.defenseHorse = null;
  for (const horse of [CardType.ChiTu, CardType.DaYuan, CardType.ZiXing] as const) {
    attacker.attackHorse = horse;
    assert.equal(computeDistanceBetween(players, attacker, target), 1, `${horse}应令自己到其他角色的距离-1`);
  }
});

void test("木牛流马置粮后只能立即移动给宝物栏为空的角色，粮随宝物移动", async () => {
  const { game, runtime } = await setup(3);
  const owner = runtime.players[0]!;
  const receiver = runtime.players[1]!;
  const occupied = runtime.players[2]!;
  owner.treasure = CardType.WoodenOx;
  owner.equippedCards = { treasure: makeCard("ox", CardType.WoodenOx, "diamond", 5) };
  owner.hand = [makeCard("grain", CardType.Dodge)];
  occupied.treasure = CardType.WoodenOx;
  game.setDecisionHandler(owner.id, (request) => {
    if (request.kind === "choose-card") return { choice: "card", sourceId: "hand:grain" };
    if (request.kind === "collateral") {
      assert.deepEqual(request.victims, [receiver.id]);
      return { choice: "target", targetId: receiver.id };
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(owner.id).find(
    (candidate) => candidate.type === "play" && candidate.cardIndex === -11,
  );
  assert.ok(action?.type === "play");
  await game.playAction(owner.id, action);
  assert.equal(owner.treasure, null);
  assert.equal(owner.treasureCards.length, 0);
  assert.equal(receiver.treasure, CardType.WoodenOx);
  assert.equal(receiver.treasureCards[0]?.id, "grain");
});

void test("英姿在摸牌阶段多摸一张牌", async () => {
  const { game, runtime } = await setup(3);
  const zhouYu = runtime.players[0]!;
  zhouYu.skills = [SkillName.Heroic];
  runtime.phase = TurnPhase.Start;
  runtime.deck = [makeCard("a", CardType.Slash), makeCard("b", CardType.Dodge), makeCard("c", CardType.Peach)];
  game.setOptionalEffectDecision(zhouYu.id, SkillName.Heroic, true);
  await game.startTurn();
  assert.equal(zhouYu.hand.length, 3);
});

void test("倾国可将黑色手牌或木牛流马下的黑色粮当闪", async () => {
  for (const origin of ["hand", "treasure"] as const) {
    const { game, runtime } = await setup(3);
    const attacker = runtime.players[0]!;
    const zhenJi = runtime.players[1]!;
    attacker.hand = [makeCard(`slash-${origin}`, CardType.Slash, "spade")];
    zhenJi.skills = [SkillName.QingGuo];
    const black = makeCard(`black-${origin}`, CardType.Dismantle, "club");
    if (origin === "hand") zhenJi.hand = [black];
    else {
      zhenJi.treasure = CardType.WoodenOx;
      zhenJi.treasureCards = [black];
    }
    game.setDecisionHandler(zhenJi.id, (request) => {
      if (request.kind !== "respond") return { choice: "pass" };
      const source = request.sources.find((candidate) => candidate.label.includes(SkillName.QingGuo));
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    });
    const hpBefore = zhenJi.hp;
    await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), zhenJi.id);
    assert.equal(zhenJi.hp, hpBefore);
  }
});

void test("反馈由受伤角色选择获得伤害来源的一张手牌或装备牌", async () => {
  const { game, runtime } = await setup(3);
  const source = runtime.players[0]!;
  const siMaYi = runtime.players[1]!;
  siMaYi.skills = [SkillName.FanKui];
  source.weapon = CardType.Crossbow;
  source.equippedCards = { weapon: makeCard("fankui-weapon", CardType.Crossbow, "club", 1) };
  game.setOptionalEffectDecision(siMaYi.id, SkillName.FanKui, true);
  game.setDecisionHandler(siMaYi.id, (request) => request.kind === "choose-card"
    ? { choice: "card", sourceId: "weapon" }
    : { choice: "pass" });
  await runtime.applyDamage(source, siMaYi, 1, "测试", []);
  assert.equal(source.weapon, null);
  assert.ok(siMaYi.hand.some((card) => card.id === "fankui-weapon"));
});

void test("武圣与龙胆生成可用杀，空城禁止空手诸葛亮成为杀或决斗目标", async () => {
  for (const skill of [SkillName.WuSheng, SkillName.LongDan] as const) {
    const { game, runtime } = await setup(3);
    const user = runtime.players[0]!;
    const target = runtime.players[1]!;
    user.skills = [skill];
    user.hand = [skill === SkillName.WuSheng
      ? makeCard("red-card", CardType.Peach, "heart")
      : makeCard("dodge-card", CardType.Dodge, "diamond")];
    const action = game.getPlayableActions(user.id).find(
      (candidate) => candidate.type === "play" && candidate.label.includes(skill),
    );
    assert.ok(action?.type === "play");
    const hpBefore = target.hp;
    await game.playAction(user.id, action, target.id);
    assert.equal(target.hp, hpBefore - 1);
  }

  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const kongCheng = runtime.players[1]!;
  kongCheng.skills = [SkillName.KongCheng];
  kongCheng.hand = [];
  attacker.hand = [makeCard("slash", CardType.Slash), makeCard("duel", CardType.Duel, "spade", 1)];
  for (const type of [CardType.Slash, CardType.Duel]) {
    const action = playActionFor(game, attacker, type);
    assert.equal(action.targets.includes(kongCheng.id), false);
  }
});

void test("集智使用非延时锦囊摸一张，奇袭将黑色牌当过河拆桥", async () => {
  const { game, runtime } = await setup(3);
  const user = runtime.players[0]!;
  const target = runtime.players[1]!;
  user.skills = [SkillName.JiZhi];
  user.hand = [makeCard("dismantle", CardType.Dismantle, "spade", 3)];
  target.hand = [makeCard("target-card", CardType.Dodge)];
  runtime.deck = [makeCard("jizhi-draw", CardType.Peach)];
  game.setOptionalEffectDecision(user.id, SkillName.JiZhi, true);
  await game.playAction(user.id, playActionFor(game, user, CardType.Dismantle), target.id, "hand-random");
  assert.ok(user.hand.some((card) => card.id === "jizhi-draw"));

  user.skills = [SkillName.QiXi];
  user.hand = [makeCard("qixi-cost", CardType.Dodge, "club")];
  target.hand = [makeCard("qixi-target", CardType.Peach)];
  const qiXi = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.label.includes(SkillName.QiXi),
  );
  assert.ok(qiXi?.type === "play");
  await game.playAction(user.id, qiXi, target.id, "hand-random");
  assert.equal(target.hand.length, 0);
});

void test("克己在出牌阶段未使用或打出杀时跳过弃牌阶段", async () => {
  const { game, runtime } = await setup(3);
  const lvMeng = runtime.players[0]!;
  lvMeng.skills = [SkillName.KeJi];
  lvMeng.hp = 2;
  lvMeng.hand = [
    makeCard("k1", CardType.Peach), makeCard("k2", CardType.Dodge), makeCard("k3", CardType.Negate),
  ];
  game.setOptionalEffectDecision(lvMeng.id, SkillName.KeJi, true);
  const end = game.getPlayableActions(lvMeng.id).find((action) => action.type === "end");
  assert.ok(end);
  const logs = await game.playAction(lvMeng.id, end);
  assert.ok(logs.some((line) => line.includes(`${SkillName.KeJi}生效`)));
  assert.equal(lvMeng.hand.length, 3);
});

void test("救援令其他吴势力角色使用的桃额外回复1点", async () => {
  const { game, runtime } = await setup(3);
  const lord = runtime.players[0]!;
  const rescuer = runtime.players[1]!;
  lord.role = PlayerRole.Lord;
  lord.skills = [SkillName.JiuYuan];
  lord.hp = -1;
  rescuer.general = "孙权";
  rescuer.hand = [makeCard("rescue-peach", CardType.Peach)];
  game.setDecisionHandler(rescuer.id, (request) => request.kind === "respond"
    ? { choice: "card", sourceId: "hand:rescue-peach" }
    : { choice: "pass" });
  const logs = await game.resolvePendingDeaths();
  assert.equal(lord.alive, true);
  assert.equal(lord.hp, 1);
  assert.ok(logs.some((line) => line.includes(SkillName.JiuYuan)));
});

void test("苦肉、结姻和青囊分别执行官方体力与弃牌效果", async () => {
  {
    const { game, runtime } = await setup(3);
    const huangGai = runtime.players[0]!;
    huangGai.skills = [SkillName.KuRou];
    runtime.deck = [makeCard("kurou-1", CardType.Slash), makeCard("kurou-2", CardType.Dodge)];
    const action = game.getPlayableActions(huangGai.id).find(
      (candidate) => candidate.type === "skill" && candidate.skill === SkillName.KuRou,
    );
    assert.ok(action?.type === "skill");
    const hpBefore = huangGai.hp;
    await game.playAction(huangGai.id, action);
    assert.equal(huangGai.hp, hpBefore - 1);
    assert.equal(huangGai.hand.length, 2);
  }
  {
    const { game, runtime } = await setup(3);
    const sunShangXiang = runtime.players[0]!;
    const male = runtime.players[1]!;
    sunShangXiang.skills = [SkillName.JieYin];
    sunShangXiang.hp -= 1;
    male.hp -= 1;
    male.gender = "男";
    sunShangXiang.hand = [makeCard("jieyin-1", CardType.Slash), makeCard("jieyin-2", CardType.Dodge)];
    game.setDecisionHandler(sunShangXiang.id, (request) => request.kind === "choose-discard" && request.sources[0]
      ? { choice: "card", sourceId: request.sources[0].sourceId }
      : { choice: "pass" });
    const action = game.getPlayableActions(sunShangXiang.id).find(
      (candidate) => candidate.type === "skill" && candidate.skill === SkillName.JieYin,
    );
    assert.ok(action?.type === "skill");
    await game.playAction(sunShangXiang.id, action, male.id);
    assert.equal(sunShangXiang.hp, sunShangXiang.maxHp);
    assert.equal(male.hp, male.maxHp);
  }
  {
    const { game, runtime } = await setup(3);
    const huaTuo = runtime.players[0]!;
    const wounded = runtime.players[1]!;
    huaTuo.skills = [SkillName.QingNang];
    wounded.hp -= 1;
    huaTuo.hand = [makeCard("qingnang-cost", CardType.Slash)];
    game.setDecisionHandler(huaTuo.id, (request) => request.kind === "choose-discard"
      ? { choice: "card", sourceId: "hand:qingnang-cost" }
      : { choice: "pass" });
    const action = game.getPlayableActions(huaTuo.id).find(
      (candidate) => candidate.type === "skill" && candidate.skill === SkillName.QingNang,
    );
    assert.ok(action?.type === "skill");
    await game.playAction(huaTuo.id, action, wounded.id);
    assert.equal(wounded.hp, wounded.maxHp);
    assert.equal(huaTuo.hand.length, 0);
  }
});

void test("闭月在结束阶段摸一张牌", async () => {
  const { game, runtime } = await setup(3);
  const diaoChan = runtime.players[0]!;
  diaoChan.skills = [SkillName.BiYue];
  runtime.deck = [makeCard("biyue", CardType.Peach)];
  game.setOptionalEffectDecision(diaoChan.id, SkillName.BiYue, true);
  await game.finishTurn(diaoChan);
  assert.equal(diaoChan.hand[0]?.id, "biyue");
});

void test("急救仅在回合外把红色牌当桃救人", async () => {
  const { game, runtime } = await setup(3);
  const current = runtime.players[0]!;
  const huaTuo = runtime.players[1]!;
  const dying = runtime.players[2]!;
  runtime.currentPlayerIndex = runtime.players.indexOf(current);
  huaTuo.skills = [SkillName.JiJiu];
  huaTuo.hand = [makeCard("red-rescue", CardType.Dodge, "diamond")];
  dying.hp = 0;
  game.setDecisionHandler(huaTuo.id, (request) => {
    if (request.kind !== "respond") return { choice: "pass" };
    const source = request.sources.find((candidate) => candidate.label.includes(SkillName.JiJiu));
    return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
  });
  await game.resolvePendingDeaths();
  assert.equal(dying.alive, true);
  assert.equal(dying.hp, 1);
  assert.equal(huaTuo.hand.length, 0);
});

void test("激昂在使用或成为红色杀的目标后分别摸一张牌", async () => {
  const { game, runtime } = await setup(3);
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.skills = [SkillName.JiAng];
  target.skills = [SkillName.JiAng];
  attacker.hand = [makeCard("red-slash", CardType.Slash, "heart")];
  runtime.deck = [makeCard("jiang-a", CardType.Peach), makeCard("jiang-b", CardType.Dodge)];
  game.setOptionalEffectDecision(attacker.id, SkillName.JiAng, true);
  game.setOptionalEffectDecision(target.id, SkillName.JiAng, true);
  await game.playAction(attacker.id, playActionFor(game, attacker, CardType.Slash), target.id);
  assert.ok(attacker.hand.some((card) => card.id === "jiang-a"));
  assert.ok(target.hand.some((card) => card.id === "jiang-b"));
});

void test("魂姿在1体力准备阶段觉醒并获得英姿、英魂；英魂按损失体力值执行分支且不能弃粮", async () => {
  const { game, runtime } = await setup(3);
  const sunCe = runtime.players[0]!;
  const target = runtime.players[1]!;
  sunCe.skills = [SkillName.HunZi];
  sunCe.hp = 1;
  sunCe.maxHp = 4;
  runtime.phase = TurnPhase.Start;
  runtime.deck = [
    makeCard("awakening-draw-1", CardType.Slash), makeCard("awakening-draw-2", CardType.Dodge),
    makeCard("yinghun-1", CardType.Peach), makeCard("yinghun-2", CardType.Negate),
    makeCard("normal-1", CardType.Slash), makeCard("normal-2", CardType.Dodge), makeCard("normal-3", CardType.Peach),
  ];
  await game.startTurn();
  assert.equal(sunCe.maxHp, 3);
  assert.ok(sunCe.skills.includes(SkillName.Heroic));
  assert.ok(sunCe.skills.includes(SkillName.YingHun));

  target.hand = [];
  target.treasure = CardType.WoodenOx;
  target.treasureCards = [makeCard("yinghun-grain", CardType.Slash)];
  runtime.phase = TurnPhase.Start;
  game.setDecisionHandler(sunCe.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "collateral") return { choice: "target", targetId: target.id };
    return { choice: "pass" };
  });
  game.setDecisionHandler(target.id, (request) => {
    if (request.kind !== "choose-discard") return { choice: "pass" };
    assert.equal(request.sources.some((source) => source.sourceId === "treasure:yinghun-grain"), false);
    return request.sources[0]
      ? { choice: "card", sourceId: request.sources[0].sourceId }
      : { choice: "pass" };
  });
  const before = target.hand.length;
  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(SkillName.YingHun)));
  assert.equal(target.hand.length, before + 1, "损失2点体力时“摸2弃1”应净增加1张");
  assert.equal(target.treasureCards[0]?.id, "yinghun-grain");
});
