import { formatGameWinner, GameAction, GameSnapshot, InteractionRequest, Player, PlayerRole, RemovableCardOption } from "../engine/game.js";
import { formatCard } from "../engine/cards.js";
import { computeDistanceBetween, getAttackRange } from "../engine/resolve.js";

type TargetAction = Exclude<GameAction, { type: "end" }>;

export type PendingInteractionView = { request: InteractionRequest };

export type ChatMessageView = {
  sender: string;
  content: string;
};

export type ActionAreaState = {
  commandBuffer: string | null;
  mode: string;
  actionOptions: GameAction[];
  pendingAction: TargetAction | null;
  targetOptions: Player[];
  targetCardOptions: RemovableCardOption[];
  pendingInteraction: PendingInteractionView | null;
  pendingTargetId: string | null;
  snapshot: GameSnapshot;
  labelPlayer: (playerId: string) => string;
  isSnatch: (action: TargetAction | null) => boolean;
  getCommandListLines: () => string[];
  getActionHint: (action: GameAction) => string;
};

export function describeHand(cards: Player["hand"]): string {
  if (cards.length === 0) {
    return "0 张";
  }
  return cards.map((card, index) => `${index + 1}:${formatCard(card)}`).join(" ");
}

export function buildDisplayLines(logs: string[], overlay: { title: string | null; lines: string[] }): string[] {
  if (overlay.title !== null) {
    const lines: string[] = [];
    lines.push(`› ${overlay.title}`);
    lines.push("  /close 关闭当前文档");
    lines.push("");
    lines.push(...overlay.lines);
    return lines;
  }
  const lines: string[] = [];
  lines.push("› /help 查看规则与快捷命令");
  lines.push("");
  lines.push("activity");
  const latest = logs.slice(-100);
  if (latest.length === 0) {
    lines.push("  等待对局开始…");
  }
  for (const item of latest) {
    lines.push(`  • ${item}`);
  }
  return lines;
}

export function buildChatLines(messages: ChatMessageView[]): string[] {
  const lines = ["chat · :内容 发送", ""];
  const latest = messages.slice(-4);
  if (latest.length === 0) {
    lines.push("  暂无聊天");
  } else {
    for (const message of latest) {
      lines.push(`  ${message.sender} › ${message.content}`);
    }
  }
  lines.push("", "──────── 战场 ────────");
  return lines;
}

export function buildStatusLines(
  snapshot: GameSnapshot,
  labelPlayer: (playerId: string) => string,
  localPlayerId: string,
): string[] {
  const statusLines: string[] = [];
  statusLines.push(`turn ${snapshot.turn} · ${snapshot.phase}`);
  statusLines.push(`current › ${labelPlayer(snapshot.currentPlayerId)}`);
  statusLines.push(`deck ${snapshot.deckCount} · discard ${snapshot.discardCount}`);
  statusLines.push("");
  statusLines.push("players");
  for (const player of snapshot.players) {
    const status = player.alive ? `存活${player.chained ? "·横置" : ""}${player.faceDown ? "·翻面" : ""}` : "阵亡";
    const identity = !player.alive ? player.role : player.role === PlayerRole.Lord ? PlayerRole.Lord : "未知";
    const hand = player.isAI ? `${player.hand.length} 张` : describeHand(player.hand);
    const skills = player.skills.length > 0 ? player.skills.join("、") : "无";
    const weapon = player.equippedCards?.weapon ? formatCard(player.equippedCards.weapon) : player.weapon ?? "无";
    const armor = player.equippedCards?.armor ? formatCard(player.equippedCards.armor) : player.armor ?? "无";
    const attackHorse = player.equippedCards?.attackHorse ? formatCard(player.equippedCards.attackHorse) : player.attackHorse ?? "无";
    const defenseHorse = player.equippedCards?.defenseHorse ? formatCard(player.equippedCards.defenseHorse) : player.defenseHorse ?? "无";
    const treasure = player.equippedCards?.treasure ? formatCard(player.equippedCards.treasure) : player.treasure ?? "无";
    let reachInfo = "";
    if (player.id === localPlayerId) {
      reachInfo = ` · 攻击范围 ${getAttackRange(player)}`;
    } else if (player.alive) {
      const local = snapshot.players.find((item) => item.id === localPlayerId);
      if (local) {
        reachInfo = ` · 距离 ${computeDistanceBetween(snapshot.players, local, player)}`;
      }
    }
    const marker = player.id === snapshot.currentPlayerId ? "›" : "•";
    statusLines.push(`${marker} ${player.name} [${player.general}] · ${identity} · HP ${Math.max(player.hp, 0)}/${player.maxHp}`);
    statusLines.push(`  手牌 ${hand}${reachInfo} · ${status}`);
    statusLines.push(`  武器 ${weapon} · 防具 ${armor}`);
    statusLines.push(`  +1马 ${defenseHorse} · -1马 ${attackHorse} · 宝物 ${treasure}`);
    if (player.delayedTricks.length > 0) {
      statusLines.push(`  判定区 ${player.delayedTricks.map((trick) => `${trick.cardType}${trick.card ? `（${formatCard(trick.card)}）` : ""}`).join("、")}`);
    }
    statusLines.push(`  技能 ${skills}`);
    statusLines.push("");
  }
  if (snapshot.gameOver) {
    statusLines.push(`result › ${formatGameWinner(snapshot.winner)}`);
  }
  return statusLines;
}

export function buildActionLines(state: ActionAreaState): string[] {
  const actionLines: string[] = [];
  if (state.commandBuffer !== null) {
    actionLines.push(`› ${state.commandBuffer}`);
    actionLines.push("  Enter 执行 · Esc 取消");
    actionLines.push("");
    actionLines.push("commands");
    actionLines.push(...state.getCommandListLines());
  } else if (state.mode === "action") {
    state.actionOptions.forEach((action, index) => {
      actionLines.push(`  ${index + 1}  ${action.label}`);
      const actionHint = state.getActionHint(action);
      if (actionHint.length > 0) {
        actionLines.push(`     ↳ ${actionHint}`);
      }
    });
    if (state.actionOptions.length === 0) {
      actionLines.push("• AI 正在思考…");
    }
  } else if (state.mode === "target") {
    const current = state.snapshot.players.find((player) => player.id === state.snapshot.currentPlayerId);
    actionLines.push(`› ${state.pendingAction ? state.pendingAction.label : "选择目标"}`);
    actionLines.push("");
    state.targetOptions.forEach((target, index) => {
      const distance =
        current && current.alive && target.alive
          ? computeDistanceBetween(state.snapshot.players, current, target)
          : null;
      actionLines.push(
        `  ${index + 1}  ${target.name} · HP ${Math.max(target.hp, 0)}/${target.maxHp} · 手牌 ${target.hand.length} 张${distance !== null ? ` · 距离 ${distance}` : ""}`,
      );
    });
    actionLines.push("");
    actionLines.push("b 返回上一步");
  } else if (state.mode === "target-card") {
    const targetName = state.pendingTargetId ? state.labelPlayer(state.pendingTargetId) : "目标";
    actionLines.push(`› ${state.pendingAction ? state.pendingAction.label : "选择牌"}`);
    actionLines.push(`  ${targetName} · 选择要${state.isSnatch(state.pendingAction) ? "获取" : "弃置"}的牌`);
    actionLines.push("");
    state.targetCardOptions.forEach((option, index) => {
      actionLines.push(`  ${index + 1}  ${option.label}`);
    });
    if (state.targetCardOptions.length === 0) {
      actionLines.push("目标没有可选牌，将按默认规则结算");
      actionLines.push("  1  继续结算");
    }
    actionLines.push("");
    actionLines.push("b 返回上一步");
  } else if (state.mode === "response") {
    const pending = state.pendingInteraction;
    if (pending) {
      const req = pending.request;
      actionLines.push("› " + req.reason);
      actionLines.push("");
      if (req.kind === "respond" || req.kind === "choose-discard" || req.kind === "choose-card") {
        req.sources.forEach((s, i) => actionLines.push(`  ${i + 1}  ${s.label}`));
        const canPass = req.kind === "respond" || req.allowPass;
        if (canPass) {
          const passLabel = req.kind === "respond" ? "放弃" : (req.passLabel ?? "放弃");
          actionLines.push(`  ${req.sources.length + 1}  ${passLabel}`);
        }
      } else if (req.kind === "collateral") {
        const isIronChain = req.reason.includes("铁索连环");
        const isCollateral = req.reason.includes("借刀杀人");
        req.victims.forEach((v, i) => actionLines.push(`  ${i + 1}  ${isCollateral ? "对" : "选择"} ${state.labelPlayer(v)}${isCollateral ? " 使用杀" : ""}`));
        if (req.allowHandOverWeapon || isIronChain) {
          actionLines.push(`  ${req.victims.length + 1}  ${isCollateral ? "交出武器" : "取消（只处理第一名角色）"}`);
        }
      } else if (req.kind === "choose-suit") {
        const suitLabels: Record<string, string> = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃" };
        req.suits.forEach((s, i) => actionLines.push(`  ${i + 1}  声明${suitLabels[s] ?? s}`));
      } else if (req.kind === "optional-effect") {
        actionLines.push("  1  发动");
        actionLines.push("  2  不发动");
      }
    }
  } else if (state.mode === "discard") {
    const current = state.snapshot.players.find((player) => player.id === state.snapshot.currentPlayerId);
    if (current && current.id === "human") {
      const needDiscard = Math.max(0, current.hand.length - current.hp);
      actionLines.push(`› 弃牌 · 还需 ${needDiscard} 张`);
      actionLines.push(`  手牌 ${current.hand.length} · 体力 ${Math.max(current.hp, 0)}`);
      actionLines.push("");
      current.hand.forEach((card, index) => {
        actionLines.push(`  ${index + 1}  弃置 ${formatCard(card)}`);
      });
    } else {
      actionLines.push("• 等待回合推进…");
    }
  } else {
    actionLines.push("› 对局已结束");
    actionLines.push("  r 重开 · /exit 退出");
  }
  actionLines.push("");
  actionLines.push("/ 打开命令 · : 输入聊天");
  return actionLines;
}
