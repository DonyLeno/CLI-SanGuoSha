import { test } from "node:test";
import assert from "node:assert/strict";
import { CardType } from "./cards.js";
import { SanGuoGame } from "./game.js";
const fixedRng = () => 0;
void test("初始化后主公先手且进入出牌阶段", () => {
    const game = new SanGuoGame(fixedRng);
    game.initDefaultGame();
    const snapshot = game.getSnapshot();
    assert.equal(snapshot.currentPlayerId, "human");
    assert.equal(snapshot.phase, "出牌阶段");
    assert.equal(snapshot.players.length, 3);
});
void test("使用杀会造成伤害或被闪抵消", () => {
    const game = new SanGuoGame(fixedRng);
    game.initDefaultGame();
    const before = game.getSnapshot();
    const human = before.players.find((item) => item.id === "human");
    const slashIndex = human?.hand.findIndex((card) => card.type === CardType.Slash) ?? -1;
    assert.ok(slashIndex >= 0);
    const actions = game.getPlayableActions("human");
    const slashAction = actions.find((action) => action.type === "play" && action.cardIndex === slashIndex);
    assert.ok(slashAction && slashAction.type === "play");
    game.playAction("human", slashAction, "ai-1");
    const after = game.getSnapshot();
    const target = after.players.find((item) => item.id === "ai-1");
    assert.ok(target);
    assert.ok(target.hp <= 4);
});
void test("结束出牌阶段会切换到下一个玩家", () => {
    const game = new SanGuoGame(fixedRng);
    game.initDefaultGame();
    const endAction = game.getPlayableActions("human").find((action) => action.type === "end");
    assert.ok(endAction);
    game.playAction("human", endAction);
    const snapshot = game.getSnapshot();
    assert.equal(snapshot.currentPlayerId, "ai-1");
    assert.equal(snapshot.phase, "出牌阶段");
});
