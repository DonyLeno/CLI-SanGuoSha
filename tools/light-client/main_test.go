package main

import (
	"strings"
	"testing"
)

func TestBuildChatPanelUsesFixedSizeAndKeepsLatestMessage(t *testing.T) {
	lines := buildChatPanel([]chatMessage{
		{PlayerName: "甲", Content: "旧消息"},
		{PlayerName: "乙", Content: "这是一条会自动换行的较长中文聊天消息"},
	})
	if len(lines) != chatPanelHeight {
		t.Fatalf("panel height = %d, want %d", len(lines), chatPanelHeight)
	}
	foundLatest := false
	for _, line := range lines {
		if displayWidth(line) != chatPanelWidth {
			t.Fatalf("line width = %d, want %d: %q", displayWidth(line), chatPanelWidth, line)
		}
		if strings.Contains(line, "乙 ›") {
			foundLatest = true
		}
	}
	if !foundLatest {
		t.Fatal("latest chat message is missing")
	}
}

func TestOnlyRemovalTricksRequireTargetCardSelection(t *testing.T) {
	tests := []struct {
		label string
		want  bool
	}{
		{label: "使用 过河拆桥", want: true},
		{label: "使用 顺手牵羊", want: true},
		{label: "使用 奇袭（将♣10 铁索连环当过河拆桥）", want: true},
		{label: "使用 铁索连环", want: false},
		{label: "使用 决斗", want: false},
		{label: "使用 国色（将♦3 顺手牵羊当乐不思蜀）", want: false},
		{label: "使用 武圣（将♥Q 过河拆桥当杀）", want: false},
	}
	for _, test := range tests {
		if got := actionRequiresTargetCardSelection(action{Label: test.label}); got != test.want {
			t.Errorf("actionRequiresTargetCardSelection(%q) = %v, want %v", test.label, got, test.want)
		}
	}
}

func TestFormatWinnerUsesIdentityCamp(t *testing.T) {
	tests := map[string]string{
		"lord":    "主公阵营胜利",
		"rebel":   "反贼胜利",
		"traitor": "内奸胜利",
		"draw":    "平局",
	}
	for winner, want := range tests {
		if got := formatWinner(winner); got != want {
			t.Errorf("formatWinner(%q) = %q, want %q", winner, got, want)
		}
	}
}
