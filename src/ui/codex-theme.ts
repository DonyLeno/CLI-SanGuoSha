export const CODEX_THEME = {
  canvas: "#0c0d0e",
  surface: "#121415",
  surfaceFocused: "#171a1b",
  border: "#34383b",
  accent: "#70d7a4",
  text: "#e7e5e1",
  muted: "#8d9499",
  warning: "#dfb66a",
  danger: "#ef8176",
} as const;

const ANSI_RESET = "\u001b[0m";

const ansi = (codes: string, value: string, enabled: boolean): string =>
  enabled ? `\u001b[${codes}m${value}${ANSI_RESET}` : value;

export type CodexAnsiTheme = {
  accent: (value: string) => string;
  brand: (value: string) => string;
  danger: (value: string) => string;
  muted: (value: string) => string;
  strong: (value: string) => string;
  warning: (value: string) => string;
};

export function createCodexAnsiTheme(
  enabled = Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined,
): CodexAnsiTheme {
  return {
    accent: (value) => ansi("38;2;112;215;164", value, enabled),
    brand: (value) => ansi("1;38;2;112;215;164", value, enabled),
    danger: (value) => ansi("38;2;239;129;118", value, enabled),
    muted: (value) => ansi("38;2;141;148;153", value, enabled),
    strong: (value) => ansi("1;38;2;231;229;225", value, enabled),
    warning: (value) => ansi("38;2;223;182;106", value, enabled),
  };
}
