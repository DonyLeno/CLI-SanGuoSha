export type TerminalChatMessage = {
  playerName: string;
  content: string;
};

export type TerminalCommandCandidate = {
  command: string;
  description: string;
};

export type ActionChoiceContext = {
  section: string;
  prompt: string;
};

const characterWidth = (character: string): number => {
  const codePoint = character.codePointAt(0) ?? 0;
  if (/\p{Mark}/u.test(character)) return 0;
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x1f300 && codePoint <= 0x1faff)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) ? 2 : 1;
};

export const displayWidth = (value: string): number =>
  [...value].reduce((width, character) => width + characterWidth(character), 0);

export function buildActionChoiceContext(
  actionLabel: string,
  kind: "target" | "target-card",
  targetName?: string,
): ActionChoiceContext {
  const conciseAction = actionLabel.split(/[（(]/u)[0]?.trim() || "当前动作";
  if (kind === "target-card") {
    const target = targetName?.trim() || "目标";
    return {
      section: `选择目标的牌 · ${actionLabel} → ${target}`,
      prompt: `${conciseAction}：选择 ${target} 的牌  `,
    };
  }
  return {
    section: `选择目标 · ${actionLabel}`,
    prompt: `${conciseAction}：选择目标  `,
  };
}

const fitDisplayWidth = (value: string, width: number): string => {
  let output = "";
  let used = 0;
  for (const character of value) {
    const next = characterWidth(character);
    if (used + next > width) break;
    output += character;
    used += next;
  }
  return output + " ".repeat(Math.max(0, width - used));
};

export const wrapDisplayText = (value: string, width: number): string[] => {
  if (width <= 0) return [""];
  const lines: string[] = [];
  let line = "";
  let used = 0;
  for (const character of value) {
    const next = characterWidth(character);
    if (used > 0 && used + next > width) {
      lines.push(line);
      line = "";
      used = 0;
    }
    line += character;
    used += next;
  }
  lines.push(line);
  return lines;
};

export type TerminalPaneLayout = {
  mainWidth: number;
  panelWidth: number;
  panelColumn: number;
};

export function computeTerminalPaneLayout(columns: number, preferredPanelWidth = 38): TerminalPaneLayout {
  const safeColumns = Math.max(10, Math.floor(columns));
  const panelWidth = Math.max(8, Math.min(preferredPanelWidth, safeColumns - 51));
  const mainWidth = Math.max(1, safeColumns - panelWidth - 1);
  return {
    mainWidth,
    panelWidth,
    panelColumn: mainWidth + 2,
  };
}

export function buildTerminalChatPanel(
  messages: TerminalChatMessage[],
  width = 38,
  height = 8,
): string[] {
  const safeWidth = Math.max(8, width);
  const safeHeight = Math.max(4, height);
  const innerWidth = safeWidth - 2;
  const bodyHeight = safeHeight - 2;
  const title = fitDisplayWidth(" 聊天 · :内容发送 ", innerWidth).trimEnd();
  const top = `┌${title}${"─".repeat(Math.max(0, innerWidth - displayWidth(title)))}┐`;
  const flattened = messages.flatMap((message) =>
    wrapDisplayText(`${message.playerName} › ${message.content}`, innerWidth),
  );
  const visible = flattened.slice(-bodyHeight);
  const body = Array.from({ length: bodyHeight }, (_, index) => {
    const content = visible[index - (bodyHeight - visible.length)] ?? "";
    return `│${fitDisplayWidth(content, innerWidth)}│`;
  });
  return [top, ...body, `└${"─".repeat(innerWidth)}┘`];
}

export function buildTerminalCommandPanel(
  candidates: TerminalCommandCandidate[],
  prefix: string,
  width = 38,
  height = 6,
): string[] {
  const safeWidth = Math.max(8, width);
  const safeHeight = Math.max(4, height);
  const innerWidth = safeWidth - 2;
  const bodyHeight = safeHeight - 2;
  const title = fitDisplayWidth(" 命令候选 ", innerWidth).trimEnd();
  const top = `┌${title}${"─".repeat(Math.max(0, innerWidth - displayWidth(title)))}┐`;
  const normalized = prefix.trim();
  const matched = candidates.filter((candidate) => candidate.command.startsWith(normalized));
  const descriptions = (matched.length > 0 ? matched : [{ command: "", description: "无匹配命令" }])
    .flatMap((candidate) => wrapDisplayText(
      candidate.command ? `${candidate.command}  ${candidate.description}` : candidate.description,
      innerWidth,
    ))
    .slice(0, bodyHeight);
  const body = Array.from({ length: bodyHeight }, (_, index) =>
    `│${fitDisplayWidth(descriptions[index] ?? "", innerWidth)}│`,
  );
  return [top, ...body, `└${"─".repeat(innerWidth)}┘`];
}
