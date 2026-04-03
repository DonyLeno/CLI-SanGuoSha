import { BoxRenderable, KeyEvent, TextRenderable, createCliRenderer } from "@opentui/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CardType } from "../engine/cards.js";
import {
  GameAction,
  GameInitOptions,
  Player,
  PlayerRole,
  ResponseKind,
  ResponseOption,
  SanGuoGame,
  SkillName,
} from "../engine/game.js";

type InputMode = "setup" | "action" | "target" | "response" | "gameover";

type SetupStage = "player-count" | "role" | "kingdom" | "general" | "start";

type Kingdom = "魏" | "蜀" | "吴" | "群雄";

type FocusArea = "display" | "action" | "status";

type AppOptions = {
  initOptions: Partial<GameInitOptions>;
};

type TargetAction = Exclude<GameAction, { type: "end" }>;

type PendingAiResponse = {
  actorId: string;
  action: GameAction;
  targetId: string;
  responseKind: ResponseKind;
  cardName: string;
  options: ResponseOption[];
};

export class CliSanGuoApp {
  private readonly game: SanGuoGame;

  private renderer?: Awaited<ReturnType<typeof createCliRenderer>>;

  private battlefieldView?: TextRenderable;

  private actionView?: TextRenderable;

  private logsView?: TextRenderable;

  private displayColumn?: BoxRenderable;

  private actionColumn?: BoxRenderable;

  private statusColumn?: BoxRenderable;

  private logs: string[];

  private mode: InputMode;

  private actionOptions: GameAction[];

  private targetOptions: Player[];

  private pendingAction: TargetAction | null;

  private pendingAiResponse: PendingAiResponse | null;

  private commandBuffer: string | null;

  private readonly options: AppOptions;

  private readonly generalLibrary: ReturnType<SanGuoGame["getGeneralLibrary"]>;

  private readonly rulesLines: string[];

  private displayOverlayTitle: string | null;

  private displayOverlayLines: string[];

  private displayPage: number;

  private actionPage: number;

  private statusPage: number;

  private setupStage: SetupStage;

  private setupPlayerCount: number;

  private setupRole: PlayerRole;

  private setupKingdom: Kingdom;

  private setupGeneralName: string;

  private focusArea: FocusArea;

  private busy: boolean;

  constructor(game: SanGuoGame, options: AppOptions) {
    this.game = game;
    this.options = options;
    this.logs = [];
    this.mode = "setup";
    this.actionOptions = [];
    this.targetOptions = [];
    this.pendingAction = null;
    this.pendingAiResponse = null;
    this.commandBuffer = null;
    this.generalLibrary = this.game.getGeneralLibrary();
    this.rulesLines = this.loadRulesLines();
    this.displayOverlayTitle = null;
    this.displayOverlayLines = [];
    this.displayPage = 0;
    this.actionPage = 0;
    this.statusPage = 0;
    this.setupStage = "player-count";
    this.setupPlayerCount = 3;
    this.setupRole = PlayerRole.Lord;
    this.setupKingdom = "吴";
    this.setupGeneralName = this.generalLibrary[0]?.name ?? "孙策";
    this.focusArea = "display";
    this.busy = false;
  }

  async start(): Promise<void> {
    this.renderer = await createCliRenderer({
      exitOnCtrlC: true,
      consoleMode: "disabled",
      screenMode: "alternate-screen",
      useMouse: false,
    });

    const rootBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      border: true,
      title: "CLI SanGuo",
      padding: 1,
      flexDirection: "row",
    });

    this.displayColumn = new BoxRenderable(this.renderer, {
      width: "40%",
      height: "100%",
      border: true,
      title: "显示区",
      padding: 1,
      flexDirection: "column",
    });

    this.actionColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      title: "操作区",
      padding: 1,
      flexDirection: "column",
    });

    this.statusColumn = new BoxRenderable(this.renderer, {
      width: "30%",
      height: "100%",
      border: true,
      title: "战场状态",
      padding: 1,
      flexDirection: "column",
    });

    const displayBox = new BoxRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.battlefieldView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    this.actionView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    this.logsView = new TextRenderable(this.renderer, {
      width: "100%",
      height: "100%",
      content: "",
    });

    displayBox.add(this.battlefieldView);
    this.actionColumn.add(this.actionView);
    this.statusColumn.add(this.logsView);
    this.displayColumn.add(displayBox);
    rootBox.add(this.displayColumn);
    rootBox.add(this.actionColumn);
    rootBox.add(this.statusColumn);
    this.renderer.root.add(rootBox);
    this.renderer.keyInput.on("keypress", (event) => this.onKeyPress(event));
    this.updateFocusFrame();

    this.initSetup();
    this.refresh();
    this.renderer.start();
  }

  private onKeyPress(event: KeyEvent): void {
    if (this.busy) {
      return;
    }
    if (this.handleCommandInput(event)) {
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
      this.handleSetupInput(event);
      return;
    }
    if (this.mode === "response") {
      const pickedResponse = this.toOptionIndex(event);
      if (pickedResponse === null) {
        return;
      }
      void this.handlePendingResponseChoice(pickedResponse);
      return;
    }
    if (this.mode === "target" && event.name === "b") {
      this.pendingAction = null;
      this.targetOptions = [];
      this.mode = "action";
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
    }
  }

  private async handleActionChoice(action: GameAction): Promise<void> {
    const current = this.game.getCurrentPlayer();
    if (action.type === "end") {
      await this.playAndAppendLogs(current.id, action);
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
    const current = this.game.getCurrentPlayer();
    await this.playAndAppendLogs(current.id, this.pendingAction, targetId);
    this.pendingAction = null;
    this.targetOptions = [];
    this.mode = "action";
    await this.resolveAiTurns();
  }

  private async resolveAiTurns(): Promise<void> {
    while (!this.game.getSnapshot().gameOver && this.game.getCurrentPlayer().isAI) {
      const ai = this.game.getCurrentPlayer();
      const decision = this.game.getBestAiDecision(ai.id);
      if (!decision) {
        break;
      }
      const response = this.buildPendingResponse(decision);
      if (response) {
        this.pendingAiResponse = response;
        this.mode = "response";
        this.refresh();
        return;
      }
      await this.playAndAppendLogs(ai.id, decision.action, decision.targetId);
    }
    this.mode = this.game.getSnapshot().gameOver ? "gameover" : "action";
    this.refresh();
  }

  private refresh(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView) {
      return;
    }
    if (this.mode === "setup") {
      this.refreshSetupViews();
      return;
    }
    const snapshot = this.game.getSnapshot();
    if (!snapshot.gameOver) {
      const current = this.game.getCurrentPlayer();
      this.actionOptions = current.isAI ? [] : this.game.getPlayableActions(current.id);
    } else {
      this.actionOptions = [];
    }
    const statusLines = this.buildStatusLines(snapshot);

    const actionLines: string[] = [];
    actionLines.push("输入:");
    if (this.commandBuffer !== null) {
      actionLines.push(`命令模式: ${this.commandBuffer}`);
      actionLines.push("回车执行，退格删除，Esc 取消");
    } else if (this.mode === "action") {
      this.actionOptions.forEach((action, index) => {
        actionLines.push(`${index + 1}. ${action.label}`);
      });
      if (this.actionOptions.length === 0) {
        actionLines.push("等待 AI 执行...");
      }
    } else if (this.mode === "target") {
      actionLines.push(`当前操作: ${this.pendingAction ? this.pendingAction.label : "选择目标"}`);
      this.targetOptions.forEach((target, index) => {
        actionLines.push(
          `${index + 1}. 目标 ${target.name} | HP ${Math.max(target.hp, 0)}/${target.maxHp} | 手牌 ${target.hand.length} 张`,
        );
      });
      actionLines.push("按 b 返回上一步");
    } else if (this.mode === "response") {
      const responseInfo = this.pendingAiResponse;
      actionLines.push("你成为了指向型牌目标，请选择应对：");
      if (responseInfo) {
        actionLines.push(`来牌: ${responseInfo.cardName}（来自 ${this.labelPlayer(responseInfo.actorId)}）`);
        if (responseInfo.options.length > 0) {
          responseInfo.options.forEach((option, index) => {
            actionLines.push(`${index + 1}. ${option.label}`);
          });
          actionLines.push(`${responseInfo.options.length + 1}. 不应对`);
        } else {
          actionLines.push("你当前没有可用应对牌。");
          actionLines.push("1. 继续结算（不应对）");
        }
      }
    } else {
      actionLines.push("按 r 重开，或输入 /exit 退出");
    }
    actionLines.push("输入 / 进入命令模式");

    const displayPageSize = this.getBodyPageSize("display");
    const actionPageSize = this.getBodyPageSize("action");
    const statusPageSize = this.getBodyPageSize("status");
    const displayLines: string[] = this.buildDisplayLines();
    const displayViewLines = this.renderPagedArea({
      title: "显示区",
      lines: displayLines,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;

    const actionViewLines = this.renderPagedArea({
      title: "操作区",
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;

    const statusViewLines = this.renderPagedArea({
      title: "战场状态",
      lines: statusLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private buildDisplayLines(): string[] {
    if (this.displayOverlayTitle !== null) {
      const lines: string[] = [];
      lines.push(`【${this.displayOverlayTitle}】`);
      lines.push("输入 /close 关闭当前文档");
      lines.push("");
      lines.push(...this.displayOverlayLines);
      return lines;
    }
    const lines: string[] = [];
    lines.push("输入“/”进入命令模式，建议先用 /help 查看帮助文档");
    lines.push("");
    lines.push("最近记录:");
    const latest = this.logs.slice(-100);
    for (const item of latest) {
      lines.push(`- ${item}`);
    }
    return lines;
  }

  private buildStatusLines(snapshot: ReturnType<SanGuoGame["getSnapshot"]>): string[] {
    const statusLines: string[] = [];
    statusLines.push(`回合: ${snapshot.turn}`);
    statusLines.push(`当前玩家: ${this.labelPlayer(snapshot.currentPlayerId)}`);
    statusLines.push(`阶段: ${snapshot.phase}`);
    statusLines.push(`牌堆: ${snapshot.deckCount}  弃牌堆: ${snapshot.discardCount}`);
    statusLines.push("");
    statusLines.push("玩家状态:");
    for (const player of snapshot.players) {
      const status = player.alive ? "存活" : "阵亡";
      const identity = !player.alive ? player.role : player.role === PlayerRole.Lord ? PlayerRole.Lord : "未知";
      const hand = player.isAI ? `${player.hand.length} 张` : this.describeHand(player.hand);
      const skills = player.skills.length > 0 ? player.skills.join("、") : "无";
      const weapon = player.weapon ?? "无";
      const armor = player.armor ?? "无";
      const attackHorse = player.attackHorse ?? "无";
      const defenseHorse = player.defenseHorse ?? "无";
      const treasure = player.treasure ?? "无";
      statusLines.push(
        `- ${player.name}[${player.general}] | 身份 ${identity} | HP ${Math.max(player.hp, 0)}/${player.maxHp} | 手牌 ${hand} | 装备 武器:${weapon} 防具:${armor} +1马:${defenseHorse} -1马:${attackHorse} 宝物:${treasure} | 技能 ${skills} | ${status}`,
      );
    }
    if (snapshot.gameOver) {
      statusLines.push("");
      if (snapshot.winner === "human") {
        statusLines.push("结果: 主公获胜");
      } else if (snapshot.winner === "ai") {
        statusLines.push("结果: 反贼获胜");
      } else {
        statusLines.push("结果: 平局");
      }
    }
    return statusLines;
  }

  private restart(): void {
    this.logs = [];
    this.pendingAction = null;
    this.commandBuffer = null;
    this.closeDisplayOverlay();
    this.targetOptions = [];
    this.actionOptions = [];
    this.displayPage = 0;
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

  private describeHand(cards: Player["hand"]): string {
    if (cards.length === 0) {
      return "0 张";
    }
    return cards.map((card, index) => `${index + 1}:${card.type}`).join(" ");
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
    if (start === "/") {
      this.commandBuffer = "/";
      this.refresh();
      return true;
    }
    return false;
  }

  private executeCommand(command: string): void {
    if (command === "/help") {
      this.openDisplayOverlay("帮助文档", this.getHelpLines());
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

  private getHelpLines(): string[] {
    const lines: string[] = [];
    lines.push("=== 帮助 ===");
    lines.push("【1）玩法】");
    lines.push("- 开局先选人数、身份、武将，再进入对局。");
    lines.push("- 出牌阶段可使用手牌或技能；需要目标时先选目标。");
    lines.push("- 体力归 0 时会尝试用桃自救，否则阵亡。");
    lines.push("- 身份胜利条件请参考 /rules。");
    lines.push("【2）所有命令】");
    lines.push("- /help 分页查看完整帮助");
    lines.push("- /rules 查看完整规则文档");
    lines.push("- /exit 退出游戏");
    lines.push("【3）卡牌功能说明】");
    lines.push("- 杀：对1名其他角色造成1点伤害，可被闪抵消。");
    lines.push("- 闪：仅用于响应杀，抵消伤害。");
    lines.push("- 桃：回复1点体力。");
    lines.push("- 过河拆桥：弃置1名其他角色的1张牌（手牌或装备）。");
    lines.push("- 顺手牵羊：获得1名其他角色的1张牌（手牌或装备）。");
    lines.push("- 决斗：与你指定目标轮流打出杀，先打不出者受1点伤害。");
    lines.push("- 无中生有：立即摸2张牌。");
    lines.push("- 南蛮入侵：其他角色各需打出1张杀，否则受1点伤害。");
    lines.push("- 万箭齐发：其他角色各需打出1张闪，否则受1点伤害。");
    lines.push("- 借刀杀人：指定1名角色，其需对他人出杀；若无法出杀，你获得其1张牌。");
    lines.push("- 无懈可击：用于抵消以你为目标的锦囊效果（自动触发）。");
    lines.push("- 桃园结义：所有存活角色各回复1点体力。");
    lines.push("- 五谷丰登：所有存活角色各摸1张牌。");
    lines.push("- 装备规则：武器/防具/宝物各限1件，+1马与-1马各限1件；新装备替换旧装备，旧装备直接弃置。");
    lines.push("- 诸葛连弩（武器1）：出牌阶段使用杀无次数限制。");
    lines.push("- 雌雄双股剑（武器2）：对异性角色使用杀时，其弃1手牌或你摸1牌。");
    lines.push("- 青釭剑（武器2）：你的杀无视目标防具效果。");
    lines.push("- 寒冰剑（武器2）：杀命中时可防止伤害，改为弃置目标2张牌。");
    lines.push("- 古锭刀（武器2）：目标无手牌时，你的杀伤害+1。");
    lines.push("- 丈八蛇矛（武器3）：可弃2张手牌当杀使用。");
    lines.push("- 青龙偃月刀（武器3）：杀被闪后可再出1张杀继续追击。");
    lines.push("- 贯石斧（武器3）：杀被闪后可弃2张牌令其强制命中。");
    lines.push("- 方天画戟（武器4）：最后1张手牌为杀时可额外指定最多2名目标。");
    lines.push("- 麒麟弓（武器5）：杀造成伤害后可弃置目标1匹马。");
    lines.push("- 八卦阵（防具）：需要闪时判定红色视为打出闪。");
    lines.push("- 仁王盾（防具）：黑色杀对你无效。");
    lines.push("- 藤甲（防具）：普通杀/南蛮/万箭对你无效。");
    lines.push("- 白银狮子（防具）：每次受到伤害至多为1；失去时回复1点体力。");
    lines.push("- 的卢/绝影/爪黄飞电（+1马）：其他角色计算与你距离+1。");
    lines.push("- 赤兔/大宛/紫骍（-1马）：你计算与其他角色距离-1。");
    lines.push("- 木牛流马（宝物）：可置入1张手牌为“粮”，可移动给其他角色，可从下方使用这些牌。");
    lines.push("【5）分页说明】");
    lines.push("- 左右箭头：切换聚焦区（显示区/操作区/战场状态）。");
    lines.push("- 上下箭头：对当前聚焦区翻页。");
    lines.push("- 聚焦区会以绿色边框高亮显示。");
    lines.push("- /help、/rules 会在显示区打开文档，输入 /close 关闭。");
    lines.push("【4）武将介绍（含技能介绍）】");
    for (const general of this.generalLibrary) {
      const skillDesc = general.skills.length > 0 ? general.skills.map((skill) => this.describeSkill(skill)).join("；") : "无技能";
      lines.push(`- ${general.name}：${skillDesc}`);
    }
    return lines;
  }

  private describeSkill(skill: SkillName): string {
    const skillDescMap: Record<SkillName, string> = {
      [SkillName.Heroic]: "摸牌阶段额外摸1张",
      [SkillName.Roar]: "出牌阶段使用杀无次数限制",
      [SkillName.Assault]: "出牌阶段每回合一次，弃1牌对1名角色造成1伤害",
      [SkillName.Guard]: "每回合首次受伤时，本次伤害-1",
      [SkillName.JianXiong]: "受到伤害后可获益（当前实现为摸1张）",
      [SkillName.HuJia]: "主公技，需要闪时可请求魏势力角色响应",
      [SkillName.QingGuo]: "可将黑色手牌当闪使用或打出",
      [SkillName.LuoShen]: "回合开始可连续判定黑色并获得判定牌",
      [SkillName.GangLie]: "受伤后判定，令来源弃2手牌或受1点伤害",
      [SkillName.LuoYi]: "摸牌阶段少摸1张，本回合杀/决斗伤害+1",
      [SkillName.TuXi]: "摸牌阶段可改为从至多两名角色各获得1张手牌",
      [SkillName.TianDu]: "你的判定牌生效后可获得之",
      [SkillName.YiJi]: "每受1点伤害摸2并可分配给任意角色",
      [SkillName.FanKui]: "受到伤害后可获得来源1张牌",
      [SkillName.GuiCai]: "任意判定生效前可用手牌替换判定牌",
      [SkillName.RenDe]: "出牌阶段可分配手牌给他人，累计给出2张可回血1",
      [SkillName.JiJiang]: "主公技，需要杀时可请求蜀势力角色响应",
      [SkillName.WuSheng]: "可将红色牌当杀使用或打出",
      [SkillName.LongDan]: "可将杀当闪、闪当杀使用或打出",
      [SkillName.MaShu]: "锁定技，你计算与其他角色距离-1",
      [SkillName.TieQi]: "杀指定目标后可判定红色令其不能打闪",
      [SkillName.GuanXing]: "回合开始可观看并调整牌堆顶若干牌顺序",
      [SkillName.KongCheng]: "锁定技，无手牌时不能成为杀或决斗目标",
      [SkillName.JiZhi]: "使用非延时锦囊时摸1张牌",
      [SkillName.QiCai]: "使用锦囊无距离限制",
      [SkillName.ZhiHeng]: "出牌阶段限一次，弃任意张并摸等量",
      [SkillName.JiuYuan]: "主公技，其他吴势力桃救你时额外回复1",
      [SkillName.FanJian]: "出牌阶段限一次，令目标猜花色并可能受伤",
      [SkillName.KuRou]: "出牌阶段可失去1点体力并摸2张牌",
      [SkillName.QianXun]: "锁定技，不能成为顺手牵羊和乐不思蜀目标",
      [SkillName.LianYing]: "失去最后手牌时摸1张牌",
      [SkillName.GuoSe]: "可将方片牌当乐不思蜀使用",
      [SkillName.LiuLi]: "成为杀目标时可弃牌将杀转移",
      [SkillName.JieYin]: "出牌阶段限一次，弃2手牌与你和1名男性角色各回复1",
      [SkillName.XiaoJi]: "失去装备区里的牌时摸2张牌",
      [SkillName.WuShuang]: "锁定技，你的杀需两闪抵消，决斗对方每次需两杀",
      [SkillName.LiJian]: "出牌阶段限一次，令两名男性角色决斗",
      [SkillName.BiYue]: "回合结束阶段摸1张牌",
      [SkillName.QingNang]: "出牌阶段限一次，弃1手牌令1名角色回复1点体力",
      [SkillName.JiJiu]: "濒死时可将红色手牌当桃使用",
    };
    return `${skill}（${skillDescMap[skill]}）`;
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
    this.setupKingdom = "吴";
    this.setupGeneralName = this.getGeneralsByKingdom(this.setupKingdom)[0]?.name ?? (this.generalLibrary[0]?.name ?? "孙策");
    this.setupStage = "player-count";
    this.mode = "setup";
    this.focusArea = "display";
    this.updateFocusFrame();
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.actionPage = 0;
    this.statusPage = 0;
  }

  private refreshSetupViews(): void {
    if (!this.battlefieldView || !this.actionView || !this.logsView) {
      return;
    }
    const stageTitle =
      this.setupStage === "player-count"
        ? "步骤1/5：选择游玩人数"
        : this.setupStage === "role"
          ? "步骤2/5：选择身份"
          : this.setupStage === "kingdom"
            ? "步骤3/5：选择势力"
          : this.setupStage === "general"
            ? "步骤4/5：选择武将"
            : "步骤5/5：开始游戏";
    const leftLines: string[] = [];
    leftLines.push("输入“/”进入命令模式，建议先用 /help 查看帮助文档");
    leftLines.push("");
    leftLines.push("开局配置");
    leftLines.push(stageTitle);
    leftLines.push("");
    leftLines.push(`- 游玩人数: ${this.setupPlayerCount}`);
    leftLines.push(`- 默认配比: ${this.getRoleDistributionText(this.setupPlayerCount)}`);
    leftLines.push(`- 我的身份: ${this.setupRole}`);
    leftLines.push(`- 势力: ${this.setupKingdom}`);
    leftLines.push(`- 我的武将: ${this.setupGeneralName}`);
    if (this.setupStage !== "player-count") {
      leftLines.push("");
      leftLines.push("按 b 返回上一步");
    }

    const actionLines: string[] = [];
    actionLines.push("输入:");
    if (this.commandBuffer !== null) {
      actionLines.push(`命令模式: ${this.commandBuffer}`);
      actionLines.push("回车执行，退格删除，Esc 取消");
    } else {
      const options = this.getSetupOptions();
      options.forEach((label, index) => {
        actionLines.push(`${index + 1}. ${label}`);
      });
      actionLines.push("输入 / 进入命令模式");
    }

    const rightLines: string[] = ["战场将在开始游戏后显示"];
    const displayPageSize = this.getBodyPageSize("display");
    const actionPageSize = this.getBodyPageSize("action");
    const statusPageSize = this.getBodyPageSize("status");
    const displaySource = this.displayOverlayTitle ? this.buildDisplayLines() : leftLines;
    const displayViewLines = this.renderPagedArea({
      title: "显示区",
      lines: displaySource,
      page: this.displayPage,
      pageSize: displayPageSize,
      focused: this.focusArea === "display",
    });
    this.displayPage = displayViewLines.page;
    const actionViewLines = this.renderPagedArea({
      title: "操作区",
      lines: actionLines,
      page: this.actionPage,
      pageSize: actionPageSize,
      focused: this.focusArea === "action",
    });
    this.actionPage = actionViewLines.page;
    const statusViewLines = this.renderPagedArea({
      title: "战场状态",
      lines: rightLines,
      page: this.statusPage,
      pageSize: statusPageSize,
      focused: this.focusArea === "status",
    });
    this.statusPage = statusViewLines.page;

    this.battlefieldView.content = displayViewLines.lines.join("\n");
    this.actionView.content = actionViewLines.lines.join("\n");
    this.logsView.content = statusViewLines.lines.join("\n");
  }

  private handleSetupInput(event: KeyEvent): void {
    if (this.setupStage !== "player-count" && event.name === "b") {
      if (this.setupStage === "role") {
        this.setupStage = "player-count";
      } else if (this.setupStage === "kingdom") {
        this.setupStage = "role";
      } else if (this.setupStage === "general") {
        this.setupStage = "kingdom";
      } else {
        this.setupStage = "general";
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
      this.setupStage = "kingdom";
      this.refresh();
      return;
    }
    if (this.setupStage === "kingdom") {
      const kingdoms = this.getKingdomOptions();
      const kingdom = kingdoms[picked];
      if (!kingdom) {
        return;
      }
      this.setupKingdom = kingdom;
      const generalsInKingdom = this.getGeneralsByKingdom(kingdom);
      this.setupGeneralName = generalsInKingdom[0]?.name ?? this.setupGeneralName;
      this.setupStage = "general";
      this.refresh();
      return;
    }
    if (this.setupStage === "general") {
      const generals = this.getGeneralsByKingdom(this.setupKingdom);
      const pickedGeneral = generals[picked];
      if (!pickedGeneral) {
        return;
      }
      this.setupGeneralName = pickedGeneral.name;
      this.setupStage = "start";
      this.refresh();
      return;
    }
    if (this.setupStage === "start" && picked === 0) {
      this.startConfiguredGame();
    }
  }

  private getSetupOptions(): string[] {
    if (this.setupStage === "player-count") {
      return this.getPlayerCountOptions().map((count) => `${count} 人局（${this.getRoleDistributionText(count)}）`);
    }
    if (this.setupStage === "role") {
      return this.getRoleOptions();
    }
    if (this.setupStage === "kingdom") {
      return this.getKingdomOptions();
    }
    if (this.setupStage === "general") {
      return this.getGeneralsByKingdom(this.setupKingdom).map((general) => {
        const skills = general.skills.length > 0 ? general.skills.join("、") : "无技能";
        return `${general.name}[${general.kingdom}] ${general.maxHp}体力（${skills}）`;
      });
    }
    return ["开始游戏"];
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

  private getKingdomOptions(): Kingdom[] {
    return ["魏", "蜀", "吴", "群雄"];
  }

  private getGeneralsByKingdom(kingdom: Kingdom): typeof this.generalLibrary {
    return this.generalLibrary.filter((general) => general.kingdom === kingdom);
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

  private startConfiguredGame(): void {
    this.logs = [];
    this.pendingAction = null;
    this.pendingAiResponse = null;
    this.targetOptions = [];
    this.actionOptions = [];
    this.commandBuffer = null;
    this.closeDisplayOverlay();
    this.displayPage = 0;
    this.actionPage = 0;
    this.statusPage = 0;
    this.logs.push(
      ...this.game.initDefaultGame({
        ...this.options.initOptions,
        playerCount: this.setupPlayerCount,
        aiCount: this.setupPlayerCount - 1,
        humanRole: this.setupRole,
        humanGeneral: this.setupGeneralName,
      }),
    );
    this.mode = "action";
    void this.resolveAiTurns();
    this.refresh();
  }

  private async playAndAppendLogs(playerId: string, action: GameAction, targetId?: string): Promise<void> {
    this.busy = true;
    try {
      const logs = this.game.playAction(playerId, action, targetId);
      for (const line of logs) {
        this.logs.push(line);
        this.refresh();
        await this.delay(100);
      }
    } finally {
      this.busy = false;
    }
  }

  private async handlePendingResponseChoice(picked: number): Promise<void> {
    const pending = this.pendingAiResponse;
    if (!pending) {
      this.mode = "action";
      this.refresh();
      return;
    }
    const optionCount = pending.options.length;
    if ((optionCount > 0 && picked > optionCount) || (optionCount === 0 && picked > 0)) {
      return;
    }
    const chooseNoResponse = optionCount > 0 ? picked === optionCount : picked === 0;
    if (chooseNoResponse) {
      this.game.setPlayerResponsePolicy("human", { [pending.responseKind]: false });
      this.game.setPlayerResponseSelection("human", pending.responseKind, null);
      this.logs.push(`你选择不响应 ${pending.cardName}`);
      this.refresh();
      await this.delay(100);
    } else {
      const selected = pending.options[picked];
      if (!selected) {
        return;
      }
      this.game.setPlayerResponsePolicy("human", { [pending.responseKind]: true });
      this.game.setPlayerResponseSelection("human", pending.responseKind, selected.id);
      this.logs.push(`你选择：${selected.label}`);
      this.refresh();
      await this.delay(100);
    }
    this.pendingAiResponse = null;
    this.mode = "action";
    await this.playAndAppendLogs(pending.actorId, pending.action, pending.targetId);
    this.game.setPlayerResponseSelection("human", pending.responseKind, null);
    this.game.setPlayerResponsePolicy("human", null);
    await this.resolveAiTurns();
  }

  private buildPendingResponse(decision: { action: GameAction; targetId?: string }): PendingAiResponse | null {
    if (decision.action.type !== "play" || !decision.targetId || decision.targetId !== "human") {
      return null;
    }
    const actorId = this.game.getCurrentPlayer().id;
    const cardByIndex =
      decision.action.cardIndex >= 0
        ? this.game
            .getSnapshot()
            .players.find((player) => player.id === actorId)
            ?.hand[decision.action.cardIndex]?.type
        : null;
    const cardName = cardByIndex ?? this.extractCardTypeFromAction(decision.action);
    if (!cardName) {
      return null;
    }
    if (cardName === CardType.Slash) {
      const options = this.game.getPlayerResponseOptions("human", "dodge");
      return {
        actorId: this.game.getCurrentPlayer().id,
        action: decision.action,
        targetId: decision.targetId,
        responseKind: "dodge",
        cardName,
        options,
      };
    }
    if (cardName === CardType.Duel) {
      const options = this.game.getPlayerResponseOptions("human", "slash");
      return {
        actorId,
        action: decision.action,
        targetId: decision.targetId,
        responseKind: "slash",
        cardName,
        options,
      };
    }
    if (cardName === CardType.Dismantle || cardName === CardType.Snatch || cardName === CardType.Collateral) {
      const options = this.game.getPlayerResponseOptions("human", "negate");
      return {
        actorId,
        action: decision.action,
        targetId: decision.targetId,
        responseKind: "negate",
        cardName,
        options,
      };
    }
    return null;
  }

  private extractCardTypeFromAction(action: Extract<GameAction, { type: "play" }>): CardType | null {
    const label = action.label;
    const allCardTypes = Object.values(CardType);
    const picked = allCardTypes.find((cardType) => label.includes(cardType));
    return picked ?? null;
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
    title: string;
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
    output.push(`${input.title}（${page + 1}/${totalPages}）`);
    output.push(input.focused ? "聚焦区：← → 切换 | ↑ ↓ 翻页" : "未聚焦：← → 切换到此区");
    output.push("");
    output.push(...body);
    return { lines: output, page, totalPages };
  }

  private getBodyPageSize(area: FocusArea): number {
    const rows = process.stdout.rows ?? 40;
    const reserved = area === "display" ? 11 : 9;
    const pageSize = rows - reserved;
    return Math.max(6, pageSize);
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
      this.displayPage = Math.max(0, this.displayPage + step);
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
    this.displayColumn.borderColor = this.focusArea === "display" ? "green" : "white";
    this.actionColumn.borderColor = this.focusArea === "action" ? "green" : "white";
    this.statusColumn.borderColor = this.focusArea === "status" ? "green" : "white";
  }

  private toCommandChar(event: KeyEvent): string | null {
    const value = event.sequence && event.sequence.length === 1 ? event.sequence : event.name;
    if (!value || value.length !== 1) {
      return null;
    }
    if (!/^[ -~]$/.test(value)) {
      return null;
    }
    return value;
  }
}
