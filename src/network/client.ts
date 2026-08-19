import { connect, Socket } from "node:net";
import { clearLine, createInterface, cursorTo, emitKeypressEvents } from "node:readline";
import { formatGameWinner, GameAction, InteractionRequest, RemovableCardOption } from "../engine/game.js";
import { CardType, formatCard } from "../engine/cards.js";
import { actionRequiresTargetCardSelection } from "../engine/card-utils.js";
import { createCodexAnsiTheme } from "../ui/codex-theme.js";
import {
  buildActionChoiceContext,
  buildTerminalChatPanel,
  buildTerminalCommandPanel,
  computeTerminalPaneLayout,
  TerminalChatMessage,
  TerminalCommandCandidate,
  wrapDisplayText,
} from "./chat-panel.js";
import { ClientMessage, ClientSnapshot, encodeMessage, NETWORK_PROTOCOL_VERSION, ServerMessage } from "./protocol.js";
import { JsonLineParser } from "./line-parser.js";

const valueOf = (name: string, fallback: string): string => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const port = Number.parseInt(valueOf("port", "9527"), 10);
const host = valueOf("host", "127.0.0.1");
const name = valueOf("name", `玩家${Math.floor(Math.random() * 1000)}`);
let socket: Socket = connect({ host, port });
let parser = new JsonLineParser<ServerMessage>();
const rl = createInterface({ input: process.stdin, output: process.stdout });
type PendingChoice = {
  prompt: string;
  count: number;
  resolve: (picked: number) => void;
};

let pendingChoice: PendingChoice | null = null;
let inputClosed = false;
const chatMessages: TerminalChatMessage[] = [];
let asking = false;
let lastPlayers: Array<{ id: string; name: string }> = [];
let playerId: string | null = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
let left = false;
let _interacting = false;       // tracks if an interaction prompt is active
let _msgQueue: ServerMessage[] = [];  // sequential message queue
let _processingMsg = false;     // queue processing guard
const ui = createCodexAnsiTheme();
const BRAND_FRAME_WIDTH = 50;
const CHAT_PANEL_WIDTH = 38;
const CHAT_PANEL_HEIGHT = 8;
const MAX_CHAT_MESSAGES = 100;
const COMMAND_PANEL_HEIGHT = 6;
const ONLINE_COMMANDS: TerminalCommandCandidate[] = [
  { command: "/help", description: "显示命令候选" },
  { command: "/clear", description: "清空主显示区" },
  { command: "/exit", description: "退出当前房间" },
];

const terminalWidth = (value: string): number =>
  [...value].reduce((width, character) => width + (/[^\u0000-\u00ff]/.test(character) ? 2 : 1), 0);

const terminalPaneLayout = () => computeTerminalPaneLayout(process.stdout.columns ?? 80, CHAT_PANEL_WIDTH);

const printMainLine = (value: string, paint: (input: string) => string = (input) => input): void => {
  for (const line of wrapDisplayText(value, terminalPaneLayout().mainWidth)) {
    console.log(paint(line));
  }
};

const printBrandLine = (value: string, paint: (input: string) => string, frameWidth: number): void => {
  const fitted = wrapDisplayText(value, Math.max(1, frameWidth - 2))[0] ?? "";
  const padding = " ".repeat(Math.max(1, frameWidth - terminalWidth(fitted) - 1));
  console.log(`${ui.muted("│")} ${paint(fitted)}${padding}${ui.muted("│")}`);
};

const printBrand = (detail: string): void => {
  const frameWidth = Math.max(1, Math.min(BRAND_FRAME_WIDTH, terminalPaneLayout().mainWidth - 2));
  console.log(ui.muted(`╭${"─".repeat(frameWidth)}╮`));
  printBrandLine(">_ CLI 三国杀", ui.brand, frameWidth);
  printBrandLine(detail, ui.muted, frameWidth);
  console.log(ui.muted(`╰${"─".repeat(frameWidth)}╯`));
};

const printSection = (title: string): void => {
  console.log("");
  printMainLine(`• ${title}`, ui.strong);
};

const printOption = (index: number, label: string): void => {
  printMainLine(`  ${String(index + 1).padStart(2, " ")}  ${label}`);
};

const send = (message: ClientMessage): void => {
  if (!socket.destroyed) socket.write(encodeMessage(message));
};
const renderChatPanel = (): void => {
  if (!process.stdout.isTTY) return;
  const { panelWidth: width, panelColumn: column } = terminalPaneLayout();
  const lines = buildTerminalChatPanel(chatMessages, width, CHAT_PANEL_HEIGHT);
  // DECSC/DECRC are supported consistently by Windows Terminal and do not
  // collide with readline's own CSI save/restore cursor bookkeeping.
  let output = "\u001b7";
  for (const [index, line] of lines.entries()) {
    output += `\u001b[${index + 1};${column}H${line}`;
  }
  const commandPrefix = rl.line.trimStart();
  const commandLines = commandPrefix.startsWith("/")
    ? buildTerminalCommandPanel(ONLINE_COMMANDS, commandPrefix, width, COMMAND_PANEL_HEIGHT)
    : Array.from({ length: COMMAND_PANEL_HEIGHT }, () => " ".repeat(width));
  for (const [index, line] of commandLines.entries()) {
    output += `\u001b[${CHAT_PANEL_HEIGHT + index + 2};${column}H${line}`;
  }
  output += "\u001b8";
  process.stdout.write(output);
};
const promptText = (): string => pendingChoice
  ? `${ui.accent("›")} ${pendingChoice.prompt}`
  : `${ui.accent("›")} :内容 聊天  `;
const showInputPrompt = (): void => {
  if (inputClosed) return;
  rl.setPrompt(promptText());
  // `preserveCursor=true` makes readline redraw from its previous prompt
  // position. After printing a multi-line choice list that can erase those
  // freshly printed lines on Windows terminals, so always start a fresh line.
  rl.prompt();
  renderChatPanel();
};
const clearInputPrompt = (): void => {
  if (!process.stdout.isTTY) return;
  clearLine(process.stdout, 0);
  cursorTo(process.stdout, 0);
};
const sendChat = (raw: string): void => {
  const content = raw.slice(1).trim();
  if (content) {
    send({ type: "chat", content });
  } else {
    console.log(ui.warning("  聊天内容不能为空"));
  }
};
const printCommandCandidates = (prefix = "/"): void => {
  const matched = ONLINE_COMMANDS.filter((candidate) => candidate.command.startsWith(prefix));
  console.log("");
  printMainLine("命令候选", ui.accent);
  for (const candidate of matched.length > 0 ? matched : ONLINE_COMMANDS) {
    printMainLine(`  ${candidate.command.padEnd(8)} ${candidate.description}`);
  }
};
const executeClientCommand = (command: string): void => {
  if (command === "/" || command === "/help") {
    printCommandCandidates();
    return;
  }
  if (command === "/clear") {
    console.clear();
    renderChatPanel();
    return;
  }
  if (command === "/exit") {
    left = true;
    send({ type: "leave" });
    socket.end();
    rl.close();
    return;
  }
  const matched = ONLINE_COMMANDS.filter((candidate) => candidate.command.startsWith(command));
  if (matched.length > 0) {
    printCommandCandidates(command);
  } else {
    console.log(ui.warning(`  未知命令：${command}`));
  }
};
const equipmentName = (value: string | null): string => value ?? "无";
const equipmentCardName = (player: ClientSnapshot["players"][number], zone: "weapon" | "armor" | "attackHorse" | "defenseHorse" | "treasure"): string =>
  player.equippedCards?.[zone] ? formatCard(player.equippedCards[zone]) : equipmentName(player[zone]);
const choose = async (prompt: string, count: number): Promise<number> => {
  if (inputClosed || count <= 0) return -1;
  if (pendingChoice) throw new Error("已有尚未完成的选择请求");
  return new Promise<number>((resolve) => {
    pendingChoice = { prompt, count, resolve };
    showInputPrompt();
  });
};

const handleTerminalLine = (value: string): void => {
  const raw = value.trim();
  if (raw.startsWith(":") || raw.startsWith("：")) {
    sendChat(raw);
    showInputPrompt();
    return;
  }
  if (raw.startsWith("/")) {
    executeClientCommand(raw);
    showInputPrompt();
    return;
  }
  const choice = pendingChoice;
  if (!choice) {
    if (raw.length > 0) {
      printMainLine("  当前无需选择；输入 :内容 可发送聊天", ui.warning);
    }
    showInputPrompt();
    return;
  }
  const picked = Number.parseInt(raw, 10) - 1;
  if (!Number.isInteger(picked) || picked < 0 || picked >= choice.count) {
    console.log(ui.danger("  请输入有效编号"));
    showInputPrompt();
    return;
  }
  pendingChoice = null;
  choice.resolve(picked);
};

rl.on("line", handleTerminalLine);
rl.on("close", () => {
  inputClosed = true;
  const choice = pendingChoice;
  pendingChoice = null;
  choice?.resolve(-1);
});
emitKeypressEvents(process.stdin, rl);
process.stdin.on("keypress", () => {
  if (process.stdout.isTTY) setImmediate(renderChatPanel);
});

const chooseTarget = async (action: Exclude<GameAction, { type: "end" }>, players: Array<{ id: string; name: string }>): Promise<string | undefined> => {
  if (!action.requiresTarget) return undefined;
  const targets = action.targets.map((id) => players.find((player) => player.id === id)).filter((player): player is { id: string; name: string } => Boolean(player));
  const context = buildActionChoiceContext(action.label, "target");
  printSection(context.section);
  targets.forEach((target, index) => printOption(index, target.name));
  return targets[await choose(context.prompt, targets.length)]?.id;
};

const chooseTargetCard = async (
  action: Exclude<GameAction, { type: "end" }>,
  targetName: string,
  options: RemovableCardOption[] | undefined,
): Promise<string | undefined> => {
  if (!options || options.length === 0) return undefined;
  const context = buildActionChoiceContext(action.label, "target-card", targetName);
  printSection(context.section);
  options.forEach((option, index) => printOption(index, option.label));
  return options[await choose(context.prompt, options.length)]?.id;
};

const playerName = (id: string): string => lastPlayers.find((player) => player.id === id)?.name ?? id;
const choiceSubject = (reason: string, fallback: string): string =>
  reason.split(/[：:]/u)[0]?.trim() || fallback;

const handleInteraction = async (request: InteractionRequest): Promise<void> => {
  _interacting = true;
  try {
  if (request.kind === "respond") {
    printSection(request.reason);
    request.sources.forEach((source, index) => printOption(index, source.label));
    printOption(request.sources.length, "不应对");
    const responseLabels = { dodge: "闪", slash: "杀", negate: "无懈可击", peach: "桃" } as const;
    const picked = await choose(`${request.trigger.cardName}：是否打出${responseLabels[request.responseKind]}  `, request.sources.length + 1);
    const source = request.sources[picked];
    send({ type: "interaction", decision: source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" } });
    return;
  }
  if (request.kind === "collateral") {
    printSection(request.reason);
    const isIronChain = request.reason.includes(CardType.IronChain);
    const isCollateral = request.reason.includes(CardType.Collateral);
    request.victims.forEach((victimId, index) => printOption(index, isCollateral ? `对 ${playerName(victimId)} 使用杀` : `选择 ${playerName(victimId)}`));
    if (request.allowHandOverWeapon) printOption(request.victims.length, isCollateral ? "交出武器" : "放弃");
    if (isIronChain) printOption(request.victims.length, "取消（只处理第一名角色）");
    const count = request.victims.length + (request.allowHandOverWeapon || isIronChain ? 1 : 0);
    const picked = await choose(`${choiceSubject(request.reason, isCollateral ? CardType.Collateral : "当前效果")}：选择目标或放弃  `, count);
    const victimId = request.victims[picked];
    if (victimId) {
      if (request.sources.length > 1) {
        printSection("选择用于响应的杀");
        request.sources.forEach((source, index) => printOption(index, source.label));
        const sourcePicked = await choose("选择用于响应的杀  ", request.sources.length);
        const source = request.sources[sourcePicked];
        send({ type: "interaction", decision: { choice: "target", targetId: victimId, ...(source ? { sourceId: source.sourceId } : {}) } });
      } else {
        send({ type: "interaction", decision: { choice: "target", targetId: victimId } });
      }
    } else {
      send({ type: "interaction", decision: { choice: "pass" } });
    }
    return;
  }
  if (request.kind === "choose-suit") {
    const suitLabels: Record<string, string> = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
    printSection(request.reason);
    request.suits.forEach((suit, index) => printOption(index, `声明${suitLabels[suit] ?? suit}`));
    const picked = await choose(`${choiceSubject(request.reason, "当前效果")}：选择声明花色  `, request.suits.length);
    const suit = request.suits[picked] ?? request.suits[0] ?? "heart";
    send({ type: "interaction", decision: { choice: "suit", suit } });
    return;
  }
  if (request.kind === "choose-discard" || request.kind === "choose-card") {
    printSection(request.reason);
    request.sources.forEach((source, index) => printOption(index, source.label));
    if (request.allowPass) {
      printOption(request.sources.length, request.passLabel ?? "放弃");
    }
    const count = request.sources.length + (request.allowPass ? 1 : 0);
    const subject = choiceSubject(request.reason, "当前效果");
    const picked = await choose(request.kind === "choose-discard" ? `${subject}：选择要弃置的牌  ` : `${subject}：选择牌  `, count);
    const source = request.sources[picked];
    send({ type: "interaction", decision: source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" } });
    return;
  }
  if (request.kind === "optional-effect") {
    printSection(request.reason);
    printOption(0, "发动");
    printOption(1, "不发动");
    send({ type: "interaction", decision: { choice: "effect", enabled: await choose(`${request.effect}：是否发动  `, 2) === 0 } });
    return;
  }
  console.log(ui.warning(`未处理的交互类型：${(request as { kind: string }).kind}`));
  } finally {
    _interacting = false;
  }
};

// Sequential message queue: prevents concurrent message processing
// so e.g. state updates never clear() over an interaction prompt.
const enqueueMessage = (msg: ServerMessage): void => {
  _msgQueue.push(msg);
  if (!_processingMsg) void processNextMessage();
};

const processNextMessage = async (): Promise<void> => {
  if (_processingMsg || _msgQueue.length === 0) return;
  _processingMsg = true;
  try {
    const msg = _msgQueue.shift();
    if (msg) {
      clearInputPrompt();
      await handle(msg);
    }
  } finally {
    _processingMsg = false;
    showInputPrompt();
    void processNextMessage();
  }
};

const printChat = (message: Extract<ServerMessage, { type: "chat" }>): void => {
  chatMessages.push({ playerName: message.playerName, content: message.content });
  if (chatMessages.length > MAX_CHAT_MESSAGES) {
    chatMessages.splice(0, chatMessages.length - MAX_CHAT_MESSAGES);
  }
  if (process.stdout.isTTY) {
    renderChatPanel();
  } else {
    console.log(`\n${ui.accent("chat")} ${ui.strong(message.playerName)} › ${message.content}`);
  }
};

const handle = async (message: ServerMessage): Promise<void> => {
  if (message.type === "welcome") {
    printBrand(`online · ${host}:${port} · player ${name}`);
    console.log(`\n${ui.accent("›")} 已加入房间 · ID ${message.playerId}`);
    playerId = message.playerId;
    reconnectAttempts = 0;
  }
  else if (message.type === "lobby") console.log(`${ui.muted("•")} 等待玩家 ${message.players.length}/${message.roomSize} · ${message.players.map((p) => p.name).join("、")}`);
  else if (message.type === "general_choices") {
    printSection(`选将 · 你的身份是${message.role}`);
    message.candidates.forEach((general, index) => {
      const skills = general.skills.length > 0 ? general.skills.join("、") : "无技能";
      printOption(index, `${general.name}[${general.kingdom}] · ${general.maxHp}体力 · ${skills}`);
    });
    const picked = await choose(`${message.role}：选择武将  `, message.candidates.length);
    const general = message.candidates[picked];
    if (general) {
      send({ type: "select_general", general: general.name });
      console.log(`${ui.accent("›")} 已选择 ${general.name}，等待其他玩家…`);
    }
  }
  else if (message.type === "general_selection_status") {
    printMainLine(`• 选将进度 ${message.selectedCount}/${message.totalCount}`, ui.muted);
  }
  else if (message.type === "error") console.error(ui.danger(`错误：${message.message}`));
  else if (message.type === "closed") {
    console.log(ui.warning(message.message));
    left = true;
    socket.end();
  }
  else if (message.type === "player_disconnected") { console.log(ui.warning(`${message.playerName} 已断线 · ${message.waitTimeSeconds}s 内可重连`)); }
  else if (message.type === "player_reconnected") { console.log(`${ui.accent("•")} ${message.playerName} 已重连`); }
  else if (message.type === "chat") { printChat(message); }
  else if (message.type === "reconnect_ok") {
    console.log(`${ui.accent("›")} 已重连 · ID ${message.playerId}`);
    playerId = message.playerId;
    reconnectAttempts = 0;
  }
  else if (message.type === "interaction") {
    await handleInteraction(message.request);
  }
  else if (message.type === "game_over") console.log(ui.warning(message.message));
  else if (message.type === "game_restarting") console.log(`${ui.accent("›")} ${message.message}`);
  else if (message.type === "state") {
    lastPlayers = message.snapshot.players.map((player) => ({ id: player.id, name: player.name }));
    if (!_interacting) {
      console.clear();
    } else {
      printSection("状态更新 · 技能询问中");
    }
    printMainLine(`>_ CLI 三国杀 · online · turn ${message.snapshot.turn} · ${message.snapshot.phase}`, ui.brand);
    if (message.logs.length > 0) {
      printSection("对局记录");
      for (const line of message.logs) {
        printMainLine(`  └ ${line}`, ui.muted);
      }
    }
    printSection("战场");
    for (const player of message.snapshot.players) {
      const cards = player.hand ? player.hand.map(formatCard).join("、") || "无" : `${player.handCount} 张`;
      const active = player.id === message.snapshot.currentPlayerId;
      printMainLine(`${active ? "›" : "•"} ${player.name} [${player.general}] · ${player.role} · HP ${Math.max(0, player.hp)}/${player.maxHp} · 手牌 ${cards} · ${player.faceDown ? "翻面" : "正面"}${player.chained ? " · 横置" : ""}`, active ? ui.strong : (input) => input);
      printMainLine(`  └ 武器 ${equipmentCardName(player, "weapon")} · 防具 ${equipmentCardName(player, "armor")} · -1马 ${equipmentCardName(player, "attackHorse")} · +1马 ${equipmentCardName(player, "defenseHorse")} · 宝物 ${equipmentCardName(player, "treasure")}`, ui.muted);
      if (player.delayedTricks.length > 0) {
        printMainLine(`    判定区 ${player.delayedTricks.map((trick) => `${trick.cardType}${trick.card ? `（${formatCard(trick.card)}）` : ""}`).join("、")}`);
      }
    }
    if (message.snapshot.gameOver) { printSection(`游戏结束 · ${formatGameWinner(message.snapshot.winner)}`); return; }
    if (asking || (message.actions.length === 0 && message.pendingDiscardCount === 0)) {
      console.log("");
      printMainLine("• 等待其他玩家行动…", ui.muted);
      return;
    }
    asking = true;
    try {
      if (message.pendingDiscardCount > 0) {
        const me = message.snapshot.players.find((player) => player.id === message.snapshot.currentPlayerId);
        const usable = [...(me?.hand ?? []).map(formatCard), ...(me?.treasureCards ?? []).map((card) => `${formatCard(card)}（木牛流马）`)];
        printSection(`弃牌 · 还需 ${message.pendingDiscardCount} 张`);
        usable.forEach((label, index) => printOption(index, label));
        send({ type: "discard", handIndex: await choose(`弃牌（还需 ${message.pendingDiscardCount} 张）  `, usable.length) });
      } else {
        printSection("可执行动作");
        message.actions.forEach((action, index) => printOption(index, action.label));
        const actionIndex = await choose("选择动作  ", message.actions.length);
        const action = message.actions[actionIndex];
        if (!action) return;
        const targetId = action.type === "end" ? undefined : await chooseTarget(action, message.snapshot.players);
        const targetName = targetId
          ? message.snapshot.players.find((player) => player.id === targetId)?.name ?? targetId
          : "目标";
        const selectedCardId = action.type !== "end" && targetId && actionRequiresTargetCardSelection(action)
          ? await chooseTargetCard(action, targetName, message.removableCards[targetId])
          : undefined;
        send({ type: "action", actionIndex, ...(targetId ? { targetId } : {}), ...(selectedCardId ? { selectedCardId } : {}) });
      }
    } finally { asking = false; }
  }
};

const attemptReconnect = async (): Promise<void> => {
  if (left || !playerId) {
    console.log(ui.warning("连接已断开，你可以重新运行客户端尝试重连"));
    return;
  }
  reconnectAttempts += 1;
  if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
    console.log(ui.danger(`重连失败 · 已尝试 ${MAX_RECONNECT_ATTEMPTS} 次`));
    return;
  }
  const delay = Math.min(500 * Math.pow(2, reconnectAttempts - 1), 15000);
  console.log(ui.warning(`连接断开 · 尝试重连 ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS} · ${delay}ms 后…`));
  await new Promise<void>((resolve) => setTimeout(resolve, delay));
  try {
    socket = connect({ host, port, timeout: 5000 });
    parser = new JsonLineParser<ServerMessage>();
    bindSocket(socket, parser);
    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      socket.once("connect", resolve);
    });
    console.log(`${ui.accent("›")} 重连成功`);
    reconnectAttempts = 0;
  } catch (error) {
    console.error(ui.danger(`重连失败：${(error as Error).message}`));
    void attemptReconnect();
  }
};

const bindSocket = (s: Socket, p: JsonLineParser<ServerMessage>): void => {
  s.setEncoding("utf8");
  s.on("connect", () => {
    if (playerId) {
      s.write(encodeMessage({ type: "reconnect", playerId, version: NETWORK_PROTOCOL_VERSION }));
    } else {
      send({ type: "join", name, version: NETWORK_PROTOCOL_VERSION });
    }
    showInputPrompt();
  });
  s.on("data", (chunk: string) => {
    for (const message of p.push(chunk)) {
      if (message.type === "chat") {
        printChat(message);
      } else {
        enqueueMessage(message);
      }
    }
  });
  s.on("error", (error: Error) => { console.error(ui.danger(`连接失败：${error.message}`)); void rl.close(); });
  s.on("close", () => { if (!left) void attemptReconnect(); });
};

bindSocket(socket, parser);
