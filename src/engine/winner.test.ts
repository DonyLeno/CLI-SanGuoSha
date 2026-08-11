import assert from "node:assert/strict";
import { test } from "node:test";
import { formatGameWinner, GameWinner, Player, PlayerRole } from "./game.js";
import { ResolveContext, resolveWinner } from "./resolve.js";

const makePlayer = (id: string, role: PlayerRole, alive: boolean, isAI: boolean): Player => ({
  id,
  name: id,
  role,
  gender: "男",
  general: "孙策",
  skills: [],
  isAI,
  hp: alive ? 4 : 0,
  maxHp: 4,
  hand: [],
  weapon: null,
  armor: null,
  defenseHorse: null,
  attackHorse: null,
  treasure: null,
  treasureCards: [],
  delayedTricks: [],
  alive,
  faceDown: false,
});

const decideWinner = (players: Player[]): { winner: GameWinner | null; logs: string[] } => {
  const context = { players, winner: null } as unknown as ResolveContext;
  const logs = resolveWinner(context);
  return { winner: context.winner, logs };
};

void test("终局胜方按身份阵营判定，不受真人或AI座位影响", () => {
  const lordSide = decideWinner([
    makePlayer("ai-lord", PlayerRole.Lord, true, true),
    makePlayer("human-loyalist", PlayerRole.Loyalist, true, false),
    makePlayer("rebel", PlayerRole.Rebel, false, true),
    makePlayer("traitor", PlayerRole.Traitor, false, false),
  ]);
  assert.deepEqual(lordSide, { winner: "lord", logs: ["主公阵营胜利"] });

  const rebels = decideWinner([
    makePlayer("human-lord", PlayerRole.Lord, false, false),
    makePlayer("ai-rebel", PlayerRole.Rebel, true, true),
    makePlayer("human-traitor", PlayerRole.Traitor, true, false),
  ]);
  assert.deepEqual(rebels, { winner: "rebel", logs: ["反贼胜利"] });

  const traitor = decideWinner([
    makePlayer("lord", PlayerRole.Lord, false, false),
    makePlayer("ai-traitor", PlayerRole.Traitor, true, true),
  ]);
  assert.deepEqual(traitor, { winner: "traitor", logs: ["内奸胜利"] });

  const draw = decideWinner([
    makePlayer("lord", PlayerRole.Lord, false, false),
    makePlayer("rebel", PlayerRole.Rebel, false, true),
  ]);
  assert.deepEqual(draw, { winner: "draw", logs: ["全员阵亡，平局"] });
});

void test("终局身份阵营代码统一映射为中文胜利提示", () => {
  assert.equal(formatGameWinner("lord"), "主公阵营胜利");
  assert.equal(formatGameWinner("rebel"), "反贼胜利");
  assert.equal(formatGameWinner("traitor"), "内奸胜利");
  assert.equal(formatGameWinner("draw"), "平局");
});
