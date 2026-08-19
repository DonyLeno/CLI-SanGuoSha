import assert from "node:assert/strict";
import { test, beforeEach } from "node:test";
import { CardType } from "../engine/cards.js";
import { PlayerRole, SanGuoGame, SkillName } from "../engine/game.js";
import { NETWORK_PROTOCOL_VERSION } from "./protocol.js";
import { GameServer } from "./server.js";
import { TestClient } from "./test-helper.js";

const HANDS = [
  [{ id: "p1-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 }],
  [
    { id: "p2-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 },
    { id: "p2-dodge", type: CardType.Dodge, color: "black" as const, suit: "club" as const, rank: 3 },
  ],
  [{ id: "p3-slash", type: CardType.Slash, color: "red" as const, suit: "heart" as const, rank: 7 }],
];

const originalConsoleLog = console.log;

const createConfiguredGame = async () => {
  const game = new SanGuoGame(() => 0.5);
  await game.initNetworkGame(
    [
      { id: "p1", name: "甲" },
      { id: "p2", name: "乙" },
      { id: "p3", name: "丙" },
    ],
    1,
    false,
  );
  const runtime = game as unknown as {
    players: Array<{
      id: string;
      hand: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
      armor: CardType | null;
      weapon: CardType | null;
      delayedTricks: Array<{ cardType: CardType; sourcePlayerId: string }>;
    }>;
    deck: Array<{ id: string; type: CardType; color: "red" | "black"; suit?: string; rank?: number }>;
    currentPlayerIndex: number;
  };
  for (let index = 0; index < runtime.players.length; index += 1) {
    const player = runtime.players[index]!;
    player.hand = HANDS[index] ?? [];
    player.armor = null;
    player.weapon = null;
    player.delayedTricks = [];
  }
  runtime.deck = [
    { id: "judge-heart", type: CardType.Peach, color: "red", suit: "heart", rank: 7 },
    { id: "judge-club", type: CardType.Slash, color: "black", suit: "club", rank: 3 },
  ];
  runtime.currentPlayerIndex = runtime.players.findIndex((player) => player.id === "p1");
  return { game, runtime };
};

void test("房间聊天会规范化内容并广播给所有在线玩家", async () => {
  console.log = () => {};
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 4, autoRestartAfterGameOver: false },
  );
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: NETWORK_PROTOCOL_VERSION });
    client2.send({ type: "join", name: "乙", version: NETWORK_PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 100));
    client1.send({ type: "chat", content: "  你好   世界  " });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const chat = client2.messages.find((message) => message.type === "chat");
    assert.ok(chat && chat.type === "chat");
    assert.equal(chat.playerName, "甲");
    assert.equal(chat.content, "你好 世界");
    assert.ok(client1.messages.some((message) => message.type === "chat"), "发送者也应收到聊天广播");
  } finally {
    client1.destroy();
    client2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("联机角色被乐不思蜀跳过出牌且无需弃牌时会自动结束回合", async () => {
  const { game, runtime } = await createConfiguredGame();
  const current = runtime.players.find((player) => player.id === "p1");
  assert.ok(current);
  for (const player of runtime.players) {
    player.hand = [];
    (player as typeof player & { skills: SkillName[] }).skills = [];
  }
  current.delayedTricks = [{ cardType: CardType.Indulgence, sourcePlayerId: "p3" }];
  runtime.deck = [
    { id: "indulgence-black", type: CardType.Slash, color: "black", suit: "spade", rank: 7 },
    { id: "draw-1", type: CardType.Slash, color: "red", suit: "heart", rank: 8 },
    { id: "draw-2", type: CardType.Dodge, color: "red", suit: "diamond", rank: 9 },
  ];
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, autoRestartAfterGameOver: false },
    game,
  );
  const internal = server as unknown as {
    runTurnStart(playerId: string): Promise<void>;
    beginTurn(): void;
  };
  let nextTurnCount = 0;
  internal.beginTurn = () => {
    nextTurnCount += 1;
  };

  await internal.runTurnStart(current.id);

  assert.equal(game.getSnapshot().currentPlayerId, "p2");
  assert.equal(game.getSnapshot().phase, "结束阶段");
  assert.equal(nextTurnCount, 1);
});

void test("主动退出后可在超时内重连", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer({ host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500 }, game);
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  const client3 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: NETWORK_PROTOCOL_VERSION });
    client2.send({ type: "join", name: "乙", version: NETWORK_PROTOCOL_VERSION });
    client3.send({ type: "join", name: "丙", version: NETWORK_PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const welcome = client1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome);

    client1.send({ type: "leave" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client1.messages.some((m) => m.type === "closed"), "client1 should receive closed");
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: NETWORK_PROTOCOL_VERSION });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(reconnectClient.messages.some((m) => m.type === "reconnect_ok"), "reconnectClient should receive reconnect_ok");
    } finally {
      reconnectClient.destroy();
    }
  } finally {
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("网络掉线后提示重连且房间不立即关闭", async () => {
  console.log = () => {};
  const { game } = await createConfiguredGame();
  const server = new GameServer({ host: "127.0.0.1", port: 0, playerCount: 3, openingHandCount: 1, reconnectTimeoutMs: 500 }, game);
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  const client3 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: NETWORK_PROTOCOL_VERSION });
    client2.send({ type: "join", name: "乙", version: NETWORK_PROTOCOL_VERSION });
    client3.send({ type: "join", name: "丙", version: NETWORK_PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const welcome = client1.messages.find((m) => m.type === "welcome");
    assert.ok(welcome);

    client1.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(client2.messages.some((m) => m.type === "player_disconnected"), "client2 should receive player_disconnected");
    assert.ok(!client2.messages.some((m) => m.type === "closed"), "client2 should not receive closed immediately");

    const reconnectClient = await TestClient.connect(port);
    try {
      reconnectClient.send({ type: "reconnect", playerId: welcome.playerId, version: NETWORK_PROTOCOL_VERSION });
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.ok(reconnectClient.messages.some((m) => m.type === "reconnect_ok"), "reconnectClient should receive reconnect_ok");
    } finally {
      reconnectClient.destroy();
    }
  } finally {
    client1.destroy();
    client2.destroy();
    client3.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("联机开局：主公5选1、其他角色3选1，最终武将不重复", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 4, autoRestartAfterGameOver: false },
    game,
  );
  const port = await server.listen();
  const client1 = await TestClient.connect(port);
  const client2 = await TestClient.connect(port);
  try {
    client1.send({ type: "join", name: "甲", version: NETWORK_PROTOCOL_VERSION });
    client2.send({ type: "join", name: "乙", version: NETWORK_PROTOCOL_VERSION });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const choices1 = client1.messages.find((message) => message.type === "general_choices");
    const choices2 = client2.messages.find((message) => message.type === "general_choices");
    assert.ok(choices1 && choices1.type === "general_choices");
    assert.ok(choices2 && choices2.type === "general_choices");
    assert.equal(choices1.candidates.length, choices1.role === PlayerRole.Lord ? 5 : 3);
    assert.equal(choices2.candidates.length, choices2.role === PlayerRole.Lord ? 5 : 3);
    assert.notEqual(choices1.role, choices2.role);
    const allCandidates = [...choices1.candidates, ...choices2.candidates].map((general) => general.name);
    assert.equal(new Set(allCandidates).size, allCandidates.length);

    const selected1 = choices1.candidates[0];
    const selected2 = choices2.candidates[0];
    assert.ok(selected1);
    assert.ok(selected2);
    client1.send({ type: "select_general", general: selected1.name });
    client2.send({ type: "select_general", general: selected2.name });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const state = [...client1.messages].reverse().find((message) => message.type === "state");
    assert.ok(state && state.type === "state");
    const selectedGenerals = state.snapshot.players.map((player) => player.general);
    assert.equal(new Set(selectedGenerals).size, selectedGenerals.length);
    assert.deepEqual(new Set(selectedGenerals), new Set([selected1.name, selected2.name]));
  } finally {
    client1.destroy();
    client2.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});

void test("AI 玩家：1 人类 + 1 AI 开局，AI 自动完成出牌回合", async () => {
  console.log = () => {};
  const game = new SanGuoGame(() => 0.5);
  const server = new GameServer(
    { host: "127.0.0.1", port: 0, playerCount: 2, openingHandCount: 4, aiCount: 1, aiDriver: "simple", reconnectTimeoutMs: 60_000 },
    game,
  );
  const port = await server.listen();
  const client = await TestClient.connect(port);
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    client.send({ type: "join", name: "甲", version: NETWORK_PROTOCOL_VERSION });
    await wait(100);
    const generalChoices = client.messages.find((message) => message.type === "general_choices");
    assert.ok(generalChoices && generalChoices.type === "general_choices", "人类玩家应先收到选将候选");
    const selectedGeneral = generalChoices.candidates[0];
    assert.ok(selectedGeneral);
    client.send({ type: "select_general", general: selectedGeneral.name });
    await wait(300);

    const lobby = client.messages.find((m) => m.type === "lobby");
    assert.ok(lobby && lobby.type === "lobby" && lobby.players.some((p) => p.name.includes("[AI]")), "lobby 应展示 AI 座位");

    const startedState = client.messages.find((m) => m.type === "state");
    assert.ok(startedState && startedState.type === "state", "开局后应收到 state");
    const ai = startedState.snapshot.players.find((p) => p.isAI);
    assert.ok(ai, "开局应包含 AI 玩家");
    const aiId = ai.id;
    const humanId = startedState.snapshot.players.find((p) => !p.isAI)?.id;
    assert.ok(humanId, "应包含人类玩家");

    // 自动驱动人类（轮到就结束回合/弃牌/交互一律 pass），观察 AI 回合是否自主推进
    const deadline = Date.now() + 20_000;
    let observedAiTurn = false;
    let observedAiTurnEnd = false;
    let sawGameOver = false;
    let handledInteractions = 0;
    while (Date.now() < deadline) {
      if (client.messages.some((m) => m.type === "game_over" || m.type === "closed")) {
        sawGameOver = true;
        break;
      }
      const interactions = client.messages.filter((m) => m.type === "interaction").length;
      while (handledInteractions < interactions) {
        handledInteractions += 1;
        client.send({ type: "interaction", decision: { choice: "pass" } });
      }
      const lastState = [...client.messages].reverse().find((m) => m.type === "state");
      if (lastState && lastState.type === "state") {
        const current = lastState.snapshot.players.find((p) => p.id === lastState.snapshot.currentPlayerId);
        if (current?.id === aiId) {
          observedAiTurn = true;
        }
        if (observedAiTurn && current?.id !== aiId) {
          observedAiTurnEnd = true;
          break;
        }
        if (current?.id === humanId) {
          if (lastState.pendingDiscardCount > 0) {
            client.send({ type: "discard", handIndex: 0 });
          } else if (lastState.actions.length > 0) {
            const endIdx = lastState.actions.findIndex((a) => a.type === "end");
            if (endIdx >= 0) {
              client.send({ type: "action", actionIndex: endIdx });
            }
          }
        }
      }
      await wait(100);
    }
    assert.equal(observedAiTurn, true, "应观察到 AI 的回合");
    assert.ok(observedAiTurnEnd || sawGameOver, "AI 回合应自主结束并推进到下一玩家");
  } finally {
    client.destroy();
    await server.close();
    console.log = originalConsoleLog;
  }
});
