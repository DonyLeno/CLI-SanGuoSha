import assert from "node:assert/strict";
import { test } from "node:test";
import { GameSnapshot, PlayerRole, TurnPhase } from "../engine/game.js";
import { createClientSnapshot } from "./protocol.js";

const snapshot = (): GameSnapshot => ({
  turn: 1,
  currentPlayerId: "lord",
  phase: TurnPhase.Play,
  players: [
    {
      id: "lord", name: "主公玩家", role: PlayerRole.Lord, gender: "男", general: "曹操", skills: [], isAI: false,
      hp: 4, maxHp: 4, hand: [], weapon: null, armor: null, defenseHorse: null, attackHorse: null,
      treasure: null, treasureCards: [], delayedTricks: [], alive: true, faceDown: false,
    },
    {
      id: "rebel", name: "反贼玩家", role: PlayerRole.Rebel, gender: "男", general: "吕蒙", skills: [], isAI: true,
      hp: 4, maxHp: 4, hand: [], weapon: null, armor: null, defenseHorse: null, attackHorse: null,
      treasure: null, treasureCards: [], delayedTricks: [], alive: true, faceDown: false,
    },
  ],
  winner: null,
  gameOver: false,
  slashUsed: false,
  deckCount: 100,
  discardCount: 0,
});

void test("对局中继续隐藏他人身份，游戏结束后向所有客户端公开身份", () => {
  const ongoing = snapshot();
  assert.equal(createClientSnapshot(ongoing, "lord").players[1]?.role, "未知");

  const finished: GameSnapshot = { ...ongoing, winner: "rebel", gameOver: true };
  assert.equal(createClientSnapshot(finished, "lord").players[1]?.role, PlayerRole.Rebel);
});
