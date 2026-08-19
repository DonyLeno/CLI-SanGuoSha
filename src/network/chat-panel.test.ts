import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildActionChoiceContext,
  buildTerminalChatPanel,
  buildTerminalCommandPanel,
  computeTerminalPaneLayout,
  displayWidth,
  wrapDisplayText,
} from "./chat-panel.js";

void test("联机目标选择会显示当前牌或技能，长动作在输入提示中自动精简", () => {
  assert.deepEqual(buildActionChoiceContext("使用 酒", "target"), {
    section: "选择目标 · 使用 酒",
    prompt: "使用 酒：选择目标  ",
  });
  assert.deepEqual(buildActionChoiceContext("使用 国色（将♦10 杀当乐不思蜀）", "target-card", "yc"), {
    section: "选择目标的牌 · 使用 国色（将♦10 杀当乐不思蜀） → yc",
    prompt: "使用 国色：选择 yc 的牌  ",
  });
});

void test("联机聊天面板固定宽高并将最新消息放在右上区域", () => {
  const lines = buildTerminalChatPanel([
    { playerName: "甲", content: "旧消息" },
    { playerName: "乙", content: "这是一条会自动换行的较长中文聊天消息" },
  ], 24, 6);
  assert.equal(lines.length, 6);
  assert.ok(lines[0]?.includes("聊天"));
  assert.ok(lines.some((line) => line.includes("乙 ›")));
  assert.ok(lines.some((line) => line.includes("聊天消息")));
  assert.ok(lines.every((line) => displayWidth(line) === 24));
});

void test("输入斜杠后命令面板会展示并过滤候选", () => {
  const candidates = [
    { command: "/help", description: "显示帮助" },
    { command: "/clear", description: "清空屏幕" },
    { command: "/exit", description: "退出房间" },
  ];
  const all = buildTerminalCommandPanel(candidates, "/", 30, 6);
  assert.ok(all.some((line) => line.includes("/help")));
  assert.ok(all.some((line) => line.includes("/clear")));
  const filtered = buildTerminalCommandPanel(candidates, "/cl", 30, 6);
  assert.ok(filtered.some((line) => line.includes("/clear")));
  assert.equal(filtered.some((line) => line.includes("/help")), false);
  assert.ok(filtered.every((line) => displayWidth(line) === 30));
});

void test("联机主显示区会为右上聊天面板预留独立列宽", () => {
  const layout = computeTerminalPaneLayout(160, 38);
  assert.equal(layout.panelWidth, 38);
  assert.equal(layout.mainWidth + layout.panelWidth + 1, 160);
  assert.equal(layout.panelColumn, layout.mainWidth + 2);
  const compact = computeTerminalPaneLayout(80, 38);
  assert.equal(compact.mainWidth, 50);
  assert.equal(compact.mainWidth + compact.panelWidth + 1, 80);

  const lines = wrapDisplayText(
    "  └ 这是一条很长的判定与战场日志，不应延伸进入右上角聊天面板，也不应导致边框发生残影或重复",
    layout.mainWidth,
  );
  assert.ok(lines.every((line) => displayWidth(line) <= layout.mainWidth));
});
