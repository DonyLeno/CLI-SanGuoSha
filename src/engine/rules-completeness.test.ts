import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Card,
  CardType,
  MANEUVERING_CARD_LIBRARY,
  PROJECT_EXTENSION_CARD_LIBRARY,
  STANDARD_CARD_LIBRARY,
} from "./cards.js";
import { PlayerRole, SanGuoGame, SkillName } from "./game.js";
import { Player } from "./types.js";

const card = (id: string, type: CardType, suit: Card["suit"], rank: number): Card => ({
  id,
  type,
  suit,
  rank,
  color: suit === "heart" || suit === "diamond" ? "red" : suit === "none" ? "colorless" : "black",
});

type RuntimeGame = {
  players: Player[];
  currentPlayerIndex: number;
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

const createRuntime = async (count = 3) => {
  const game = new SanGuoGame(() => 0.25);
  await game.initDefaultGame({ playerCount: count, humanGeneral: "孙策" });
  return { game, runtime: game as unknown as RuntimeGame };
};

void test("精确牌表：标准108张、军争52张、木牛扩展1张，牌面ID唯一", () => {
  assert.equal(STANDARD_CARD_LIBRARY.length, 108);
  assert.equal(MANEUVERING_CARD_LIBRARY.length, 52);
  assert.equal(PROJECT_EXTENSION_CARD_LIBRARY.length, 1);
  const all = [...STANDARD_CARD_LIBRARY, ...MANEUVERING_CARD_LIBRARY, ...PROJECT_EXTENSION_CARD_LIBRARY];
  assert.equal(new Set(all.map((item) => item.id)).size, 161);
  assert.equal(STANDARD_CARD_LIBRARY.some((item) => item.type === CardType.Dodge && item.color === "black"), false);
  assert.ok(MANEUVERING_CARD_LIBRARY.some((item) => item.type === CardType.ThunderSlash && item.suit === "spade"));
});

void test("五人及以上身份局为主公增加1点体力上限和体力", async () => {
  const { game } = await createRuntime(5);
  const lord = game.getSnapshot().players.find((player) => player.role === PlayerRole.Lord);
  assert.ok(lord);
  const baseMaxHp = game.getGeneralLibrary().find((general) => general.name === lord.general)?.maxHp;
  assert.equal(lord.maxHp, (baseMaxHp ?? 0) + 1);
  assert.equal(lord.hp, lord.maxHp);
});

void test("准备阶段技能先于判定阶段结算", async () => {
  const game = new SanGuoGame(() => 0.2);
  await game.initNetworkGame([{ id: "a", name: "甲" }, { id: "b", name: "乙" }], 4, false);
  const runtime = game as unknown as RuntimeGame;
  const current = runtime.players[runtime.currentPlayerIndex];
  assert.ok(current);
  current.skills = [SkillName.GuanXing];
  game.setOptionalEffectDecision(current.id, SkillName.GuanXing, true);
  const logs = await game.startTurn();
  assert.ok(logs.indexOf(`进入准备阶段`) < logs.indexOf(`进入判定阶段`));
  assert.ok(logs.findIndex((line) => line.includes(SkillName.GuanXing)) < logs.indexOf(`进入判定阶段`));
});

void test("本地开局可延后首回合，先注册处理器再让诸葛亮选择观星牌序", async () => {
  const game = new SanGuoGame(() => 0.2);
  await game.initDefaultGame({ humanGeneral: "诸葛亮（标准版）" }, false);
  const requests: string[] = [];
  game.setDecisionHandler("human", (request) => {
    requests.push(request.kind);
    if (request.kind === "optional-effect") return { choice: "effect", enabled: true };
    return { choice: "pass" };
  });
  await game.startTurn();
  assert.ok(requests.includes("optional-effect"));
  assert.ok(requests.includes("choose-card"), "首回合观星应在 UI 处理器注册后请求玩家选牌");
});

void test("装备与国色进入场上后保留原实体牌花色点数", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  const target = runtime.players.find((player) => player.id !== user?.id);
  assert.ok(user && target);
  const weapon = card("physical-weapon", CardType.Crossbow, "diamond", 1);
  user.hand = [weapon];
  const equipAction = game.getPlayableActions(user.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(equipAction && equipAction.type === "play");
  await game.playAction(user.id, equipAction);
  assert.equal(user.equippedCards?.weapon?.id, weapon.id);
  assert.equal(runtime.discardPile.some((item) => item.id === weapon.id), false);

  const converted = card("guose-card", CardType.Slash, "diamond", 8);
  user.skills = [SkillName.GuoSe];
  user.hand = [converted];
  for (const player of runtime.players) game.setPlayerResponsePolicy(player.id, { negate: false });
  const guose = game.getPlayableActions(user.id).find((action) => action.type === "play" && action.label.includes(SkillName.GuoSe));
  assert.ok(guose && guose.type === "play");
  await game.playAction(user.id, guose, target.id);
  assert.equal(target.delayedTricks[0]?.card?.id, converted.id);
  assert.equal(target.delayedTricks[0]?.card?.suit, "diamond");
});

void test("负体力濒死需要连续使用多张桃才能救回", async () => {
  const { game, runtime } = await createRuntime();
  const dying = runtime.players[0];
  assert.ok(dying);
  dying.hp = -1;
  dying.hand = [card("peach-1", CardType.Peach, "heart", 3), card("peach-2", CardType.Peach, "heart", 4)];
  for (const player of runtime.players) game.setPlayerResponsePolicy(player.id, { peach: player.id === dying.id });
  const logs = await game.resolvePendingDeaths();
  assert.equal(dying.alive, true);
  assert.equal(dying.hp, 1);
  assert.equal(dying.hand.length, 0);
  assert.ok(logs.some((line) => line.includes("需要 2 个回复点")));
});

void test("酒令下一张杀伤害+1，雷杀在横置角色之间传导", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  const targets = runtime.players.filter((player) => player.id !== user?.id);
  const first = targets[0];
  const second = targets[1];
  assert.ok(user && first && second);
  user.hand = [card("wine", CardType.Wine, "spade", 3), card("slash", CardType.Slash, "spade", 7)];
  game.setPlayerResponsePolicy(first.id, { dodge: false });
  const wineAction = game.getPlayableActions(user.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(wineAction && wineAction.type === "play");
  await game.playAction(user.id, wineAction, user.id);
  const slashAction = game.getPlayableActions(user.id).find((action) => action.type === "play" && action.cardIndex === 0);
  assert.ok(slashAction && slashAction.type === "play");
  const hpBefore = first.hp;
  await game.playAction(user.id, slashAction, first.id);
  assert.equal(first.hp, hpBefore - 2);

  first.chained = true;
  second.chained = true;
  const firstBeforeChain = first.hp;
  const secondBeforeChain = second.hp;
  await runtime.applyDamage(user, first, 1, CardType.ThunderSlash, [], "thunder");
  assert.equal(first.hp, firstBeforeChain - 1);
  assert.equal(second.hp, secondBeforeChain - 1);
  assert.equal(first.chained, false);
  assert.equal(second.chained, false);
});

void test("火攻按展示牌花色弃牌并造成火焰伤害，铁索可以重铸", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  const target = runtime.players.find((player) => player.id !== user?.id);
  assert.ok(user && target);
  user.hand = [card("fire-attack", CardType.FireAttack, "heart", 2), card("heart-cost", CardType.Peach, "heart", 6)];
  target.hand = [card("reveal", CardType.Dodge, "heart", 8)];
  const hpBefore = target.hp;
  const action = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.cardIndex === 0);
  assert.ok(action && action.type === "play");
  await game.playAction(user.id, action, target.id);
  assert.equal(target.hp, hpBefore - 1);
  assert.equal(user.hand.length, 0);

  user.hand = [card("chain", CardType.IronChain, "club", 10)];
  const recast = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.label.startsWith("重铸"));
  assert.ok(recast && recast.type === "play");
  const before = user.hand.length;
  await game.playAction(user.id, recast);
  assert.equal(user.hand.length, before);
});

void test("五谷丰登按座次请求每名角色自主选择亮出的牌", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  assert.ok(user);
  const targets = [
    ...runtime.players.slice(runtime.currentPlayerIndex),
    ...runtime.players.slice(0, runtime.currentPlayerIndex),
  ];
  for (const player of runtime.players) {
    player.hand = [];
    game.setPlayerResponsePolicy(player.id, { negate: false });
  }
  user.hand = [card("harvest-card", CardType.Harvest, "heart", 3)];
  runtime.deck = [
    card("harvest-a", CardType.Slash, "spade", 7),
    card("harvest-b", CardType.Peach, "heart", 6),
    card("harvest-c", CardType.Negate, "club", 12),
  ];
  const wanted = new Map([
    [targets[0]?.id, "harvest-b"],
    [targets[1]?.id, "harvest-c"],
    [targets[2]?.id, "harvest-a"],
  ]);
  for (const player of targets) {
    game.setDecisionHandler(player.id, (request) => {
      assert.equal(request.kind, "choose-card");
      if (request.kind !== "choose-card") return { choice: "pass" };
      const source = request.sources.find((candidate) => candidate.sourceId === `harvest:${wanted.get(player.id)}`);
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    });
  }
  const action = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.label.includes(CardType.Harvest),
  );
  assert.ok(action && action.type === "play");
  await game.playAction(user.id, action);
  for (const player of targets) {
    assert.ok(player.hand.some((item) => item.id === wanted.get(player.id)), `${player.name} 应获得自己选择的五谷丰登牌`);
  }
});

void test("标准武将库包含甘宁奇袭与吕蒙克己", () => {
  const game = new SanGuoGame(() => 0);
  const generals = game.getGeneralLibrary();
  assert.deepEqual(generals.find((general) => general.name === "甘宁")?.skills, [SkillName.QiXi]);
  assert.deepEqual(generals.find((general) => general.name === "吕蒙")?.skills, [SkillName.KeJi]);
});

void test("过河拆桥公开弃置牌面，顺手牵羊不公开获得的手牌", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  const target = runtime.players.find((player) => player.id !== user?.id);
  assert.ok(user && target);
  for (const player of runtime.players) {
    player.hand = [];
    game.setPlayerResponsePolicy(player.id, { negate: false });
  }
  user.hand = [card("public-dismantle", CardType.Dismantle, "spade", 3)];
  target.hand = [card("public-discard", CardType.Dodge, "heart", 8)];
  const dismantle = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.label.includes(CardType.Dismantle),
  );
  assert.ok(dismantle && dismantle.type === "play");
  const dismantleLogs = await game.playAction(user.id, dismantle, target.id, "hand-random");
  assert.ok(dismantleLogs.some((line) => line.includes("♥8 闪")), "弃牌进入公共弃牌堆后应公开完整牌面");

  user.hand = [card("private-snatch", CardType.Snatch, "spade", 4)];
  target.hand = [card("private-obtained", CardType.Peach, "heart", 6)];
  const snatch = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.label.includes(CardType.Snatch),
  );
  assert.ok(snatch && snatch.type === "play");
  const snatchLogs = await game.playAction(user.id, snatch, target.id, "hand-random");
  assert.ok(snatchLogs.some((line) => line.includes("获得了") && line.includes("1 张手牌")));
  assert.ok(!snatchLogs.some((line) => line.includes("♥6 桃")), "获得到手牌区的牌不应向其他玩家公开");
});

void test("两张无懈可击相互抵消后原锦囊重新生效", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  const target = runtime.players.find((player) => player.id !== user?.id);
  assert.ok(user && target);
  for (const player of runtime.players) player.hand = [];
  user.hand = [card("dismantle", CardType.Dismantle, "spade", 3), card("counter", CardType.Negate, "club", 12)];
  target.hand = [card("target-card", CardType.Slash, "club", 7), card("negate", CardType.Negate, "spade", 11)];
  let counterPromptSeen = false;
  game.setDecisionHandler(user.id, (request) => {
    if (request.kind !== "respond" || request.responseKind !== "negate") return null;
    counterPromptSeen = request.trigger.cardName === CardType.Negate && request.reason.includes("反制");
    return { choice: "card", sourceId: "hand:counter" };
  });
  const action = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.cardIndex === 0);
  assert.ok(action && action.type === "play");
  await game.playAction(user.id, action, target.id);
  assert.equal(user.hand.some((item) => item.id === "counter"), false);
  assert.equal(target.hand.some((item) => item.id === "negate"), false);
  assert.equal(target.hand.length, 0);
  assert.equal(counterPromptSeen, true, "第二张无懈应明确提示正在反制另一张无懈");
});

void test("兵粮寸断使用者不会被询问是否用无懈抵消自己的锦囊", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  assert.ok(user);
  for (const player of runtime.players) player.hand = [];
  user.hand = [
    card("supplies", CardType.SuppliesCut, "club", 4),
    card("supplies-negate", CardType.Negate, "club", 12),
  ];
  let sourcePromptCount = 0;
  game.setDecisionHandler(user.id, (request) => {
    if (request.kind === "respond" && request.responseKind === "negate") {
      sourcePromptCount += 1;
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.cardIndex === 0,
  );
  assert.ok(action && action.type === "play");
  const targetId = action.targets[0];
  assert.ok(targetId);
  await game.playAction(user.id, action, targetId);
  const target = runtime.players.find((player) => player.id === targetId);
  assert.ok(target);
  assert.equal(sourcePromptCount, 0);
  assert.ok(user.hand.some((item) => item.id === "supplies-negate"));
  assert.ok(target.delayedTricks.some((trick) => trick.cardType === CardType.SuppliesCut));
});

void test("南蛮入侵使用者不会被询问是否用无懈抵消自己的锦囊", async () => {
  const { game, runtime } = await createRuntime();
  const user = runtime.players[runtime.currentPlayerIndex];
  assert.ok(user);
  for (const player of runtime.players) player.hand = [];
  user.hand = [
    card("barbarian", CardType.Barbarian, "spade", 7),
    card("barbarian-negate", CardType.Negate, "club", 12),
  ];
  const reasons: string[] = [];
  game.setDecisionHandler(user.id, (request) => {
    if (request.kind === "respond" && request.responseKind === "negate") {
      reasons.push(request.reason);
    }
    return { choice: "pass" };
  });
  const action = game.getPlayableActions(user.id).find(
    (candidate) => candidate.type === "play" && candidate.label.includes(CardType.Barbarian),
  );
  assert.ok(action && action.type === "play");
  await game.playAction(user.id, action);
  assert.deepEqual(reasons, []);
  assert.ok(user.hand.some((item) => item.id === "barbarian-negate"));
});

void test("顺手牵羊受距离1限制，奇才可忽略兵粮寸断距离", async () => {
  const { game, runtime } = await createRuntime(4);
  const user = runtime.players[runtime.currentPlayerIndex];
  assert.ok(user);
  const opposite = runtime.players[(runtime.currentPlayerIndex + 2) % runtime.players.length];
  assert.ok(opposite);
  opposite.hand = [card("remote", CardType.Slash, "club", 8)];
  user.hand = [card("snatch", CardType.Snatch, "spade", 3), card("supply", CardType.SuppliesCut, "club", 4)];
  const snatch = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.cardIndex === 0);
  assert.ok(snatch && snatch.type === "play");
  assert.equal(snatch.targets.includes(opposite.id), false);
  const supply = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.cardIndex === 1);
  assert.ok(supply && supply.type === "play");
  assert.equal(supply.targets.includes(opposite.id), false);
  user.skills.push(SkillName.QiCai);
  const qicaiSupply = game.getPlayableActions(user.id).find((item) => item.type === "play" && item.cardIndex === 1);
  assert.ok(qicaiSupply && qicaiSupply.type === "play" && qicaiSupply.targets.includes(opposite.id));
});

void test("击杀反贼摸三张，死亡时手牌装备和判定区全部进入弃牌堆", async () => {
  const { game, runtime } = await createRuntime();
  const killer = runtime.players[0];
  const victim = runtime.players[1];
  assert.ok(killer && victim);
  victim.role = "反贼" as Player["role"];
  killer.hand = [];
  victim.hand = [card("dead-hand", CardType.Dodge, "heart", 2)];
  victim.weapon = CardType.Crossbow;
  victim.equippedCards = { weapon: card("dead-weapon", CardType.Crossbow, "club", 1) };
  victim.delayedTricks = [{
    cardType: CardType.Indulgence,
    sourcePlayerId: killer.id,
    card: card("dead-delayed", CardType.Indulgence, "heart", 6),
  }];
  victim.hp = 1;
  for (const player of runtime.players) game.setPlayerResponsePolicy(player.id, { peach: false });
  await runtime.applyDamage(killer, victim, 1, CardType.Slash, []);
  await game.resolvePendingDeaths();
  assert.equal(victim.alive, false);
  assert.equal(killer.hand.length, 3);
  for (const id of ["dead-hand", "dead-weapon", "dead-delayed"]) {
    assert.ok(runtime.discardPile.some((item) => item.id === id));
  }
});
