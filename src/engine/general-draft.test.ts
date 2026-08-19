import assert from "node:assert/strict";
import { test } from "node:test";
import { PlayerRole, SanGuoGame } from "./game.js";

void test("选将候选池：主公5名、其他角色3名，整局候选无重复", () => {
  const game = new SanGuoGame(() => 0.25);
  const draft = game.createDefaultGeneralDraft(6, PlayerRole.Lord);

  assert.equal(draft.length, 6);
  assert.equal(draft.find((seat) => seat.role === PlayerRole.Lord)?.candidates.length, 5);
  for (const seat of draft.filter((item) => item.role !== PlayerRole.Lord)) {
    assert.equal(seat.candidates.length, 3);
  }
  const names = draft.flatMap((seat) => seat.candidates.map((general) => general.name));
  assert.equal(new Set(names).size, names.length);
});

void test("非主公玩家只有3名候选，AI主公仍有5名候选", () => {
  const game = new SanGuoGame(() => 0.5);
  const draft = game.createDefaultGeneralDraft(4, PlayerRole.Rebel);

  assert.equal(draft.find((seat) => seat.playerId === "human")?.candidates.length, 3);
  assert.equal(draft.find((seat) => seat.role === PlayerRole.Lord)?.candidates.length, 5);
});

void test("指定候选选将结果后，本地对局所有武将保持唯一", async () => {
  const game = new SanGuoGame(() => 0.75);
  const draft = game.createDefaultGeneralDraft(5, PlayerRole.Loyalist);
  const humanGeneral = draft.find((seat) => seat.playerId === "human")?.candidates[0];
  assert.ok(humanGeneral);
  const generalAssignments = Object.fromEntries(
    draft
      .filter((seat) => seat.playerId !== "human")
      .map((seat) => [seat.playerId, seat.candidates[0]?.name ?? ""]),
  );

  await game.initDefaultGame({
    playerCount: 5,
    humanRole: PlayerRole.Loyalist,
    humanGeneral: humanGeneral.name,
    generalAssignments,
  });

  const selected = game.getSnapshot().players.map((player) => player.general);
  assert.equal(new Set(selected).size, selected.length);
  assert.equal(game.getSnapshot().players.find((player) => player.id === "human")?.general, humanGeneral.name);
});

void test("联机选将草案为每名玩家分配秘密身份和无重复候选", () => {
  const game = new SanGuoGame(() => 0.4);
  const draft = game.createNetworkGeneralDraft([
    { id: "p1", name: "甲" },
    { id: "p2", name: "乙" },
    { id: "p3", name: "丙" },
  ]);

  assert.equal(draft.filter((seat) => seat.role === PlayerRole.Lord).length, 1);
  assert.equal(draft.find((seat) => seat.role === PlayerRole.Lord)?.candidates.length, 5);
  const candidateNames = draft.flatMap((seat) => seat.candidates.map((general) => general.name));
  assert.equal(new Set(candidateNames).size, candidateNames.length);
});
