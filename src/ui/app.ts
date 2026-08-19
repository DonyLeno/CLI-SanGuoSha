import { BoxRenderable, KeyEvent, TextRenderable, bold, createCliRenderer, fg, t } from "@opentui/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AiModelProvider, GameAiLoop } from "../agent/ai.js";
import { LocalAiEngine } from "../agent/local-engine.js";
import { RoundPromptContext } from "../agent/prompt.js";
import { buildBattlefieldLines, buildRoundContexts, trackRoundBattlefield } from "../agent/round-context.js";
import { computeAiTurnActionLimit, pickAiTurnDecision } from "../agent/turn-decision.js";
import { CardType } from "../engine/cards.js";
import { GameAction, GameInitOptions, GeneralDefinition, InteractionDecision, InteractionRequest, Player, PlayerRole, RemovableCardOption, SanGuoGame } from "../engine/game.js";
import { actionRequiresTargetCardSelection, extractCardTypeFromAction, getActionHint } from "./action-hints.js";
import { CODEX_THEME } from "./codex-theme.js";
import { buildActionLines, buildChatLines, buildDisplayLines, buildStatusLines, ChatMessageView } from "./render-lines.js";

type InputMode = "setup" | "action" | "target" | "target-card" | "response" | "discard" | "gameover";

type SetupStage = "player-count" | "role" | "general" | "ai-model" | "ollama-model" | "start";

type SetupAiModel = "simple" | AiModelProvider;

type FocusArea = "display" | "action" | "status";

type AppOptions = {
  initOptions: Partial<GameInitOptions>;
};

type TargetAction = Exclude<GameAction, { type: "end" }>;

const CHAT_PANEL_HEIGHT = 8;
const MAX_CHAT_MESSAGES = 100;
const MAX_CHAT_LENGTH = 120;

export class CliSanGuoApp {
  private readonly game: SanGuoGame;

  private renderer?: Awaited<ReturnType<typeof createCliRenderer>>;

  private headerView?: TextRenderable;

  private battlefieldView?: TextRenderable;

  private actionView?: TextRenderable;

  private logsView?: TextRenderable;

  private chatView?: TextRenderable;

  private displayColumn?: BoxRenderable;

  private actionColumn?: BoxRenderable;

  private statusColumn?: BoxRenderable;

  private logs: string[];

  private chatMessages: ChatMessageView[];

  private mode: InputMode;

  private actionOptions: GameAction[];

  private targetOptions: Player[];

  private pendingAction: TargetAction | null;

  private pendingInteraction: { request: InteractionRequest; resolve: (decision: InteractionDecision) => void } | null;

  private pendingTargetId: string | null;

  private targetCardOptions: RemovableCardOption[];

  private commandBuffer: string | null;

  private readonly options: AppOptions;

  private readonly generalLibrary: ReturnType<SanGuoGame["getGeneralLibrary"]>;

  private readonly rulesLines: string[];

  private readonly aiLoop: GameAiLoop;

  private readonly localAiEngine: LocalAiEngine;

  private displayOverlayTitle: string | null;

  private displayOverlayLines: string[];

  private displayPage: number;

  private displayFollowLatest: boolean;

  private actionPage: number;

  private statusPage: number;

  private setupStage: SetupStage;

  private setupPlayerCount: number;

  private setupRole: PlayerRole;

  private setupGeneralName: string;

  private setupGeneralCandidates: GeneralDefinition[];

  private setupGeneralAssignments: Record<string, string>;

  private setupAiModel: SetupAiModel;

  private setupOllamaModel: string;

  private setupOllamaModels: string[];

  private setupOllamaLoading: boolean;

  private setupOllamaLoadError: string | null;

  private focusArea: FocusArea;

  private busy: boolean;

  private roundBattlefieldHistory: Map<number, string[]>;

  private readonly maxContextRounds: number;

  constructor(game: SanGuoGame, options: AppOptions) {
    this.game = game;
    this.options = options;
    this.logs = [];
    this.chatMessages = [];
    this.mode = "setup";
    this.actionOptions = [];
    this.targetOptions = [];
    this.pendingAction = null;
    this.pendingInteraction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.commandBuffer = null;
    this.generalLibrary = this.game.getGeneralLibrary();
    this.rulesLines = this.loadRulesLines();
    this.aiLoop = new GameAiLoop(this.rulesLines.join("\n"));
    this.localAiEngine = new LocalAiEngine(this.rulesLines.join("\n"));
    this.displayOverlayTitle = null;
    this.displayOverlayLines = [];
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
    this.setupStage = "player-count";
    this.setupPlayerCount = 3;
    this.setupRole = PlayerRole.Lord;
    this.setupGeneralName = "待选择";
    this.setupGeneralCandidates = [];
    this.setupGeneralAssignments = {};
    this.setupAiModel = "qwen";
    this.setupOllamaModel = "gemma4:latest";
    this.setupOllamaModels = [];
    this.setupOllamaLoading = false;
    this.setupOllamaLoadError = null;
    this.focusArea = "display";
    this.busy = false;
    this.roundBattlefieldHistory = new Map();
    this.maxContextRounds = this.readContextRounds();
    this.aiLoop.setMaxContextRounds(this.maxContextRounds);
    this.localAiEngine.setMaxContextRounds(this.maxContextRounds);
  }

  private readContextRounds(): number {
    const raw = process.env.SG_AI_CONTEXT_ROUNDS;
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : 30;
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      consoleMode: "disabled",
      screenMode: "alternate-screen",
      useMouse: false,
      backgroundColor: CODEX_THEME.canvas,
    });

    const rootBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      border: false,
      backgroundColor: CODEX_THEME.canvas,
      padding: 1,
      rowGap: 1,
      flexDirection: "column",
    });

    const headerBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: 4,
      border: true,
      borderStyle: "rounded",
      borderColor: CODEX_THEME.border,
      backgroundColor: CODEX_THEME.surface,
      title: " >_ CLI 三国杀 ",
      paddingX: 1,
    });

    this.headerView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
      fg: CODEX_THEME.text,
      bg: CODEX_THEME.surface,
      selectable: false,
    });

    const workspaceBox = new BoxRenderable(this.renderer, {
      width: "100%",
      flexGrow: 1,
      flexDirection: "row",
      columnGap: 1,
      backgroundColor: CODEX_THEME.canvas,
    });

    this.displayColumn = new BoxRenderable(this.renderer, {
      width: "40%",
      height: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: CODEX_THEME.border,
      backgroundColor: CODEX_THEME.surface,
      title: " 对局记录 ",
      padding: 1,
      flexDirection: "column",
    });

    this.actionColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: CODEX_THEME.border,
      backgroundColor: CODEX_THEME.surface,
      title: " 下一步 ",
      padding: 1,
      flexDirection: "column",
    });

    this.statusColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: CODEX_THEME.border,
      backgroundColor: CODEX_THEME.surface,
      title: " 聊天 / 战场 ",
      padding: 1,
      flexDirection: "column",
      rowGap: 1,
    });

    this.battlefieldView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
      fg: CODEX_THEME.text,
      bg: CODEX_THEME.surface,
      wrapMode: "word",
      selectable: false,
    });

    this.actionView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
      fg: CODEX_THEME.text,
      bg: CODEX_THEME.surface,
      wrapMode: "word",
      selectable: false,
    });

    this.chatView = new TextRenderable(this.renderer, {
      width: "100%",
      height: CHAT_PANEL_HEIGHT,
      content: "",
      fg: CODEX_THEME.text,
      bg: CODEX_THEME.surface,
      wrapMode: "word",
      selectable: false,
    });

    this.logsView = new TextRenderable(this.renderer, {
      width: "100%",
      flexGrow: 1,
      content: "",
      fg: CODEX_THEME.text,
      bg: CODEX_THEME.surface,
      wrapMode: "word",
      selectable: false,
    });

    const footerView = new TextRenderable(this.renderer, {
      width: "100%",
      height: 1,
      content: "← → 切换区域  ·  ↑ ↓ 翻页  ·  / 命令  ·  : 聊天  ·  b 返回",
      fg: CODEX_THEME.muted,
      bg: CODEX_THEME.canvas,
      selectable: false,
    });

    headerBox.add(this.headerView);
    this.displayColumn.add(this.battlefieldView);
    this.actionColumn.add(this.actionView);
    this.statusColumn.add(this.chatView);
    this.statusColumn.add(this.logsView);
    workspaceBox.add(this.displayColumn);
    workspaceBox.add(this.actionColumn);
    workspaceBox.add(this.statusColumn);
    rootBox.add(headerBox);
    rootBox.add(workspaceBox);
    rootBox.add(footerView);
    this.renderer.root.add(rootBox);
    this.renderer.keyInput.on("keypress", (event) => this.onKeyPress(event));
    this.updateFocusFrame();

    this.initSetup();
    this.refresh();
    this.renderer.start();
  }

  private onKeyPress(event: KeyEvent): void {
    if (this.handleCommandInput(event)) {
      return;
    }
    if (this.busy && this.mode !== "response") {
      return;
    }
    if (this.handleAreaPagingInput(event)) {
      return;
    }
    if (this.mode === "gameover") {
      if (event.name === "r") {
        this.restart();
      }
      return;
    }
    if (this.mode === "setup") {
      void this.handleSetupInput(event);
      return;
    }
    if (this.mode === "response") {
      const pickedResponse = this.toOptionIndex(event);
      if (pickedResponse === null) {
        return;
      }
      void this.handleInteractionChoice(pickedResponse);
      return;
    }
    if (this.mode === "discard") {
      const pickedDiscard = this.toOptionIndex(event);
      if (pickedDiscard === null) {
        return;
      }
      void this.handleDiscardChoice(pickedDiscard);
      return;
    }
    if (this.mode === "target" && event.name === "b") {
      this.pendingAction = null;
      this.targetOptions = [];
      this.mode = "action";
      this.refresh();
      return;
    }
    if (this.mode === "target-card" && event.name === "b") {
      this.pendingTargetId = null;
      this.targetCardOptions = [];
      this.mode = "target";
      this.refresh();
      return;
    }
    const picked = this.toOptionIndex(event);
    if (picked === null) {
      return;
    }
    if (this.mode === "action") {
      const action = this.actionOptions[picked];
      if (!action) {
        return;
      }
      void this.handleActionChoice(action);
      return;
    }
    if (this.mode === "target") {
      const target = this.targetOptions[picked];
      if (!target || !this.pendingAction) {
        return;
      }
      void this.handleTargetChoice(target.id);
      return;
    }
    if (this.mode === "target-card") {
      if (this.targetCardOptions.length === 0) {
        if (picked === 0) {
          void this.handleTargetCardChoice("");
        }
        return;
      }
      const option = this.targetCardOptions[picked];
      if (!option) {
        return;
      }
      void this.handleTargetCardChoice(option.id);
    }
  }

  private async handleActionChoice(action: GameAction): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (action.type === "end") {
      await this.playAndAppendLogs(current.id, action);
      if (this.game.getPendingDiscardCount(current.id) > 0) {
        this.mode = "discard";
        this.refresh();
        return;
      }
      await this.resolveAiTurns();
      return;
    }
    if (!action.requiresTarget) {
      await this.playAndAppendLogs(current.id, action);
      await this.resolveAiTurns();
      return;
    }
    this.pendingAction = action;
    const snapshot = this.game.getSnapshot();
    this.targetOptions = snapshot.players.filter((player) => action.targets.includes(player.id));
    this.mode = "target";
    this.refresh();
  }

  private async handleTargetChoice(targetId: string): Promise<void> {
    if (!this.pendingAction) {
      return;
    }
    if (actionRequiresTargetCardSelection(this.pendingAction)) {
      this.pendingTargetId = targetId;
      this.targetCardOptions = this.game.getRemovableCardOptions(targetId);
      this.mode = "target-card";
      this.refresh();
      return;
    }
    const current = this.game.getCurrentPlayer();
    await this.playAndAppendLogs(current.id, this.pendingAction, targetId);
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.mode = "action";
    await this.resolveAiTurns();
  }

  private async handleTargetCardChoice(selectedCardId: string): Promise<void> {
    if (!this.pendingAction || !this.pendingTargetId) {
      return;
    }
    const current = this.game.getCurrentPlayer();
    await this.playAndAppendLogs(current.id, this.pendingAction, this.pendingTargetId, undefined, selectedCardId);
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.mode = "action";
    await this.resolveAiTurns();
  }

  private async handleDiscardChoice(picked: number): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (current.id !== "human") {
      this.mode = "action";
      this.refresh();
      return;
    }
    const options = this.game.getDiscardOptions(current.id);
    const selected = options[picked];
    if (!selected) {
      return;
    }
    this.busy = true;
    try {
      const logs = await this.game.discardForCurrentPlayer(current.id, selected.handIndex);
      for (const line of logs) {
        this.logs.push(line);
        this.refresh();
        await this.delay(100);
      }
    } finally {
      this.busy = false;
    }
    if (this.game.getPendingDiscardCount(current.id) > 0) {
      this.mode = "discard";
      this.refresh();
      return;
    }
    await this.resolveAiTurns();
  }

  private async resolveAiTurns(): Promise<void> {
    let actionsTaken = 0;
    let actionsForPlayer: string | null = null;
    while (!this.game.getSnapshot().gameOver && this.game.getCurrentPlayer().isAI) {
      const turnStateLogs = await this.game.ensureTurnState();
      if (turnStateLogs.length > 0) {
        for (const line of turnStateLogs) {
          this.logs.push(line);
          this.refresh();
          await this.delay(120);
        }
        continue;
      }
      const ai = this.game.getCurrentPlayer();
      // 换人时重置动作计数（单个 AI 回合内累计）
      if (actionsForPlayer !== ai.id) {
        actionsForPlayer = ai.id;
        actionsTaken = 0;
      }
      // 兜底：LLM 可能反复执行低收益动作，动作数达上限时强制收尾
      const actionLimit = computeAiTurnActionLimit(ai.hand.length, ai.treasureCards.length);
      if (actionsTaken >= actionLimit) {
        this.logs.push(`[AI] ${ai.name} 回合动作已达上限（${actionLimit}），强制结束出牌`);
        this.refresh();
        const forcedEndAction = this.game.getPlayableActions(ai.id).find((action) => action.type === "end");
        if (!forcedEndAction) {
          break;
        }
        await this.playAndAppendLogs(ai.id, forcedEndAction, undefined, 120);
        continue;
      }
      const snapshot = this.game.getSnapshot();
      const previousRounds = this.getPreviousRoundPromptContexts(snapshot.turn);
      this.aiLoop.setPreviousRoundContexts(previousRounds);
      this.localAiEngine.syncPreviousRounds(previousRounds);
      const picked = await pickAiTurnDecision(this.game, ai.id, this.setupAiModel === "simple" ? null : this.aiLoop, this.localAiEngine);
      const normalizedDecision = picked.decision;
      if (!normalizedDecision) {
        const forcedEndAction = this.game.getPlayableActions(ai.id).find((action) => action.type === "end");
        if (!forcedEndAction) {
          break;
        }
        await this.playAndAppendLogs(ai.id, forcedEndAction, undefined, 120);
        continue;
      }
      if (picked.localInsight) {
        this.logs.push(`[本地AI-预判] ${ai.name}：${picked.localInsight}`);
      }
      const targetText = normalizedDecision.targetId ? ` -> ${this.labelPlayer(normalizedDecision.targetId)}` : "";
      const reasonText = picked.fallbackReason ? `（回退原因：${picked.fallbackReason}）` : "";
      const actionDelayMs = picked.driverLabel === "本地AI" ? 1000 : 200;
      this.logs.push(`[${picked.driverLabel}] ${ai.name} 选择：${normalizedDecision.action.label}${targetText}${reasonText}`);
      this.refresh();
      await this.delay(actionDelayMs);
      await this.playAndAppendLogs(ai.id, normalizedDecision.action, normalizedDecision.targetId, 200);
      actionsTaken += 1;
      // AI 回合结束：以高推理等级做一次策略博弈，后台并行执行不阻塞后续出牌
      if (this.game.getCurrentPlayer().id !== ai.id || !this.game.getCurrentPlayer().alive) {
        if (this.setupAiModel !== "simple") {
          const reviewSnapshot = this.game.getSnapshot();
          this.logs.push(`[AI] ${ai.name} 正在复盘局势...`);
          void this.aiLoop.reviewStrategy(this.game, ai.id, reviewSnapshot).catch(() => {
          // 后台复盘失败不影响对局
        });
        }
      }
    }
    this.mode = this.game.getSnapshot().gameOver ? "gameover" : "action";
    this.refresh();
  }

  private refresh(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView || !this.chatView) {
      return;
    }
    this.refreshHeader();
    if (this.mode === "setup") {
      this.refreshSetupViews();
      return;
    }
    const snapshot = this.game.getSnapshot();
    this.syncCurrentRoundBattlefield(snapshot);
    if (!snapshot.gameOver) {
      const current = this.game.getCurrentPlayer();
      this.actionOptions = current.isAI ? [] : this.game.getPlayableActions(current.id);
    } else {
      this.actionOptions = [];
    }
    const localPlayerId = snapshot.players.find((player) => !player.isAI)?.id ?? "human";
    const statusLines = buildStatusLines(snapshot, (playerId) => this.labelPlayer(playerId), localPlayerId);

    const actionLines = buildActionLines({
      commandBuffer: this.commandBuffer,
      mode: this.mode,
      actionOptions: this.actionOptions,
      pendingAction: this.pendingAction,
      targetOptions: this.targetOptions,
      targetCardOptions: this.targetCardOptions,
      pendingInteraction: this.pendingInteraction,
      pendingTargetId: this.pendingTargetId,
      snapshot,
      labelPlayer: (playerId) => this.labelPlayer(playerId),
      isSnatch: (action) => this.isSnatchAction(action),
      getCommandListLines: () => this.getCommandListLines(),
      getActionHint: (action) => getActionHint(action),
    });

    const displayPageSize = this.getBodyPageSize();
    const actionPageSize = this.getBodyPageSize();
    const statusPageSize = Math.max(4, this.getBodyPageSize() - CHAT_PANEL_HEIGHT - 1);
    const displayLines: string[] = buildDisplayLines(this.logs, {
      title: this.displayOverlayTitle,
      lines: this.displayOverlayLines,
    });
    if (this.displayOverlayTitle === null && this.displayFollowLatest) {
      this.displayPage = this.getMaxPage(displayLines.length, displayPageSize);
    }
    const displayViewLines = this.renderPagedArea({
      lines: displayLines,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;

    const actionViewLines = this.renderPagedArea({
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;

    const statusViewLines = this.renderPagedArea({
      lines: statusLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    this.chatView.content = buildChatLines(this.chatMessages).join("\n");
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private refreshHeader(): void {
    if (!this.headerView) {
      return;
    }
    const session = this.mode === "setup" ? "setup" : this.game.getSnapshot().gameOver ? "complete" : "local match";
    const model = this.getAiModelLabel(this.setupAiModel);
    this.headerView.content = t`${bold(fg(CODEX_THEME.accent)("› 三国杀 · AI 对战终端"))}\n${fg(CODEX_THEME.muted)(`  session: ${session}  ·  players: ${this.setupPlayerCount}  ·  model: ${model}`)}`;
  }

  private syncCurrentRoundBattlefield(snapshot: ReturnType<SanGuoGame["getSnapshot"]>): void {
    trackRoundBattlefield(this.roundBattlefieldHistory, snapshot.turn, buildBattlefieldLines(snapshot.players), this.maxContextRounds);
  }

  private getPreviousRoundPromptContexts(currentRound: number): RoundPromptContext[] {
    return buildRoundContexts(this.logs, this.roundBattlefieldHistory, currentRound, this.maxContextRounds);
  }

  private restart(): void {
    this.aiLoop.stop();
    this.localAiEngine.reset();
    this.logs = [];
    this.chatMessages = [];
    this.pendingAction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.commandBuffer = null;
    this.closeDisplayOverlay();
    this.targetOptions = [];
    this.actionOptions = [];
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
    this.initSetup();
    this.refresh();
  }

  private shutdown(): void {
    if (this.renderer) {
      this.renderer.destroy();
    }
    process.exit(0);
  }

  private labelPlayer(playerId: string): string {
    const player = this.game.getSnapshot().players.find((item) => item.id === playerId);
    return player ? player.name : playerId;
  }

  private toOptionIndex(event: KeyEvent): number | null {
    if (!event.name) {
      return null;
    }
    if (!/^\d+$/.test(event.name)) {
      return null;
    }
    const value = Number(event.name);
    if (!Number.isInteger(value) || value <= 0) {
      return null;
    }
    return value - 1;
  }

  private handleCommandInput(event: KeyEvent): boolean {
    if (this.commandBuffer !== null) {
      if (event.name === "escape") {
        this.commandBuffer = null;
        this.refresh();
        return true;
      }
      if (event.name === "backspace") {
        this.commandBuffer = this.commandBuffer.slice(0, -1);
        this.refresh();
        return true;
      }
      if (event.name === "return" || event.name === "linefeed") {
        const command = this.commandBuffer.trim();
        this.commandBuffer = null;
        this.executeCommand(command);
        this.refresh();
        return true;
      }
      const char = this.toCommandChar(event);
      if (char !== null) {
        this.commandBuffer += char;
        this.refresh();
      }
      return true;
    }
    const start = this.toCommandChar(event);
    if (start === "/" || start === ":" || start === "：") {
      this.commandBuffer = start;
      this.refresh();
      return true;
    }
    return false;
  }

  private executeCommand(command: string): void {
    if (command.startsWith(":") || command.startsWith("：")) {
      this.addChatMessage(command.slice(1));
      return;
    }
    if (command === "/help") {
      this.openDisplayOverlay("完整规则", this.rulesLines);
      return;
    }
    if (command === "/rules") {
      this.openDisplayOverlay("完整规则", this.rulesLines);
      return;
    }
    if (command === "/close") {
      if (this.displayOverlayTitle === null) {
        this.logs.push("当前没有打开的文档");
        return;
      }
      this.closeDisplayOverlay();
      return;
    }
    if (command === "/exit") {
      this.logs.push("执行命令: /exit");
      this.shutdown();
      return;
    }
    if (command === "") {
      this.logs.push("命令为空");
      return;
    }
    this.logs.push(`未知命令: ${command}`);
  }

  private getCommandListLines(): string[] {
    return [
      "  :内容    发送聊天到右上角",
      "  /help    查看完整规则文档",
      "  /rules   查看完整规则文档",
      "  /close   关闭当前文档",
      "  /exit    退出游戏",
    ];
  }

  private addChatMessage(rawContent: string): void {
    const normalized = rawContent.replace(/\s+/g, " ").trim();
    if (normalized.length === 0) {
      this.logs.push("聊天内容不能为空");
      return;
    }
    const content = Array.from(normalized).slice(0, MAX_CHAT_LENGTH).join("");
    const sender = this.mode === "setup"
      ? this.options.initOptions.humanName ?? "你"
      : this.game.getSnapshot().players.find((player) => !player.isAI)?.name ?? "你";
    this.chatMessages.push({ sender, content });
    if (this.chatMessages.length > MAX_CHAT_MESSAGES) {
      this.chatMessages.splice(0, this.chatMessages.length - MAX_CHAT_MESSAGES);
    }
  }

  private loadRulesLines(): string[] {
    try {
      const content = readFileSync(resolve(process.cwd(), "rules.md"), "utf-8");
      const lines = content.split(/\r?\n/);
      return lines.length > 0 ? lines : ["rules.md 为空"];
    } catch {
      return ["未找到 rules.md，请先创建规则文件"];
    }
  }

  private initSetup(): void {
    const preferredCountSource = this.options.initOptions.playerCount ?? (this.options.initOptions.aiCount ?? 2) + 1;
    this.setupPlayerCount = Math.min(6, Math.max(2, Math.floor(preferredCountSource)));
    this.setupRole = PlayerRole.Lord;
    this.setupGeneralName = "待选择";
    this.setupGeneralCandidates = [];
    this.setupGeneralAssignments = {};
    this.setupAiModel = "qwen";
    this.setupOllamaModel = "gemma4:latest";
    this.setupOllamaModels = [];
    this.setupOllamaLoading = false;
    this.setupOllamaLoadError = null;
    this.setupStage = "player-count";
    this.mode = "setup";
    this.focusArea = "display";
    this.updateFocusFrame();
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.displayFollowLatest = true;
    this.actionPage = 0;
    this.statusPage = 0;
  }

  private refreshSetupViews(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView) {
      return;
    }
    const usingOllama = this.setupAiModel === "ollama";
    const stageTitle =
      this.setupStage === "player-count"
        ? "步骤1/5：选择游玩人数"
        : this.setupStage === "role"
          ? "步骤2/5：选择身份"
          : this.setupStage === "general"
              ? `步骤3/5：从 ${this.setupRole === PlayerRole.Lord ? 5 : 3} 名候选中选择武将`
              : this.setupStage === "ai-model"
                ? "步骤4/5：选择默认AI模型"
                : this.setupStage === "ollama-model"
                  ? "步骤5/6：选择Ollama模型"
                  : usingOllama
                    ? "步骤6/6：开始游戏"
                    : "步骤5/5：开始游戏";
    const leftLines: string[] = [];
    if (this.setupStage === "player-count") {
      leftLines.push("› 创建一场本地对局");
      leftLines.push("");
      leftLines.push("从右侧选择游玩人数，随后配置身份、武将与 AI。");
    } else {
      leftLines.push("› 对局配置");
      leftLines.push("");
      leftLines.push(stageTitle);
      leftLines.push("");
      leftLines.push(`  players:  ${this.setupPlayerCount}`);
      leftLines.push(`  roles:    ${this.getRoleDistributionText(this.setupPlayerCount)}`);
      leftLines.push(`  identity: ${this.setupRole}`);
      leftLines.push(`  kingdom:  ${this.generalLibrary.find((general) => general.name === this.setupGeneralName)?.kingdom ?? "待选择"}`);
      leftLines.push(`  general:  ${this.setupGeneralName}`);
      leftLines.push(`  model:    ${this.getAiModelLabel(this.setupAiModel)}`);
      if (this.setupAiModel === "ollama") {
        leftLines.push(`  ollama:   ${this.setupOllamaModel}`);
      }
      leftLines.push("");
      leftLines.push("b 返回上一步");
    }

    const actionLines: string[] = [];
    if (this.commandBuffer !== null) {
      actionLines.push(`› ${this.commandBuffer}`);
      actionLines.push("  Enter 执行 · Esc 取消");
      actionLines.push("");
      actionLines.push("commands");
      actionLines.push(...this.getCommandListLines());
    } else {
      const options = this.getSetupOptions();
      options.forEach((label, index) => {
        actionLines.push(`  ${index + 1}  ${label}`);
      });
      if (this.setupStage === "ollama-model" && this.setupOllamaLoadError) {
        actionLines.push(`读取失败：${this.setupOllamaLoadError}`);
      }
      actionLines.push("");
      actionLines.push("› 输入编号 · / 打开命令 · : 输入聊天");
    }

    const rightLines: string[] = ["waiting", "", "战场将在开始游戏后显示。"];
    const displayPageSize = this.getBodyPageSize();
    const actionPageSize = this.getBodyPageSize();
    const statusPageSize = Math.max(4, this.getBodyPageSize() - CHAT_PANEL_HEIGHT - 1);
    const displaySource = this.displayOverlayTitle
      ? buildDisplayLines(this.logs, { title: this.displayOverlayTitle, lines: this.displayOverlayLines })
      : leftLines;
    const displayViewLines = this.renderPagedArea({
      lines: displaySource,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;
    const actionViewLines = this.renderPagedArea({
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;
    const statusViewLines = this.renderPagedArea({
      lines: rightLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    if (this.chatView) {
      this.chatView.content = buildChatLines(this.chatMessages).join("\n");
    }
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private async handleSetupInput(event: KeyEvent): Promise<void> {
    if (this.setupStage !== "player-count" && event.name === "b") {
      if (this.setupStage === "role") {
        this.setupStage = "player-count";
      } else if (this.setupStage === "general") {
        this.setupStage = "role";
      } else if (this.setupStage === "ai-model") {
        this.setupStage = "general";
      } else if (this.setupStage === "ollama-model") {
        this.setupStage = "ai-model";
      } else {
        this.setupStage = this.setupAiModel === "ollama" ? "ollama-model" : "ai-model";
      }
      this.refresh();
      return;
    }
    const picked = this.toOptionIndex(event);
    if (picked === null) {
      return;
    }
    if (this.setupStage === "player-count") {
      const counts = this.getPlayerCountOptions();
      const count = counts[picked];
      if (!count) {
        return;
      }
      this.setupPlayerCount = count;
      const roles = this.getRoleOptions();
      if (!roles.includes(this.setupRole)) {
        this.setupRole = roles[0] ?? PlayerRole.Lord;
      }
      this.setupStage = "role";
      this.refresh();
      return;
    }
    if (this.setupStage === "role") {
      const roles = this.getRoleOptions();
      const role = roles[picked];
      if (!role) {
        return;
      }
      this.setupRole = role;
      this.prepareGeneralDraft();
      this.setupStage = "general";
      this.refresh();
      return;
    }
    if (this.setupStage === "general") {
      const pickedGeneral = this.setupGeneralCandidates[picked];
      if (!pickedGeneral) {
        return;
      }
      this.setupGeneralName = pickedGeneral.name;
      this.setupStage = "ai-model";
      this.refresh();
      return;
    }
    if (this.setupStage === "ai-model") {
      const models = this.getAiModelOptions();
      const model = models[picked];
      if (!model) {
        return;
      }
      this.setupAiModel = model;
      if (model === "ollama") {
        this.setupStage = "ollama-model";
        this.refresh();
        await this.loadOllamaModelsForSetup();
        return;
      }
      this.setupStage = "start";
      this.refresh();
      return;
    }
    if (this.setupStage === "ollama-model") {
      if (this.setupOllamaLoading) {
        return;
      }
      const options = this.getSetupOptions();
      const selected = options[picked];
      if (!selected) {
        return;
      }
      if (selected === "重新读取本地模型列表") {
        await this.loadOllamaModelsForSetup();
        return;
      }
      if (selected === "使用默认模型（gemma4:latest）") {
        this.setupOllamaModel = "gemma4:latest";
      } else {
        this.setupOllamaModel = selected;
      }
      this.setupStage = "start";
      this.refresh();
      return;
    }
    if (this.setupStage === "start" && picked === 0) {
      void this.startConfiguredGame();
    }
  }

  private getSetupOptions(): string[] {
    if (this.setupStage === "player-count") {
      return this.getPlayerCountOptions().map((count) => `${count} 人局（${this.getRoleDistributionText(count)}）`);
    }
    if (this.setupStage === "role") {
      return this.getRoleOptions();
    }
    if (this.setupStage === "general") {
      return this.setupGeneralCandidates.map((general) => {
        const skills = general.skills.length > 0 ? general.skills.join("、") : "无技能";
        return `${general.name}[${general.kingdom}] ${general.maxHp}体力（${skills}）`;
      });
    }
    if (this.setupStage === "ai-model") {
      return this.getAiModelOptions().map((model) => {
        const desc = model === "simple" ? "本地简单逻辑引擎" : model === "ollama" ? "本地 Ollama 模型" : "云端 Qwen 模型";
        return `${this.getAiModelLabel(model)}（${desc}）`;
      });
    }
    if (this.setupStage === "ollama-model") {
      if (this.setupOllamaLoading) {
        return ["正在读取本地 Ollama 模型..."];
      }
      if (this.setupOllamaLoadError) {
        return ["重新读取本地模型列表", "使用默认模型（gemma4:latest）"];
      }
      if (this.setupOllamaModels.length <= 0) {
        return ["重新读取本地模型列表", "使用默认模型（gemma4:latest）"];
      }
      return this.setupOllamaModels;
    }
    return ["开始游戏"];
  }

  private async loadOllamaModelsForSetup(): Promise<void> {
    this.setupOllamaLoading = true;
    this.setupOllamaLoadError = null;
    this.refresh();
    try {
      const models = await this.aiLoop.getAvailableOllamaModels();
      this.setupOllamaModels = models;
      if (models.length > 0) {
        this.setupOllamaModel = models[0] ?? this.setupOllamaModel;
      }
      if (models.length <= 0) {
        this.setupOllamaLoadError = "未读取到可用模型";
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.setupOllamaLoadError = reason.replace(/\s+/g, " ").trim();
      this.setupOllamaModels = [];
    } finally {
      this.setupOllamaLoading = false;
      this.refresh();
    }
  }

  private getPlayerCountOptions(): number[] {
    return [2, 3, 4, 5, 6];
  }

  private getRoleOptions(): PlayerRole[] {
    if (this.setupPlayerCount === 2) {
      return [PlayerRole.Lord, PlayerRole.Rebel];
    }
    if (this.setupPlayerCount === 3) {
      return [PlayerRole.Lord, PlayerRole.Rebel, PlayerRole.Traitor];
    }
    return [PlayerRole.Lord, PlayerRole.Loyalist, PlayerRole.Rebel, PlayerRole.Traitor];
  }

  private prepareGeneralDraft(): void {
    const draft = this.game.createDefaultGeneralDraft(this.setupPlayerCount, this.setupRole);
    const humanSeat = draft.find((seat) => seat.playerId === "human");
    this.setupGeneralCandidates = humanSeat?.candidates ?? [];
    this.setupGeneralName = this.setupGeneralCandidates[0]?.name ?? (this.generalLibrary[0]?.name ?? "孙策");
    this.setupGeneralAssignments = {};
    for (const seat of draft) {
      if (seat.playerId === "human") {
        continue;
      }
      const selected = seat.candidates[0];
      if (selected) {
        this.setupGeneralAssignments[seat.playerId] = selected.name;
      }
    }
  }

  private getAiModelOptions(): SetupAiModel[] {
    return ["simple", "ollama", "qwen"];
  }

  private getAiModelLabel(model: SetupAiModel): string {
    if (model === "simple") {
      return "Simple AI";
    }
    return model === "ollama" ? "Ollama" : "Qwen";
  }

  private getRoleDistributionText(playerCount: number): string {
    if (playerCount === 2) {
      return "反贼1 忠臣0 内奸0";
    }
    if (playerCount === 3) {
      return "反贼1 忠臣0 内奸1";
    }
    if (playerCount === 4) {
      return "反贼1 忠臣1 内奸1";
    }
    if (playerCount === 5) {
      return "反贼2 忠臣1 内奸1";
    }
    return "反贼3 忠臣1 内奸1";
  }

  private async startConfiguredGame(): Promise<void> {
    this.aiLoop.stop();
    this.localAiEngine.reset();
    if (this.setupAiModel === "ollama" || this.setupAiModel === "qwen") {
      this.aiLoop.setPreferredProvider(this.setupAiModel);
      this.aiLoop.setPreferredOllamaModel(this.setupAiModel === "ollama" ? this.setupOllamaModel : null);
    } else {
      this.aiLoop.setPreferredProvider("ollama");
      this.aiLoop.setPreferredOllamaModel(null);
    }
    this.logs = [];
    this.pendingAction = null;
    this.pendingInteraction = null;
    this.pendingTargetId = null;
    this.targetCardOptions = [];
    this.targetOptions = [];
    this.actionOptions = [];
    this.commandBuffer = null;
    this.roundBattlefieldHistory.clear();
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.actionPage = 0;
    this.statusPage = 0;
    const initLogs = await this.game.initDefaultGame({
      ...this.options.initOptions,
      playerCount: this.setupPlayerCount,
      aiCount: this.setupPlayerCount - 1,
      humanRole: this.setupRole,
      humanGeneral: this.setupGeneralName,
      generalAssignments: this.setupGeneralAssignments,
    }, false);
    this.logs.push(...initLogs);
    const subAgentCount = this.aiLoop.start(this.game.getSnapshot());
    const providerText =
      this.setupAiModel === "ollama"
        ? `Ollama(${this.setupOllamaModel})`
        : this.setupAiModel === "simple"
          ? "Simple AI(本地逻辑引擎)"
          : this.getAiModelLabel(this.setupAiModel);
    this.logs.push(`AI 决策环已启动，默认模型 ${providerText}，创建 ${subAgentCount} 个 subagent`);
    if (this.setupAiModel === "simple") {
      this.logs.push(`AI 驱动: 使用本地AI（${this.localAiEngine.getMemorySummary()}）`);
    } else {
      void this.logAiLoopStatus();
    }
    this.game.setDecisionHandler("human", (request) => {
      return new Promise<InteractionDecision>((resolve) => {
        this.pendingInteraction = { request, resolve };
        this.mode = "response";
        this.refresh();
      });
    });
    // 所有 AI 驱动都必须处理选牌与可选技能；纯概率花色选择仍交给引擎。
    for (const player of this.game.getSnapshot().players) {
      if (!player.isAI) {
        continue;
      }
      const aiId = player.id;
      this.game.setDecisionHandler(aiId, async (request) => {
        if (request.kind === "choose-suit") {
          return null;
        }
        return this.setupAiModel === "simple"
          ? this.localAiEngine.decideInteraction(this.game, aiId, request)
          : this.aiLoop.decideInteraction(this.game, aiId, request);
      });
    }
    this.mode = "action";
    this.logs.push(...(await this.game.startTurn()));
    void this.resolveAiTurns();
    this.refresh();
  }

  private async logAiLoopStatus(): Promise<void> {
    const probe = await this.aiLoop.probe();
    const detail = probe.detail.replace(/\s+/g, " ").trim().slice(0, 72);
    if (probe.available) {
      this.logs.push(`AI 驱动: ${probe.driverLabel} 已连接成功（${detail}）`);
    } else {
      this.logs.push(`AI 驱动: 使用本地AI（${probe.driverLabel} 不可用：${detail}）`);
    }
    this.refresh();
  }

  private async playAndAppendLogs(
    playerId: string,
    action: GameAction,
    targetId?: string,
    delayMs?: number,
    selectedCardId?: string,
  ): Promise<void> {
    this.busy = true;
    try {
      const logs = await this.game.playAction(playerId, action, targetId, selectedCardId);
      const stepDelay = delayMs ?? (playerId === "human" ? 100 : 200);
      for (const line of logs) {
        this.logs.push(line);
        this.refresh();
        await this.delay(stepDelay);
      }
    } finally {
      this.busy = false;
    }
  }

    private async handleInteractionChoice(picked: number): Promise<void> {
    const pending = this.pendingInteraction;
    if (!pending) {
      this.mode = "action";
      this.refresh();
      return;
    }
    const { request, resolve } = pending;
    this.pendingInteraction = null;
    const decision = this.buildInteractionDecision(request, picked);
    this.mode = "action";
    this.refresh();
    await this.delay(50);
    resolve(decision);
    await this.resolveAiTurns();
  }

  private buildInteractionDecision(request: InteractionRequest, picked: number): InteractionDecision {
    if (request.kind === "respond") {
      const source = request.sources[picked];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    if (request.kind === "collateral") {
      const victimId = request.victims[picked];
      if (!victimId) {
        return { choice: "pass" };
      }
      const firstSlash = request.sources[0];
      return { choice: "target", targetId: victimId, ...(firstSlash ? { sourceId: firstSlash.sourceId } : {}) };
    }
    if (request.kind === "choose-discard" || request.kind === "choose-card") {
      const source = request.sources[picked];
      return source ? { choice: "card", sourceId: source.sourceId } : { choice: "pass" };
    }
    if (request.kind === "choose-suit") {
      const suit = request.suits[picked] ?? request.suits[0] ?? "heart";
      return { choice: "suit", suit };
    }
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: picked === 0 };
    }
    return { choice: "pass" };
  }

  private isSnatchAction(action: TargetAction | null): boolean {
    if (!action || action.type !== "play") {
      return false;
    }
    return extractCardTypeFromAction(action) === CardType.Snatch;
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolveDelay) => {
      setTimeout(resolveDelay, ms);
    });
  }

  private openDisplayOverlay(title: string, lines: string[]): void {
    this.displayOverlayTitle = title;
    this.displayOverlayLines = lines;
    this.displayPage = 0;
  }

  private closeDisplayOverlay(): void {
    this.displayOverlayTitle = null;
    this.displayOverlayLines = [];
    this.displayPage = 0;
  }

  private renderPagedArea(input: {
    lines: string[];
    page: number;
    pageSize: number;
    focused: boolean;
  }): { lines: string[]; page: number; totalPages: number } {
    const totalPages = Math.max(1, Math.ceil(input.lines.length / input.pageSize));
    const page = Math.min(Math.max(input.page, 0), totalPages - 1);
    const start = page * input.pageSize;
    const end = start + input.pageSize;
    const body = input.lines.slice(start, end);
    while (body.length < input.pageSize) {
      body.push("");
    }
    const output: string[] = [];
    const hint = input.focused ? "›" : " ";
    output.push(`${hint} page ${page + 1}/${totalPages}${input.focused ? " · ↑↓ 翻页" : ""}`);
    output.push(...body);
    return { lines: output, page, totalPages };
  }

  private getBodyPageSize(): number {
    const rows = process.stdout.rows ?? 40;
    const reserved = 14;
    const pageSize = rows - reserved;
    return Math.max(4, pageSize);
  }

  private getMaxPage(totalLines: number, pageSize: number): number {
    if (pageSize <= 0) {
      return 0;
    }
    const totalPages = Math.max(1, Math.ceil(totalLines / pageSize));
    return totalPages - 1;
  }

  private handleAreaPagingInput(event: KeyEvent): boolean {
    if (!event.name) {
      return false;
    }
    if (event.name === "left") {
      this.switchFocus(-1);
      this.refresh();
      return true;
    }
    if (event.name === "right") {
      this.switchFocus(1);
      this.refresh();
      return true;
    }
    if (event.name === "up") {
      this.changeFocusedPage(-1);
      this.refresh();
      return true;
    }
    if (event.name === "down") {
      this.changeFocusedPage(1);
      this.refresh();
      return true;
    }
    return false;
  }

  private switchFocus(step: -1 | 1): void {
    const order: FocusArea[] = ["display", "action", "status"];
    const index = order.indexOf(this.focusArea);
    const next = (index + step + order.length) % order.length;
    this.focusArea = order[next] ?? "display";
    this.updateFocusFrame();
  }

  private changeFocusedPage(step: -1 | 1): void {
    if (this.focusArea === "display") {
      const displayLines = buildDisplayLines(this.logs, {
        title: this.displayOverlayTitle,
        lines: this.displayOverlayLines,
      });
      const displayPageSize = this.getBodyPageSize();
      const maxPage = this.getMaxPage(displayLines.length, displayPageSize);
      const nextPage = Math.min(Math.max(this.displayPage + step, 0), maxPage);
      this.displayPage = nextPage;
      if (this.displayOverlayTitle === null) {
        this.displayFollowLatest = nextPage >= maxPage;
      }
      return;
    }
    if (this.focusArea === "action") {
      this.actionPage = Math.max(0, this.actionPage + step);
      return;
    }
    this.statusPage = Math.max(0, this.statusPage + step);
  }

  private updateFocusFrame(): void {
    if (!this.displayColumn || !this.actionColumn || !this.statusColumn) {
      return;
    }
    this.displayColumn.borderColor = this.focusArea === "display" ? CODEX_THEME.accent : CODEX_THEME.border;
    this.actionColumn.borderColor = this.focusArea === "action" ? CODEX_THEME.accent : CODEX_THEME.border;
    this.statusColumn.borderColor = this.focusArea === "status" ? CODEX_THEME.accent : CODEX_THEME.border;
    this.displayColumn.backgroundColor = this.focusArea === "display" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    this.actionColumn.backgroundColor = this.focusArea === "action" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    this.statusColumn.backgroundColor = this.focusArea === "status" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    if (this.battlefieldView) {
      this.battlefieldView.bg = this.focusArea === "display" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    }
    if (this.actionView) {
      this.actionView.bg = this.focusArea === "action" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    }
    if (this.logsView) {
      this.logsView.bg = this.focusArea === "status" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    }
    if (this.chatView) {
      this.chatView.bg = this.focusArea === "status" ? CODEX_THEME.surfaceFocused : CODEX_THEME.surface;
    }
    this.displayColumn.title = this.focusArea === "display" ? " › 对局记录 " : " 对局记录 ";
    this.actionColumn.title = this.focusArea === "action" ? " › 下一步 " : " 下一步 ";
    this.statusColumn.title = this.focusArea === "status" ? " › 聊天 / 战场 " : " 聊天 / 战场 ";
  }

  private toCommandChar(event: KeyEvent): string | null {
    if (event.sequence && !/[\u0000-\u001f\u007f]/.test(event.sequence)) {
      return event.sequence;
    }
    if (!event.name || Array.from(event.name).length !== 1 || /[\u0000-\u001f\u007f]/.test(event.name)) {
      return null;
    }
    return event.name;
  }
}
