import { test } from "node:test";
import assert from "node:assert/strict";
import { Card, CardType } from "./cards.js";
import { SanGuoGame } from "./game.js";
import { Player, PlayerRole, TurnPhase } from "./types.js";

const zeroRng = (): number => 0;

const makeCard = (id: string, type: CardType, suit: Card["suit"] = "heart", rank = 7): Card => ({
  id,
  type,
  color: suit === "spade" || suit === "club" ? "black" : "red",
  suit,
  rank,
});

type JudgmentRuntime = {
  players: Player[];
  deck: Card[];
  discardPile: Card[];
  currentPlayerIndex: number;
  phase: TurnPhase;
};

const setupJudgmentGame = async (): Promise<{ game: SanGuoGame; runtime: JudgmentRuntime }> => {
  const game = new SanGuoGame(zeroRng);
  await game.initNetworkGame([
    { id: "p0", name: "甲" },
    { id: "p1", name: "乙" },
    { id: "p2", name: "丙" },
  ], 3, false);
  const runtime = game as unknown as JudgmentRuntime;
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
  }
  runtime.deck = [];
  runtime.discardPile = [];
  runtime.currentPlayerIndex = 0;
  return { game, runtime };
};

// 乐不思蜀测试：直接用已有的测试方式（预置判定区+手动startTurn）
// 跳过复杂的"使用→轮到目标→判定"全流程，用"判定区已有+手动startTurn"简化

void test("乐不思蜀：判定不为红桃时跳过出牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  // 先结束 human 的回合，轮到 ai-1 后再预置乐不思蜀并测试
  // 使用更直接的方式 - 在 ai-1 判定区预置乐不思蜀
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];

  // 判定牌不为红桃（黑桃5）
  runtime.deck.unshift({ id: "judge-spade", type: CardType.Slash, suit: "spade", rank: 5, color: "black" });

  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;

  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("乐不思蜀")), "应有乐不思蜀的判定日志");
  assert.ok(logs.some((l) => l.includes("跳过出牌阶段")), "判定不为红桃应跳过出牌阶段");
});

void test("乐不思蜀：判定为红桃时不跳过出牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];

  // 判定牌为红桃
  runtime.deck.unshift({ id: "judge-heart", type: CardType.Peach, suit: "heart", rank: 7, color: "red" });

  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("乐不思蜀")), "应有乐不思蜀的判定日志");
  assert.ok(logs.some((l) => l.includes("红桃")), "判定为红桃应提示");
  assert.equal(ai1.delayedTricks.length, 0, "判定后乐不思蜀应移除");
  assert.equal(game.getSnapshot().phase, "出牌阶段", "应正常进入出牌阶段");
});

void test("兵粮寸断：判定不为梅花则跳过摸牌阶段", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.SuppliesCut, sourcePlayerId: "human" }];

  // 判定牌不为梅花（红桃）
  runtime.deck.unshift({ id: "judge-heart", type: CardType.Peach, suit: "heart", rank: 7, color: "red" });

  const handBefore = ai1.hand.length;
  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("兵粮寸断")), "应有兵粮寸断的判定日志");
  assert.ok(logs.some((l) => l.includes("跳过摸牌阶段")), "应跳过摸牌阶段");
  assert.equal(ai1.hand.length, handBefore, "手牌不应增加（未摸牌）");
});

void test("兵粮寸断：判定为梅花时正常摸牌", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.SuppliesCut, sourcePlayerId: "human" }];

  // 判定牌为梅花
  runtime.deck.unshift({ id: "judge-club", type: CardType.Slash, suit: "club", rank: 3, color: "black" });

  const handBefore = ai1.hand.length;
  const ai1Idx = runtime.players.findIndex((p) => p.id === "ai-1");
  runtime.currentPlayerIndex = ai1Idx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("兵粮寸断")), "应有兵粮寸断的判定日志");
  assert.ok(logs.some((l) => l.includes("梅花")), "判定为梅花应提示");
  assert.ok(ai1.hand.length > handBefore, "手牌应增加（正常摸牌）");
});

void test("闪电：判定黑桃2-9时受到3点伤害", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const human = runtime.players.find((p) => p.id === "human")!;

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];

  // 判定牌为黑桃5（2-9范围内）
  runtime.deck.unshift({ id: "judge-spade5", type: CardType.Slash, suit: "spade", rank: 5, color: "black" });

  const hpBefore = human.hp;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("闪电")), "应有闪电的判定日志");
  assert.ok(logs.some((l) => l.includes("3 点")), "应受到3点伤害");
  assert.equal(human.hp, hpBefore - 3, "应损失3点体力");
});

void test("闪电：判定非黑桃2-9时移至下家", async () => {
  const game = new SanGuoGame(() => 0.999);
  await game.initDefaultGame({ aiCount: 2 });
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hp: number;
      hand: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; suit: string; rank: number; color: string }>;
    currentPlayerIndex: number;
  };
  const human = runtime.players.find((p) => p.id === "human")!;
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;
  const ai2 = runtime.players.find((p) => p.id === "ai-2")!;
  const humanIdx = runtime.players.findIndex((p) => p.id === "human");

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];

  // 判定牌为红桃3（非黑桃2-9）
  runtime.deck.unshift({ id: "judge-heart3", type: CardType.Peach, suit: "heart", rank: 3, color: "red" });

  runtime.currentPlayerIndex = humanIdx;
  const logs = await game.startTurn();

  assert.ok(logs.some((l) => l.includes("闪电")), "应有闪电的判定日志");
  assert.ok(logs.some((l) => l.includes("未命中")), "判定未命中");
  assert.equal(human.delayedTricks.length, 0, "闪电应从当前玩家移除");
  const hasMoved = ai1.delayedTricks.some((t) => t.cardType === CardType.Lightning) ||
                   ai2.delayedTricks.some((t) => t.cardType === CardType.Lightning);
  assert.ok(hasMoved, "闪电应移至下家");
});

void test("不可对已有乐不思蜀的目标使用乐不思蜀", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }>; delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }> }>;
  };
  const human = runtime.players.find((p) => p.id === "human")!;
  const ai1 = runtime.players.find((p) => p.id === "ai-1")!;

  ai1.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "human" }];
  human.hand = [{ id: "test-indulgence", type: CardType.Indulgence }];

  const actions = game.getPlayableActions("human");
  const indulgenceAction = actions.find((a) => a.type === "play" && a.label.includes(CardType.Indulgence));
  assert.equal(indulgenceAction, undefined, "无可选目标时不应有乐不思蜀可用");
});

void test("已有闪电时不可再使用闪电", async () => {
  const game = new SanGuoGame(zeroRng);
  await game.initDefaultGame({ aiCount: 1 });
  const runtime = game as unknown as {
    players: Array<{ id: string; hand: Array<{ id: string; type: CardType }>; delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }> }>;
  };
  const human = runtime.players.find((p) => p.id === "human")!;

  human.delayedTricks = [{ cardType: CardType.Lightning, sourcePlayerId: "human" }];
  human.hand = [{ id: "test-lightning", type: CardType.Lightning }];

  const actions = game.getPlayableActions("human");
  const lightningAction = actions.find((a) => a.type === "play" && a.label.includes(CardType.Lightning));
  assert.equal(lightningAction, undefined, "已有闪电时不应有闪电可用");
});

void test("同一判定区的延时锦囊按后置先判顺序结算", async () => {
  const { game, runtime } = await setupJudgmentGame();
  const current = runtime.players[0]!;
  current.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: "p2", card: makeCard("order-lightning", CardType.Lightning, "spade", 1) },
    { cardType: CardType.Indulgence, sourcePlayerId: "p2", card: makeCard("order-indulgence", CardType.Indulgence, "heart", 6) },
  ];
  runtime.deck = [
    makeCard("order-judge-indulgence", CardType.Peach, "heart", 2),
    makeCard("order-judge-lightning", CardType.Dodge, "diamond", 3),
    makeCard("order-draw-1", CardType.Slash),
    makeCard("order-draw-2", CardType.Dodge),
  ];

  const logs = await game.startTurn();
  const indulgenceIndex = logs.findIndex((line) => line.includes("乐不思蜀最终判定牌"));
  const lightningIndex = logs.findIndex((line) => line.includes("闪电最终判定牌"));
  assert.ok(indulgenceIndex >= 0 && lightningIndex >= 0);
  assert.ok(indulgenceIndex < lightningIndex, "后放入判定区的乐不思蜀应先于闪电判定");
});

void test("闪电判定未命中时跳过已有闪电的角色转移", async () => {
  const { game, runtime } = await setupJudgmentGame();
  const [current, occupied, destination] = runtime.players;
  assert.ok(current && occupied && destination);
  current.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: destination.id, card: makeCard("miss-lightning", CardType.Lightning, "spade", 1) },
  ];
  occupied.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: current.id, card: makeCard("occupied-lightning", CardType.Lightning, "spade", 1) },
  ];
  runtime.deck = [
    makeCard("miss-judge", CardType.Peach, "heart", 3),
    makeCard("miss-draw-1", CardType.Slash),
    makeCard("miss-draw-2", CardType.Dodge),
  ];

  await game.startTurn();
  assert.equal(occupied.delayedTricks.filter((trick) => trick.cardType === CardType.Lightning).length, 1);
  assert.ok(destination.delayedTricks.some((trick) => trick.card?.id === "miss-lightning"));
});

void test("闪电绕过所有已有闪电的角色后回到原角色判定区", async () => {
  const { game, runtime } = await setupJudgmentGame();
  const [current, second, third] = runtime.players;
  assert.ok(current && second && third);
  current.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: current.id, card: makeCard("return-lightning", CardType.Lightning, "spade", 1) },
  ];
  second.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: second.id, card: makeCard("second-lightning", CardType.Lightning, "spade", 1) },
  ];
  third.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: third.id, card: makeCard("third-lightning", CardType.Lightning, "spade", 1) },
  ];
  runtime.deck = [
    makeCard("return-judge", CardType.Peach, "heart", 3),
    makeCard("return-draw-1", CardType.Slash),
    makeCard("return-draw-2", CardType.Dodge),
  ];

  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes(`闪电移至 ${current.name} 的判定区`)));
  assert.ok(current.delayedTricks.some((trick) => trick.card?.id === "return-lightning"));
  assert.equal(runtime.discardPile.some((card) => card.id === "return-lightning"), false);
});

void test("闪电在判定阶段被无懈可击抵消后仍转移到下一合法角色", async () => {
  const { game, runtime } = await setupJudgmentGame();
  const [current, occupied, destination] = runtime.players;
  assert.ok(current && occupied && destination);
  current.hand = [makeCard("judgment-negate", CardType.Negate, "club", 12)];
  current.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: destination.id, card: makeCard("negated-lightning", CardType.Lightning, "spade", 1) },
  ];
  occupied.delayedTricks = [
    { cardType: CardType.Lightning, sourcePlayerId: current.id, card: makeCard("occupied-lightning-2", CardType.Lightning, "spade", 1) },
  ];
  runtime.deck = [makeCard("negated-draw-1", CardType.Slash), makeCard("negated-draw-2", CardType.Dodge)];
  game.setDecisionHandler(current.id, (request) => {
    if (request.kind !== "respond") return { choice: "pass" };
    const source = request.sources.find((candidate) => candidate.card.type === CardType.Negate);
    return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
  });

  const logs = await game.startTurn();
  assert.ok(logs.some((line) => line.includes("本次失效")));
  assert.equal(occupied.delayedTricks.filter((trick) => trick.cardType === CardType.Lightning).length, 1);
  assert.ok(destination.delayedTricks.some((trick) => trick.card?.id === "negated-lightning"));
});

void test("延迟濒死模式下闪电致死会立即停止后续判定和摸牌", async () => {
  const { game, runtime } = await setupJudgmentGame();
  const [current, lord, enemy] = runtime.players;
  assert.ok(current && lord && enemy);
  current.role = PlayerRole.Loyalist;
  lord.role = PlayerRole.Lord;
  enemy.role = PlayerRole.Rebel;
  current.hp = 1;
  current.delayedTricks = [
    { cardType: CardType.Indulgence, sourcePlayerId: enemy.id, card: makeCard("death-indulgence", CardType.Indulgence) },
    { cardType: CardType.Lightning, sourcePlayerId: enemy.id, card: makeCard("death-lightning", CardType.Lightning, "spade", 1) },
  ];
  runtime.deck = [
    makeCard("death-judge", CardType.Slash, "spade", 5),
    makeCard("must-not-draw-1", CardType.Peach),
    makeCard("must-not-draw-2", CardType.Dodge),
  ];
  game.setDeferDyingResolution(true);

  const logs = await game.startTurn();
  assert.equal(current.alive, false);
  assert.equal(current.hand.length, 0, "死亡玩家不应继续摸牌");
  assert.ok(!logs.some((line) => line.includes("乐不思蜀最终判定牌")), "闪电致死后不应继续判定");
  assert.ok(!logs.some((line) => line.includes(`${current.name} 摸了`)), "闪电致死后不应进入摸牌阶段");
  assert.equal(game.consumePendingNextTurn(), true, "联机分阶段模式应交由服务器开始下一回合");
});
