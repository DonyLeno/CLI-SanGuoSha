import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexAnsiTheme } from "./codex-theme.js";
import { buildChatLines, buildDisplayLines } from "./render-lines.js";

void test("Codex ANSI 主题在关闭颜色时保持纯文本", () => {
  const theme = createCodexAnsiTheme(false);

  assert.equal(theme.brand(">_ CLI 三国杀"), ">_ CLI 三国杀");
  assert.equal(theme.accent("›"), "›");
});

void test("Codex ANSI 主题在启用颜色时输出终端样式", () => {
  const theme = createCodexAnsiTheme(true);
  const styled = theme.brand(">_ CLI 三国杀");

  assert.match(styled, /^\u001b\[/);
  assert.match(styled, /\u001b\[0m$/);
});

void test("对局记录使用 Codex 风格提示符和活动列表", () => {
  assert.deepEqual(buildDisplayLines(["孙策摸了两张牌"], { title: null, lines: [] }), [
    "› /help 查看规则与快捷命令",
    "",
    "activity",
    "  • 孙策摸了两张牌",
  ]);

  assert.deepEqual(buildDisplayLines([], { title: "规则", lines: ["正文"] }), [
    "› 规则",
    "  /close 关闭当前文档",
    "",
    "正文",
  ]);
});

void test("聊天区固定显示在战场上方，并只保留最近四条可见消息", () => {
  const lines = buildChatLines([
    { sender: "甲", content: "第一条" },
    { sender: "乙", content: "第二条" },
    { sender: "丙", content: "第三条" },
    { sender: "丁", content: "第四条" },
    { sender: "戊", content: "第五条" },
  ]);
  assert.equal(lines[0], "chat · :内容 发送");
  assert.equal(lines.some((line) => line.includes("第一条")), false);
  assert.equal(lines.some((line) => line.includes("第五条")), true);
  assert.equal(lines.at(-1), "──────── 战场 ────────");
});
