import assert from "node:assert/strict";
import test from "node:test";
import { Card, CardType } from "./cards.js";
import { GENERAL_LIBRARY } from "./generals.js";
import { SanGuoGame } from "./game.js";
import { Player, PlayerRole, SkillName, TurnPhase } from "./types.js";

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

type Runtime = {
  currentPlayerIndex: number;
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  phase: TurnPhase;
  applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    nature?: "normal" | "fire" | "thunder",
    ignoreArmor?: boolean,
    damageCards?: Card[],
  ): Promise<void>;
};

const setupGame = async (count = 3): Promise<{ game: SanGuoGame; runtime: Runtime }> => {
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
    player.faceDown = false;
    player.chained = false;
  }
  runtime.deck = [];
  runtime.discardPile = [];
  return { game, runtime };
};

const enterPlay = (runtime: Runtime, player: Player): void => {
  runtime.currentPlayerIndex = runtime.players.indexOf(player);
  runtime.phase = TurnPhase.Play;
};

void test("每个技能枚举都可由武将直接携带或在对局中获得", () => {
  const reachable = new Set(GENERAL_LIBRARY.flatMap((general) => general.skills));
  if (reachable.has(SkillName.HunZi)) {
    reachable.add(SkillName.Heroic);
    reachable.add(SkillName.YingHun);
  }
  for (const skill of Object.values(SkillName)) {
    assert.ok(reachable.has(skill), `${skill} 不应是不可达的孤立技能`);
  }
  assert.ok(GENERAL_LIBRARY.some((general) => general.name === "典韦" && general.skills.includes(SkillName.Assault)));
});

void test("制衡可精确选择部分手牌和装备牌，不再强制弃置全部手牌", async () => {
  const { game, runtime } = await setupGame();
  const player = runtime.players[0]!;
  player.skills = [SkillName.ZhiHeng];
  player.hand = [
    makeCard("zh-1", CardType.Slash, "spade"),
    makeCard("zh-2", CardType.Dodge, "heart"),
    makeCard("zh-3", CardType.Peach, "diamond"),
  ];
  const weapon = makeCard("zh-weapon", CardType.Crossbow, "club", 1);
  player.weapon = CardType.Crossbow;
  player.equippedCards = { weapon };
  runtime.deck = [makeCard("draw-1", CardType.Slash), makeCard("draw-2", CardType.Dodge)];
  enterPlay(runtime, player);

  let step = 0;
  game.setDecisionHandler(player.id, (request) => {
    if (request.kind !== "choose-discard") return { choice: "pass" };
    step += 1;
    if (step === 1) return { choice: "card", sourceId: "hand:zh-1" };
    if (step === 2) {
      const source = request.sources.find((candidate) => candidate.origin === "weapon");
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  const action = game.getPlayableActions(player.id).find((candidate) => candidate.type === "skill" && candidate.skill === SkillName.ZhiHeng);
  assert.ok(action);
  await game.playAction(player.id, action);
  assert.equal(player.weapon, null);
  assert.ok(player.hand.some((card) => card.id === "zh-2"));
  assert.ok(player.hand.some((card) => card.id === "zh-3"));
  assert.equal(player.hand.length, 4);
  assert.ok(runtime.discardPile.some((card) => card.id === weapon.id));
});

void test("反间只暴露匿名选项，来源ID不会泄露真实手牌ID", async () => {
  const { game, runtime } = await setupGame();
  const zhouYu = runtime.players[0]!;
  const target = runtime.players[1]!;
  zhouYu.skills = [SkillName.FanJian];
  zhouYu.hand = [makeCard("secret-a", CardType.Slash, "heart"), makeCard("secret-b", CardType.Dodge, "spade")];
  enterPlay(runtime, zhouYu);

  game.setDecisionHandler(target.id, (request) => {
    if (request.kind === "choose-suit") return { choice: "suit", suit: "spade" };
    if (request.kind === "choose-card") {
      assert.ok(request.sources.every((source) => source.sourceId.startsWith("fanjian:")));
      assert.ok(request.sources.every((source) => !source.sourceId.includes("secret-")));
      const source = request.sources[1];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  const action = game.getPlayableActions(zhouYu.id).find((candidate) => candidate.type === "skill" && candidate.skill === SkillName.FanJian);
  assert.ok(action);
  await game.playAction(zhouYu.id, action, target.id);
  assert.ok(target.hand.some((card) => card.id === "secret-b"));
  assert.equal(target.hp, target.maxHp);
});

void test("枭姬在装备被其他角色获得时也会触发摸两张牌", async () => {
  const { game, runtime } = await setupGame();
  const user = runtime.players[0]!;
  const sunShangXiang = runtime.players[1]!;
  user.hand = [makeCard("snatch", CardType.Snatch, "spade", 3)];
  sunShangXiang.skills = [SkillName.XiaoJi];
  const weapon = makeCard("xiaoji-weapon", CardType.Crossbow, "club", 1);
  sunShangXiang.weapon = CardType.Crossbow;
  sunShangXiang.equippedCards = { weapon };
  runtime.deck = [makeCard("xj-draw-1", CardType.Slash), makeCard("xj-draw-2", CardType.Dodge)];
  enterPlay(runtime, user);
  game.setOptionalEffectDecision(sunShangXiang.id, SkillName.XiaoJi, true);

  const action = game.getPlayableActions(user.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Snatch));
  assert.ok(action);
  await game.playAction(user.id, action, sunShangXiang.id, "weapon");
  assert.equal(sunShangXiang.weapon, null);
  assert.equal(sunShangXiang.hand.length, 2);
  assert.ok(user.hand.some((card) => card.id === weapon.id));
});

void test("奸雄可在无伤害来源时获得实际造成伤害的牌", async () => {
  const { game, runtime } = await setupGame();
  const caoCao = runtime.players[0]!;
  caoCao.skills = [SkillName.JianXiong];
  const lightning = makeCard("lightning-damage", CardType.Lightning, "spade", 5);
  runtime.discardPile.push(lightning);
  game.setOptionalEffectDecision(caoCao.id, SkillName.JianXiong, true);
  const logs: string[] = [];
  await runtime.applyDamage(null, caoCao, 1, CardType.Lightning, logs, "thunder", false, [lightning]);
  assert.ok(caoCao.hand.some((card) => card.id === lightning.id));
  assert.ok(logs.some((line) => line.includes(SkillName.JianXiong)));
});

void test("主动激将会消耗蜀势力角色提供的杀并以该实体牌结算", async () => {
  const { game, runtime } = await setupGame();
  const lord = runtime.players[0]!;
  const ally = runtime.players[1]!;
  const target = runtime.players[2]!;
  lord.role = PlayerRole.Lord;
  lord.skills = [SkillName.JiJiang];
  ally.general = "关羽";
  const slash = makeCard("jijiang-slash", CardType.Slash, "heart", 9);
  ally.hand = [slash];
  enterPlay(runtime, lord);
  game.setDecisionHandler(ally.id, (request) => {
    if (request.kind === "respond") {
      const source = request.sources[0];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  const hpBefore = target.hp;
  const action = game.getPlayableActions(lord.id).find((candidate) => candidate.type === "skill" && candidate.skill === SkillName.JiJiang);
  assert.ok(action);
  await game.playAction(lord.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(ally.hand.length, 0);
  assert.ok(runtime.discardPile.some((card) => card.id === slash.id));
});

void test("离间由玩家选择第二名男性，且生成的决斗不能被无懈可击", async () => {
  const { game, runtime } = await setupGame();
  const diaoChan = runtime.players[0]!;
  const first = runtime.players[1]!;
  const second = runtime.players[2]!;
  diaoChan.gender = "女";
  diaoChan.skills = [SkillName.LiJian];
  diaoChan.hand = [makeCard("lijian-cost", CardType.Dodge, "heart")];
  first.gender = "男";
  second.gender = "男";
  const negate = makeCard("lijian-negate", CardType.Negate, "spade", 11);
  first.hand = [negate];
  enterPlay(runtime, diaoChan);
  game.setDecisionHandler(diaoChan.id, (request) => request.kind === "collateral"
    ? { choice: "target", targetId: second.id }
    : request.kind === "choose-discard" && request.sources[0]
      ? { choice: "card", sourceId: request.sources[0].sourceId }
      : { choice: "pass" });

  const hpBefore = first.hp;
  const action = game.getPlayableActions(diaoChan.id).find((candidate) => candidate.type === "skill" && candidate.skill === SkillName.LiJian);
  assert.ok(action);
  await game.playAction(diaoChan.id, action, first.id);
  assert.equal(first.hp, hpBefore - 1);
  assert.ok(first.hand.some((card) => card.id === negate.id), "离间决斗不应询问或消耗无懈可击");
});

void test("铁骑判定先于八卦阵，红色结果会直接禁止闪避", async () => {
  const { game, runtime } = await setupGame();
  const maChao = runtime.players[0]!;
  const target = runtime.players[1]!;
  maChao.skills = [SkillName.TieQi];
  maChao.hand = [makeCard("tieqi-slash", CardType.Slash, "spade", 7)];
  target.armor = CardType.EightDiagram;
  target.equippedCards = { armor: makeCard("eight-diagram", CardType.EightDiagram, "spade", 2) };
  runtime.deck = [
    makeCard("tieqi-red", CardType.Peach, "heart", 3),
    makeCard("armor-red", CardType.Dodge, "diamond", 4),
  ];
  enterPlay(runtime, maChao);
  game.setOptionalEffectDecision(maChao.id, SkillName.TieQi, true);

  const hpBefore = target.hp;
  const action = game.getPlayableActions(maChao.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Slash));
  assert.ok(action);
  const logs = await game.playAction(maChao.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(runtime.deck[0]?.id, "armor-red", "铁骑成功后不应再进行八卦阵判定");
  assert.ok(logs.some((line) => line.includes("不可被闪避")));
});

void test("八卦阵可以选择响应万箭齐发所需的闪", async () => {
  const { game, runtime } = await setupGame();
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.hand = [makeCard("arrow-rain", CardType.ArrowRain, "heart", 1)];
  target.armor = CardType.EightDiagram;
  target.equippedCards = { armor: makeCard("arrow-eight-diagram", CardType.EightDiagram, "spade", 2) };
  runtime.deck = [makeCard("arrow-red-judge", CardType.Dodge, "diamond", 4)];
  enterPlay(runtime, attacker);
  game.setOptionalEffectDecision(target.id, CardType.EightDiagram, true);

  const hpBefore = target.hp;
  const action = game.getPlayableActions(attacker.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.ArrowRain));
  assert.ok(action);
  const logs = await game.playAction(attacker.id, action);
  assert.equal(target.hp, hpBefore);
  assert.ok(logs.some((line) => line.includes("八卦阵判定为红色")));
});

void test("无双要求的两张闪会分别进行八卦阵判定", async () => {
  const { game, runtime } = await setupGame();
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.skills = [SkillName.WuShuang];
  attacker.hand = [makeCard("wushuang-slash", CardType.Slash, "heart", 10)];
  target.armor = CardType.EightDiagram;
  target.equippedCards = { armor: makeCard("wushuang-eight-diagram", CardType.EightDiagram, "spade", 2) };
  runtime.deck = [
    makeCard("wushuang-red-judge", CardType.Dodge, "heart", 4),
    makeCard("wushuang-black-judge", CardType.Slash, "club", 5),
  ];
  enterPlay(runtime, attacker);
  game.setDecisionHandler(target.id, (request) => request.kind === "optional-effect"
    ? { choice: "effect", enabled: true }
    : { choice: "pass" });

  const hpBefore = target.hp;
  const action = game.getPlayableActions(attacker.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Slash));
  assert.ok(action);
  const logs = await game.playAction(attacker.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1, "一次八卦阵成功只提供一张闪，不能抵消无双");
  assert.equal(logs.filter((line) => line.includes("八卦阵最终判定牌")).length, 2);
});

void test("拒绝发动八卦阵后仍可改用手牌闪", async () => {
  const { game, runtime } = await setupGame();
  const attacker = runtime.players[0]!;
  const target = runtime.players[1]!;
  attacker.hand = [makeCard("decline-armor-slash", CardType.Slash, "spade", 7)];
  target.armor = CardType.EightDiagram;
  target.equippedCards = { armor: makeCard("decline-eight-diagram", CardType.EightDiagram, "spade", 2) };
  target.hand = [makeCard("manual-dodge", CardType.Dodge, "heart", 8)];
  runtime.deck = [makeCard("unused-judge", CardType.Slash, "heart", 3)];
  enterPlay(runtime, attacker);
  game.setOptionalEffectDecision(target.id, CardType.EightDiagram, false);
  game.setDecisionHandler(target.id, (request) => {
    if (request.kind !== "respond") return { choice: "pass" };
    const source = request.sources.find((candidate) => candidate.card.type === CardType.Dodge);
    return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
  });

  const hpBefore = target.hp;
  const action = game.getPlayableActions(attacker.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Slash));
  assert.ok(action);
  const logs = await game.playAction(attacker.id, action, target.id);
  assert.equal(target.hp, hpBefore);
  assert.equal(target.hand.length, 0);
  assert.equal(runtime.deck[0]?.id, "unused-judge", "拒绝发动八卦阵时不应消耗判定牌");
  assert.ok(!logs.some((line) => line.includes("八卦阵最终判定牌")));
});

void test("护驾响应者可以发动自己的八卦阵提供闪", async () => {
  const { game, runtime } = await setupGame();
  const attacker = runtime.players[0]!;
  const lord = runtime.players[1]!;
  const responder = runtime.players[2]!;
  attacker.hand = [makeCard("hujia-slash", CardType.Slash, "spade", 7)];
  lord.role = PlayerRole.Lord;
  lord.skills = [SkillName.HuJia];
  responder.general = "夏侯惇";
  responder.armor = CardType.EightDiagram;
  responder.equippedCards = { armor: makeCard("hujia-eight-diagram", CardType.EightDiagram, "spade", 2) };
  runtime.deck = [makeCard("hujia-red-judge", CardType.Dodge, "heart", 9)];
  enterPlay(runtime, attacker);
  game.setOptionalEffectDecision(responder.id, CardType.EightDiagram, true);

  const hpBefore = lord.hp;
  const action = game.getPlayableActions(attacker.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Slash));
  assert.ok(action);
  const logs = await game.playAction(attacker.id, action, lord.id);
  assert.equal(lord.hp, hpBefore);
  assert.ok(logs.some((line) => line.includes(`${SkillName.HuJia}生效`)));
  assert.ok(logs.some((line) => line.includes("八卦阵判定为红色")));
});

void test("据守翻面摸四张后弃一张手牌", async () => {
  const { game, runtime } = await setupGame();
  const caoRen = runtime.players[0]!;
  caoRen.skills = [SkillName.JuShou];
  caoRen.hand = [makeCard("jushou-hand", CardType.Slash, "spade")];
  runtime.deck = [
    makeCard("jr-1", CardType.Dodge),
    makeCard("jr-2", CardType.Peach),
    makeCard("jr-3", CardType.Slash),
    makeCard("jr-4", CardType.Negate),
  ];
  enterPlay(runtime, caoRen);
  game.setOptionalEffectDecision(caoRen.id, SkillName.JuShou, true);
  game.setDecisionHandler(caoRen.id, (request) => {
    if (request.kind === "choose-discard") {
      const source = request.sources.find((candidate) => candidate.sourceId === "hand:jushou-hand") ?? request.sources[0];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  await game.finishTurn(caoRen);
  assert.equal(caoRen.faceDown, true);
  assert.equal(caoRen.hand.length, 4);
  assert.ok(runtime.discardPile.some((card) => card.id === "jushou-hand"));
});

void test("突袭目标由张辽选择，可只获得指定角色的一张手牌", async () => {
  const { game, runtime } = await setupGame();
  const zhangLiao = runtime.players[0]!;
  const ignored = runtime.players[1]!;
  const chosen = runtime.players[2]!;
  zhangLiao.skills = [SkillName.TuXi];
  ignored.hand = [makeCard("ignored-card", CardType.Peach)];
  chosen.hand = [makeCard("chosen-card", CardType.Dodge, "spade")];
  runtime.currentPlayerIndex = runtime.players.indexOf(zhangLiao);
  game.setOptionalEffectDecision(zhangLiao.id, SkillName.TuXi, true);
  let selectionCount = 0;
  game.setDecisionHandler(zhangLiao.id, (request) => {
    if (request.kind === "collateral") {
      selectionCount += 1;
      return selectionCount === 1 ? { choice: "target", targetId: chosen.id } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  await game.startTurn();
  assert.ok(zhangLiao.hand.some((card) => card.id === "chosen-card"));
  assert.ok(ignored.hand.some((card) => card.id === "ignored-card"));
  assert.equal(zhangLiao.hand.length, 1);
});

void test("遗计按每点伤害各观看两张牌，并可逐张分配", async () => {
  const { game, runtime } = await setupGame();
  const guoJia = runtime.players[0]!;
  const receiver = runtime.players[1]!;
  const source = runtime.players[2]!;
  guoJia.skills = [SkillName.YiJi];
  runtime.deck = [
    makeCard("yiji-1", CardType.Slash),
    makeCard("yiji-2", CardType.Dodge),
    makeCard("yiji-3", CardType.Peach),
    makeCard("yiji-4", CardType.Negate),
  ];
  game.setOptionalEffectDecision(guoJia.id, SkillName.YiJi, true);
  game.setDecisionHandler(guoJia.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "collateral") return { choice: "target", targetId: receiver.id };
    if (request.kind === "choose-card") {
      const card = request.sources[0];
      return card ? { choice: "card", sourceId: card.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  await runtime.applyDamage(source, guoJia, 2, "测试伤害", []);
  assert.deepEqual(receiver.hand.map((card) => card.id), ["yiji-1", "yiji-2", "yiji-3", "yiji-4"]);
});

void test("刚烈由伤害来源精确弃置两张手牌，不会误弃装备区", async () => {
  const { game, runtime } = await setupGame();
  const xiahouDun = runtime.players[0]!;
  const source = runtime.players[1]!;
  xiahouDun.skills = [SkillName.GangLie];
  source.hand = [makeCard("ganglie-1", CardType.Slash), makeCard("ganglie-2", CardType.Dodge)];
  const weapon = makeCard("ganglie-weapon", CardType.Crossbow, "club", 1);
  source.weapon = CardType.Crossbow;
  source.equippedCards = { weapon };
  runtime.deck = [makeCard("ganglie-judge", CardType.Slash, "spade", 8)];
  game.setOptionalEffectDecision(xiahouDun.id, SkillName.GangLie, true);
  game.setDecisionHandler(source.id, (request) => {
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    if (request.kind === "choose-discard") {
      const card = request.sources[0];
      return card ? { choice: "card", sourceId: card.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  const hpBefore = source.hp;
  await runtime.applyDamage(source, xiahouDun, 1, "测试伤害", []);
  assert.equal(source.hand.length, 0);
  assert.equal(source.weapon, CardType.Crossbow);
  assert.equal(source.hp, hpBefore);
});

void test("觉醒后的制霸允许主公拒绝拼点，并可在对方未赢时获得双方拼点牌", async () => {
  const { game, runtime } = await setupGame();
  const challenger = runtime.players[0]!;
  const lord = runtime.players[1]!;
  challenger.general = "孙权";
  challenger.hand = [makeCard("zhiba-low", CardType.Slash, "heart", 5)];
  lord.role = PlayerRole.Lord;
  lord.skills = [SkillName.ZhiBa, SkillName.YingHun];
  lord.hand = [makeCard("zhiba-high", CardType.Dodge, "spade", 10)];
  enterPlay(runtime, challenger);
  game.setDecisionHandler(challenger.id, (request) => {
    if (request.kind === "choose-card" && request.sources[0]) {
      return { choice: "card", sourceId: request.sources[0].sourceId };
    }
    return { choice: "pass" };
  });
  game.setDecisionHandler(lord.id, (request) => {
    if (request.kind === "choose-card" && request.sources[0]) {
      return { choice: "card", sourceId: request.sources[0].sourceId };
    }
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: !request.reason.includes("拒绝") };
    }
    return { choice: "pass" };
  });

  const action = game.getPlayableActions(challenger.id).find((candidate) => candidate.type === "skill" && candidate.skill === SkillName.ZhiBa);
  assert.ok(action);
  await game.playAction(challenger.id, action, lord.id);
  assert.equal(challenger.hand.length, 0);
  assert.deepEqual(new Set(lord.hand.map((card) => card.id)), new Set(["zhiba-low", "zhiba-high"]));
});

void test("解围可将装备区牌当无懈可击打出并触发装备离场", async () => {
  const { game, runtime } = await setupGame();
  const user = runtime.players[0]!;
  const caoRen = runtime.players[1]!;
  user.hand = [makeCard("jiewei-duel", CardType.Duel, "diamond", 1)];
  caoRen.skills = [SkillName.JieWei];
  const weapon = makeCard("jiewei-weapon", CardType.Crossbow, "club", 1);
  caoRen.weapon = CardType.Crossbow;
  caoRen.equippedCards = { weapon };
  enterPlay(runtime, user);
  game.setDecisionHandler(caoRen.id, (request) => {
    if (request.kind === "respond") {
      const source = request.sources.find((candidate) => candidate.label.includes(SkillName.JieWei));
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  const hpBefore = caoRen.hp;
  const action = game.getPlayableActions(user.id).find((candidate) => candidate.type === "play" && candidate.label.includes(CardType.Duel));
  assert.ok(action);
  await game.playAction(user.id, action, caoRen.id);
  assert.equal(caoRen.hp, hpBefore);
  assert.equal(caoRen.weapon, null);
  assert.ok(runtime.discardPile.some((card) => card.id === weapon.id));
});

void test("解围在翻至正面后可弃手牌并移动场上的装备牌", async () => {
  const { game, runtime } = await setupGame();
  const caoRen = runtime.players[0]!;
  const holder = runtime.players[1]!;
  const destination = runtime.players[2]!;
  caoRen.skills = [SkillName.JieWei];
  caoRen.faceDown = true;
  caoRen.hand = [makeCard("jiewei-cost", CardType.Slash, "heart")];
  const weapon = makeCard("jiewei-move", CardType.Crossbow, "club", 1);
  holder.weapon = CardType.Crossbow;
  holder.equippedCards = { weapon };
  runtime.currentPlayerIndex = runtime.players.indexOf(caoRen);
  game.setOptionalEffectDecision(caoRen.id, SkillName.JieWei, true);
  game.setDecisionHandler(caoRen.id, (request) => {
    if (request.kind === "collateral") {
      return request.reason.includes("原区域")
        ? { choice: "target", targetId: holder.id }
        : { choice: "target", targetId: destination.id };
    }
    if (request.kind === "choose-discard" || request.kind === "choose-card") {
      const source = request.sources[0];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    return { choice: "pass" };
  });

  await game.startTurn();
  assert.equal(caoRen.faceDown, false);
  assert.equal(caoRen.hand.length, 0);
  assert.equal(holder.weapon, null);
  assert.equal(destination.weapon, CardType.Crossbow);
  assert.equal(destination.equippedCards?.weapon?.id, weapon.id);
});

void test("洛神每次黑色判定后可继续，直到红色判定停止", async () => {
  const { game, runtime } = await setupGame();
  const zhenJi = runtime.players[0]!;
  zhenJi.skills = [SkillName.LuoShen];
  runtime.deck = [
    makeCard("luoshen-black-1", CardType.Slash, "spade", 2),
    makeCard("luoshen-black-2", CardType.Dodge, "club", 3),
    makeCard("luoshen-red", CardType.Peach, "heart", 4),
    makeCard("luoshen-draw-1", CardType.Slash, "heart", 5),
    makeCard("luoshen-draw-2", CardType.Dodge, "diamond", 6),
  ];
  runtime.currentPlayerIndex = runtime.players.indexOf(zhenJi);
  game.setOptionalEffectDecision(zhenJi.id, SkillName.LuoShen, true);
  game.setDecisionHandler(zhenJi.id, (request) => request.kind === "optional-effect"
    ? { choice: "effect", enabled: true }
    : { choice: "pass" });

  const logs = await game.startTurn();
  assert.ok(zhenJi.hand.some((card) => card.id === "luoshen-black-1"));
  assert.ok(zhenJi.hand.some((card) => card.id === "luoshen-black-2"));
  assert.ok(runtime.discardPile.some((card) => card.id === "luoshen-red"));
  assert.ok(logs.some((line) => line.includes("停止判定")));
});

void test("国色可使用木牛流马下的方片牌，实体牌进入目标判定区", async () => {
  const { game, runtime } = await setupGame();
  const daQiao = runtime.players[0]!;
  const target = runtime.players[1]!;
  daQiao.skills = [SkillName.GuoSe];
  daQiao.treasure = CardType.WoodenOx;
  daQiao.equippedCards = { treasure: makeCard("wooden-ox", CardType.WoodenOx, "diamond", 5) };
  const converted = makeCard("ox-diamond", CardType.Slash, "diamond", 8);
  daQiao.treasureCards = [converted];
  enterPlay(runtime, daQiao);

  const action = game.getPlayableActions(daQiao.id).find(
    (candidate) => candidate.type === "play" && candidate.conversionSkill === SkillName.GuoSe && candidate.sourceId === `treasure:${converted.id}`,
  );
  assert.ok(action);
  await game.playAction(daQiao.id, action, target.id);
  assert.equal(daQiao.treasure, CardType.WoodenOx);
  assert.equal(daQiao.treasureCards.length, 0);
  assert.equal(target.delayedTricks[0]?.card?.id, converted.id);
});
