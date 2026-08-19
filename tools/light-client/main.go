package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
)

type card struct {
	Type string `json:"type"`
	Suit string `json:"suit"`
	Rank int    `json:"rank"`
}
type delayedTrick struct {
	CardType string `json:"cardType"`
	Card     *card  `json:"card"`
}

type generalDefinition struct {
	Kingdom string   `json:"kingdom"`
	Name    string   `json:"name"`
	MaxHP   int      `json:"maxHp"`
	Skills  []string `json:"skills"`
}

func formatCard(value card) string {
	suits := map[string]string{"heart": "♥", "diamond": "♦", "club": "♣", "spade": "♠"}
	ranks := map[int]string{1: "A", 11: "J", 12: "Q", 13: "K"}
	rank := ranks[value.Rank]
	if rank == "" && value.Rank > 0 {
		rank = strconv.Itoa(value.Rank)
	}
	face := suits[value.Suit] + rank
	if face == "" {
		return value.Type
	}
	return face + " " + value.Type
}

func formatWinner(value string) string {
	switch value {
	case "lord":
		return "主公阵营胜利"
	case "rebel":
		return "反贼胜利"
	case "traitor":
		return "内奸胜利"
	case "draw":
		return "平局"
	default:
		return "胜负未定"
	}
}

type player struct {
	ID                string          `json:"id"`
	Name              string          `json:"name"`
	Role              string          `json:"role"`
	General           string          `json:"general"`
	HP                int             `json:"hp"`
	MaxHP             int             `json:"maxHp"`
	Hand              []card          `json:"hand"`
	HandCount         int             `json:"handCount"`
	Weapon            string          `json:"weapon"`
	Armor             string          `json:"armor"`
	AttackHorse       string          `json:"attackHorse"`
	DefenseHorse      string          `json:"defenseHorse"`
	Treasure          string          `json:"treasure"`
	EquippedCards     map[string]card `json:"equippedCards"`
	FaceDown          bool            `json:"faceDown"`
	Chained           bool            `json:"chained"`
	Alive             bool            `json:"alive"`
	Skills            []string        `json:"skills"`
	TreasureCards     []card          `json:"treasureCards"`
	TreasureCardCount int             `json:"treasureCardCount"`
	DelayedTricks     []delayedTrick  `json:"delayedTricks"`
}
type action struct {
	Type           string   `json:"type"`
	Label          string   `json:"label"`
	RequiresTarget bool     `json:"requiresTarget"`
	Targets        []string `json:"targets"`
}

func actionRequiresTargetCardSelection(value action) bool {
	effectiveLabel := value.Label
	if conversionMarker := strings.LastIndex(effectiveLabel, "当"); conversionMarker >= 0 {
		effectiveLabel = effectiveLabel[conversionMarker+len("当"):]
	}
	return strings.Contains(effectiveLabel, "过河拆桥") || strings.Contains(effectiveLabel, "顺手牵羊")
}

type removableCard struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}
type cardSource struct {
	SourceID string `json:"sourceId"`
	Origin   string `json:"origin"`
	Label    string `json:"label"`
	Card     card   `json:"card"`
}
type interactionRequest struct {
	Kind                string       `json:"kind"`
	Reason              string       `json:"reason"`
	Sources             []cardSource `json:"sources"`
	Victims             []string     `json:"victims"`
	AllowPass           bool         `json:"allowPass"`
	AllowHandOverWeapon bool         `json:"allowHandOverWeapon"`
	PassLabel           string       `json:"passLabel"`
	Count               int          `json:"count"`
	Suits               []string     `json:"suits"`
}
type snapshot struct {
	CurrentPlayerID string   `json:"currentPlayerId"`
	Turn            int      `json:"turn"`
	Phase           string   `json:"phase"`
	GameOver        bool     `json:"gameOver"`
	Winner          string   `json:"winner"`
	Players         []player `json:"players"`
}
type serverMessage struct {
	PlayerName      string `json:"playerName"`
	Content         string `json:"content"`
	WaitTimeSeconds int    `json:"waitTimeSeconds"`

	Type                string                     `json:"type"`
	PlayerID            string                     `json:"playerId"`
	RoomSize            int                        `json:"roomSize"`
	Message             string                     `json:"message"`
	Players             []player                   `json:"players"`
	Snapshot            snapshot                   `json:"snapshot"`
	Actions             []action                   `json:"actions"`
	RemovableCards      map[string][]removableCard `json:"removableCards"`
	PendingDiscardCount int                        `json:"pendingDiscardCount"`
	Logs                []string                   `json:"logs"`
	Reason              string                     `json:"reason"`
	Effect              string                     `json:"effect"`
	Request             *interactionRequest        `json:"request"`
	Role                string                     `json:"role"`
	Candidates          []generalDefinition        `json:"candidates"`
	SelectedCount       int                        `json:"selectedCount"`
	TotalCount          int                        `json:"totalCount"`
}

type chatMessage struct {
	PlayerName string
	Content    string
}

var input = bufio.NewScanner(os.Stdin)
var lastPlayers []player
var myPlayerID string
var sendMutex sync.Mutex
var writerMutex sync.RWMutex
var activeWriter *bufio.Writer
var connectionMutex sync.RWMutex
var activeConnection net.Conn
var leavingMutex sync.RWMutex
var leaving bool
var choiceMutex sync.RWMutex
var activeChoice chan string
var chatMutex sync.Mutex
var chatMessages []chatMessage
var panelOutputMutex sync.Mutex
var terminalChatPanelEnabled = func() bool {
	info, err := os.Stdout.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}()

const reconnectMaxAttempts = 3
const protocolVersion = 10
const chatPanelWidth = 36
const chatPanelHeight = 8
const maxChatMessages = 100

var commandCandidates = []struct {
	Command     string
	Description string
}{
	{Command: "/help", Description: "显示命令候选"},
	{Command: "/clear", Description: "清空主显示区"},
	{Command: "/exit", Description: "退出当前房间"},
}

func runeDisplayWidth(value rune) int {
	if value >= 0x1100 && (value <= 0x115f ||
		value == 0x2329 || value == 0x232a ||
		(value >= 0x2e80 && value <= 0xa4cf) ||
		(value >= 0xac00 && value <= 0xd7a3) ||
		(value >= 0xf900 && value <= 0xfaff) ||
		(value >= 0xfe10 && value <= 0xfe19) ||
		(value >= 0xfe30 && value <= 0xfe6f) ||
		(value >= 0xff00 && value <= 0xff60) ||
		(value >= 0xffe0 && value <= 0xffe6) ||
		(value >= 0x1f300 && value <= 0x1faff) ||
		(value >= 0x20000 && value <= 0x3fffd)) {
		return 2
	}
	return 1
}

func displayWidth(value string) int {
	width := 0
	for _, character := range value {
		width += runeDisplayWidth(character)
	}
	return width
}

func fitDisplayWidth(value string, width int) string {
	var output strings.Builder
	used := 0
	for _, character := range value {
		next := runeDisplayWidth(character)
		if used+next > width {
			break
		}
		output.WriteRune(character)
		used += next
	}
	output.WriteString(strings.Repeat(" ", width-used))
	return output.String()
}

func wrapDisplayText(value string, width int) []string {
	lines := make([]string, 0, 2)
	var line strings.Builder
	used := 0
	for _, character := range value {
		next := runeDisplayWidth(character)
		if used > 0 && used+next > width {
			lines = append(lines, line.String())
			line.Reset()
			used = 0
		}
		line.WriteRune(character)
		used += next
	}
	lines = append(lines, line.String())
	return lines
}

func buildChatPanel(messages []chatMessage) []string {
	innerWidth := chatPanelWidth - 2
	bodyHeight := chatPanelHeight - 2
	title := strings.TrimRight(fitDisplayWidth(" 聊天 · :内容发送 ", innerWidth), " ")
	lines := []string{"┌" + title + strings.Repeat("─", innerWidth-displayWidth(title)) + "┐"}
	flattened := make([]string, 0, len(messages))
	for _, message := range messages {
		flattened = append(flattened, wrapDisplayText(message.PlayerName+" › "+message.Content, innerWidth)...)
	}
	if len(flattened) > bodyHeight {
		flattened = flattened[len(flattened)-bodyHeight:]
	}
	for len(flattened) < bodyHeight {
		flattened = append([]string{""}, flattened...)
	}
	for _, line := range flattened {
		lines = append(lines, "│"+fitDisplayWidth(line, innerWidth)+"│")
	}
	lines = append(lines, "└"+strings.Repeat("─", innerWidth)+"┘")
	return lines
}

func renderChatPanel() {
	if !terminalChatPanelEnabled {
		return
	}
	chatMutex.Lock()
	messages := append([]chatMessage(nil), chatMessages...)
	chatMutex.Unlock()
	lines := buildChatPanel(messages)
	var output strings.Builder
	output.WriteString("\x1b7")
	for index, line := range lines {
		fmt.Fprintf(&output, "\x1b[%d;999H\x1b[%dD%s", index+1, chatPanelWidth, line)
	}
	output.WriteString("\x1b8")
	panelOutputMutex.Lock()
	fmt.Print(output.String())
	panelOutputMutex.Unlock()
}

func displayChatMessage(playerName string, content string) {
	chatMutex.Lock()
	chatMessages = append(chatMessages, chatMessage{PlayerName: playerName, Content: content})
	if len(chatMessages) > maxChatMessages {
		chatMessages = chatMessages[len(chatMessages)-maxChatMessages:]
	}
	chatMutex.Unlock()
	if terminalChatPanelEnabled {
		renderChatPanel()
	} else {
		fmt.Printf("\nchat %s › %s\n", playerName, content)
	}
}

func choose(prompt string, count int) int {
	choice := make(chan string, 1)
	choiceMutex.Lock()
	activeChoice = choice
	choiceMutex.Unlock()
	defer func() {
		choiceMutex.Lock()
		if activeChoice == choice {
			activeChoice = nil
		}
		choiceMutex.Unlock()
	}()
	for {
		renderChatPanel()
		fmt.Printf("› %s", prompt)
		raw, ok := <-choice
		if !ok {
			return -1
		}
		value, err := strconv.Atoi(raw)
		if err == nil && value >= 1 && value <= count {
			return value - 1
		}
		fmt.Println("  请输入有效编号")
	}
}

func send(writer *bufio.Writer, value interface{}) error {
	sendMutex.Lock()
	defer sendMutex.Unlock()
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err = writer.Write(append(payload, '\n')); err != nil {
		return err
	}
	return writer.Flush()
}

func setActiveWriter(writer *bufio.Writer) {
	writerMutex.Lock()
	activeWriter = writer
	writerMutex.Unlock()
}

func setActiveConnection(connection net.Conn) {
	connectionMutex.Lock()
	activeConnection = connection
	connectionMutex.Unlock()
}

func isLeaving() bool {
	leavingMutex.RLock()
	defer leavingMutex.RUnlock()
	return leaving
}

func printCommandCandidates(prefix string) {
	fmt.Println("\n命令候选")
	found := false
	for _, candidate := range commandCandidates {
		if strings.HasPrefix(candidate.Command, prefix) {
			fmt.Printf("  %-8s %s\n", candidate.Command, candidate.Description)
			found = true
		}
	}
	if !found {
		fmt.Printf("  无匹配命令：%s\n", prefix)
	}
}

func executeClientCommand(command string) {
	switch command {
	case "/", "/help":
		printCommandCandidates("/")
	case "/clear":
		if terminalChatPanelEnabled {
			fmt.Print("\x1b[2J\x1b[H")
		} else {
			fmt.Println()
		}
		renderChatPanel()
	case "/exit":
		leavingMutex.Lock()
		leaving = true
		leavingMutex.Unlock()
		writerMutex.RLock()
		writer := activeWriter
		writerMutex.RUnlock()
		if writer != nil {
			_ = send(writer, map[string]interface{}{"type": "leave"})
		}
		connectionMutex.RLock()
		connection := activeConnection
		connectionMutex.RUnlock()
		if connection != nil {
			_ = connection.Close()
		}
	default:
		printCommandCandidates(command)
	}
}

func sendChat(content string) {
	writerMutex.RLock()
	writer := activeWriter
	writerMutex.RUnlock()
	if writer == nil {
		fmt.Println("  尚未连接，无法发送聊天")
		return
	}
	if err := send(writer, map[string]interface{}{"type": "chat", "content": content}); err != nil {
		fmt.Printf("  聊天发送失败：%v\n", err)
	}
}

func startInputLoop() {
	go func() {
		for input.Scan() {
			raw := strings.TrimSpace(input.Text())
			if strings.HasPrefix(raw, ":") || strings.HasPrefix(raw, "：") {
				content := strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(raw, ":"), "："))
				if content == "" {
					fmt.Println("  聊天内容不能为空")
				} else {
					sendChat(content)
				}
				continue
			}
			if strings.HasPrefix(raw, "/") {
				executeClientCommand(raw)
				renderChatPanel()
				continue
			}
			choiceMutex.RLock()
			choice := activeChoice
			choiceMutex.RUnlock()
			if choice == nil {
				fmt.Println("  当前无需选择；输入 :内容 可发送聊天")
				renderChatPanel()
				continue
			}
			select {
			case choice <- raw:
			default:
				fmt.Println("  请等待当前输入处理完成")
				renderChatPanel()
			}
		}
	}()
}

func playerName(players []player, id string) string {
	for _, item := range players {
		if item.ID == id {
			return item.Name
		}
	}
	return id
}

func equipmentName(value string) string {
	if value == "" {
		return "无"
	}
	return value
}

func formatEquipment(value player, zone string, fallback string) string {
	if equipped, ok := value.EquippedCards[zone]; ok {
		return formatCard(equipped)
	}
	return equipmentName(fallback)
}

func attackRange(weapon string) int {
	switch weapon {
	case "诸葛连弩":
		return 1
	case "雌雄双股剑", "青釭剑", "寒冰剑", "古锭刀":
		return 2
	case "丈八蛇矛", "青龙偃月刀", "贯石斧":
		return 3
	case "方天画戟", "朱雀羽扇":
		return 4
	case "麒麟弓":
		return 5
	}
	return 1
}

func hasSkill(target player, skill string) bool {
	for _, item := range target.Skills {
		if item == skill {
			return true
		}
	}
	return false
}

func findPlayer(players []player, id string) player {
	for _, item := range players {
		if item.ID == id {
			return item
		}
	}
	return player{}
}

// ringDistance 与引擎 computeDistance 一致：仅存活玩家按座位环形距离，
// 进攻方进攻马 -1、马术 -1，目标防御马 +1，下限 1。
func ringDistance(players []player, from, to player) int {
	alive := make([]player, 0, len(players))
	for _, item := range players {
		if item.Alive {
			alive = append(alive, item)
		}
	}
	fromIndex, toIndex := -1, -1
	for index, item := range alive {
		if item.ID == from.ID {
			fromIndex = index
		}
		if item.ID == to.ID {
			toIndex = index
		}
	}
	if fromIndex < 0 || toIndex < 0 {
		return 99
	}
	gap := toIndex - fromIndex
	if gap < 0 {
		gap = -gap
	}
	ring := gap
	if n := len(alive) - gap; n < ring {
		ring = n
	}
	distance := ring
	if from.AttackHorse != "" {
		distance--
	}
	if hasSkill(from, "马术") {
		distance--
	}
	if to.DefenseHorse != "" {
		distance++
	}
	if distance < 1 {
		distance = 1
	}
	return distance
}

func renderState(message serverMessage, writer *bufio.Writer) bool {
	lastPlayers = message.Snapshot.Players
	fmt.Printf("\n>_ CLI 三国杀 · online · turn %d · %s\n", message.Snapshot.Turn, message.Snapshot.Phase)
	if len(message.Logs) > 0 {
		fmt.Println("\n• 对局记录")
		for _, line := range message.Logs {
			fmt.Printf("  └ %s\n", line)
		}
	}
	fmt.Println("\n• 战场")
	me := findPlayer(message.Snapshot.Players, myPlayerID)
	for _, item := range message.Snapshot.Players {
		marker := "•"
		if item.ID == message.Snapshot.CurrentPlayerID {
			marker = "›"
		}
		reachInfo := ""
		if item.ID == myPlayerID {
			reachInfo = fmt.Sprintf(" · 攻击范围 %d", attackRange(item.Weapon))
		} else if item.Alive {
			reachInfo = fmt.Sprintf(" · 距离 %d", ringDistance(message.Snapshot.Players, me, item))
		}
		hand := fmt.Sprintf("%d 张", item.HandCount)
		if item.Hand != nil {
			names := make([]string, len(item.Hand))
			for index, value := range item.Hand {
				names[index] = formatCard(value)
			}
			hand = strings.Join(names, "、")
			if hand == "" {
				hand = "无"
			}
		}
		state := "正面"
		if item.FaceDown {
			state = "翻面"
		}
		if item.Chained {
			state += "·横置"
		}
		fmt.Printf("%s %s [%s] · %s · HP %d/%d · 手牌 %s · %s%s\n", marker, item.Name, item.General, item.Role, item.HP, item.MaxHP, hand, state, reachInfo)
		fmt.Printf("  └ 武器 %s · 防具 %s · -1马 %s · +1马 %s · 宝物 %s\n",
			formatEquipment(item, "weapon", item.Weapon), formatEquipment(item, "armor", item.Armor), formatEquipment(item, "attackHorse", item.AttackHorse),
			formatEquipment(item, "defenseHorse", item.DefenseHorse), formatEquipment(item, "treasure", item.Treasure))
		if item.TreasureCards != nil && len(item.TreasureCards) > 0 {
			names := make([]string, len(item.TreasureCards))
			for index, value := range item.TreasureCards {
				names[index] = formatCard(value)
			}
			fmt.Printf("    木牛流马下 %s\n", strings.Join(names, "、"))
		}
		if len(item.DelayedTricks) > 0 {
			names := make([]string, len(item.DelayedTricks))
			for index, trick := range item.DelayedTricks {
				names[index] = trick.CardType
				if trick.Card != nil {
					names[index] += "（" + formatCard(*trick.Card) + "）"
				}
			}
			fmt.Printf("    判定区 %s\n", strings.Join(names, "、"))
		}
	}
	if message.Snapshot.GameOver {
		fmt.Printf("\n• 游戏结束 · %s\n", formatWinner(message.Snapshot.Winner))
		return true
	}
	if message.PendingDiscardCount > 0 {
		var me player
		for _, item := range message.Snapshot.Players {
			if item.ID == message.Snapshot.CurrentPlayerID {
				me = item
			}
		}
		usable := make([]string, 0, len(me.Hand)+len(me.TreasureCards))
		for _, value := range me.Hand {
			usable = append(usable, formatCard(value))
		}
		for _, value := range me.TreasureCards {
			usable = append(usable, formatCard(value)+"（木牛流马）")
		}
		for index, label := range usable {
			fmt.Printf("  %2d  %s\n", index+1, label)
		}
		picked := choose(fmt.Sprintf("弃置一张牌 · 还需 %d 张  ", message.PendingDiscardCount), len(usable))
		if picked >= 0 {
			_ = send(writer, map[string]interface{}{"type": "discard", "handIndex": picked})
		}
		return false
	}
	if len(message.Actions) == 0 {
		fmt.Println("\n• 等待其他玩家行动…")
		return false
	}
	fmt.Println("\n• 可执行动作")
	for index, value := range message.Actions {
		fmt.Printf("  %2d  %s\n", index+1, value.Label)
	}
	actionIndex := choose("选择动作  ", len(message.Actions))
	if actionIndex < 0 {
		return true
	}
	selected := message.Actions[actionIndex]
	payload := map[string]interface{}{"type": "action", "actionIndex": actionIndex}
	if selected.Type != "end" && selected.RequiresTarget {
		for index, id := range selected.Targets {
			dist := ringDistance(message.Snapshot.Players, me, findPlayer(message.Snapshot.Players, id))
			fmt.Printf("  %2d  %s · 距离 %d\n", index+1, playerName(message.Snapshot.Players, id), dist)
		}
		targetIndex := choose("选择目标  ", len(selected.Targets))
		if targetIndex < 0 {
			return true
		}
		targetID := selected.Targets[targetIndex]
		payload["targetId"] = targetID
		cards := message.RemovableCards[targetID]
		if actionRequiresTargetCardSelection(selected) && len(cards) > 0 {
			for index, value := range cards {
				fmt.Printf("  %2d  %s\n", index+1, value.Label)
			}
			cardIndex := choose("选择目标的牌  ", len(cards))
			if cardIndex < 0 {
				return true
			}
			payload["selectedCardId"] = cards[cardIndex].ID
		}
	}
	_ = send(writer, payload)
	return false
}

func runGame(writer *bufio.Writer, scanner *bufio.Scanner, isReconnect bool) bool {
	if isReconnect {
		_ = send(writer, map[string]interface{}{"type": "reconnect", "playerId": myPlayerID, "version": protocolVersion})
	}
	messages := make(chan serverMessage, 128)
	go func() {
		defer close(messages)
		for scanner.Scan() {
			var message serverMessage
			if err := json.Unmarshal(scanner.Bytes(), &message); err != nil {
				fmt.Println("收到无效消息")
				continue
			}
			if message.Type == "chat" {
				displayChatMessage(message.PlayerName, message.Content)
				continue
			}
			messages <- message
		}
	}()
	for message := range messages {
		switch message.Type {
		case "welcome":
			myPlayerID = message.PlayerID
			fmt.Println("╭──────────────────────────────────────────────────╮")
			fmt.Println("│ >_ CLI 三国杀")
			fmt.Println("╰──────────────────────────────────────────────────╯")
			fmt.Printf("\n› 已加入房间 · ID %s\n", message.PlayerID)
		case "reconnect_ok":
			myPlayerID = message.PlayerID
			fmt.Printf("› 已重连 · ID %s\n", message.PlayerID)
		case "lobby":
			fmt.Printf("• 等待玩家 %d/%d\n", len(message.Players), message.RoomSize)
		case "general_choices":
			fmt.Printf("\n• 选将 · 你的身份是%s\n", message.Role)
			for index, general := range message.Candidates {
				skills := "无技能"
				if len(general.Skills) > 0 {
					skills = strings.Join(general.Skills, "、")
				}
				fmt.Printf("  %2d  %s[%s] · %d体力 · %s\n", index+1, general.Name, general.Kingdom, general.MaxHP, skills)
			}
			picked := choose("选择武将  ", len(message.Candidates))
			if picked >= 0 && picked < len(message.Candidates) {
				selected := message.Candidates[picked]
				_ = send(writer, map[string]interface{}{"type": "select_general", "general": selected.Name})
				fmt.Printf("› 已选择 %s，等待其他玩家…\n", selected.Name)
			}
		case "general_selection_status":
			fmt.Printf("• 选将进度 %d/%d\n", message.SelectedCount, message.TotalCount)
		case "error":
			fmt.Printf("错误：%s\n", message.Message)
		case "closed":
			fmt.Println(message.Message)
			return true
		case "interaction":
			handleInteraction(message.Request, writer)
		case "effect":
			fmt.Printf("\n• %s\n  %2d  发动\n  %2d  不发动\n", message.Reason, 1, 2)
			_ = send(writer, map[string]interface{}{"type": "effect", "enabled": choose("请选择  ", 2) == 0})
		case "player_disconnected":
			fmt.Printf("• %s 已断线 · %ds 内可重连\n", message.PlayerName, message.WaitTimeSeconds)
		case "player_reconnected":
			if message.PlayerName != "" {
				fmt.Printf("• %s 已重连\n", message.PlayerName)
			}
		case "game_over", "game_restarting":
			fmt.Println(message.Message)
		case "state":
			if renderState(message, writer) {
				return true
			}
		}
		renderChatPanel()
	}
	return false
}

func dialServer(host string, port int) (net.Conn, error) {
	hostValue := strings.TrimSpace(host)
	address := net.JoinHostPort(hostValue, strconv.Itoa(port))
	if ip := net.ParseIP(hostValue); ip != nil {
		return net.DialTCP("tcp", nil, &net.TCPAddr{IP: ip, Port: port})
	}
	return net.Dial("tcp", address)
}

func main() {
	host := flag.String("host", "127.0.0.1", "房主地址")
	port := flag.Int("port", 9527, "房间端口")
	name := flag.String("name", "玩家", "玩家名")
	flag.Parse()

	connection, err := dialServer(*host, *port)
	if err != nil {
		fmt.Printf("› 连接失败 · %v\n", err)
		return
	}
	defer connection.Close()

	writer := bufio.NewWriter(connection)
	setActiveWriter(writer)
	setActiveConnection(connection)
	startInputLoop()
	if err = send(writer, map[string]interface{}{"type": "join", "name": *name, "version": protocolVersion}); err != nil {
		fmt.Println(err)
		return
	}
	scanner := bufio.NewScanner(connection)

	// Main game loop with reconnection support
	gameOver := false
	for !gameOver {
		gameOver = runGame(writer, scanner, myPlayerID != "")
		if gameOver {
			break
		}
		if isLeaving() {
			break
		}
		// Connection lost — attempt reconnect
		if myPlayerID == "" {
			fmt.Println("• 连接中断")
			break
		}
		fmt.Println("• 连接中断 · 尝试重连…")
		reconnected := false
		for attempt := 1; attempt <= reconnectMaxAttempts; attempt++ {
			fmt.Printf("• 重连尝试 %d/%d…\n", attempt, reconnectMaxAttempts)
			connection.Close()
			newConn, dialErr := dialServer(*host, *port)
			if dialErr != nil {
				fmt.Printf("重连失败：%v\n", dialErr)
				continue
			}
			connection = newConn
			writer = bufio.NewWriter(connection)
			setActiveWriter(writer)
			setActiveConnection(connection)
			scanner = bufio.NewScanner(connection)
			reconnected = true
			fmt.Println("› 重连成功")
			break
		}
		if !reconnected {
			fmt.Println("› 重连失败次数过多，退出")
			break
		}
	}
}

func handleInteraction(request *interactionRequest, writer *bufio.Writer) {
	if request == nil {
		return
	}
	switch request.Kind {
	case "optional-effect":
		fmt.Printf("\n• %s\n  %2d  发动\n  %2d  不发动\n", request.Reason, 1, 2)
		_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "effect", "enabled": choose("请选择  ", 2) == 0}})
	case "respond":
		fmt.Printf("\n• %s\n", request.Reason)
		for index, source := range request.Sources {
			fmt.Printf("  %2d  %s\n", index+1, source.Label)
		}
		fmt.Printf("  %2d  不应对\n", len(request.Sources)+1)
		picked := choose("请选择  ", len(request.Sources)+1)
		if picked >= 0 && picked < len(request.Sources) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "card", "sourceId": request.Sources[picked].SourceID}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "collateral":
		fmt.Printf("\n• %s\n", request.Reason)
		isIronChain := strings.Contains(request.Reason, "铁索连环")
		isCollateral := strings.Contains(request.Reason, "借刀杀人")
		for index, victim := range request.Victims {
			if isCollateral {
				fmt.Printf("  %2d  对 %s 使用杀\n", index+1, playerName(lastPlayers, victim))
			} else {
				fmt.Printf("  %2d  选择 %s\n", index+1, playerName(lastPlayers, victim))
			}
		}
		count := len(request.Victims)
		if request.AllowHandOverWeapon {
			if isCollateral {
				fmt.Printf("  %2d  交出武器\n", count+1)
			} else {
				fmt.Printf("  %2d  放弃\n", count+1)
			}
			count++
		}
		if isIronChain {
			fmt.Printf("  %2d  取消（只处理第一名角色）\n", count+1)
			count++
		}
		picked := choose("请选择  ", count)
		if picked >= 0 && picked < len(request.Victims) {
			decision := map[string]interface{}{"choice": "target", "targetId": request.Victims[picked]}
			if len(request.Sources) > 1 {
				fmt.Println("\n• 选择用于响应的杀")
				for index, source := range request.Sources {
					fmt.Printf("  %2d  %s\n", index+1, source.Label)
				}
				sourcePicked := choose("请选择  ", len(request.Sources))
				if sourcePicked >= 0 && sourcePicked < len(request.Sources) {
					decision["sourceId"] = request.Sources[sourcePicked].SourceID
				}
			}
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": decision})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "choose-suit":
		fmt.Printf("\n• %s\n", request.Reason)
		suitLabels := map[string]string{"heart": "红桃", "diamond": "方片", "club": "梅花", "spade": "黑桃"}
		for index, suit := range request.Suits {
			label := suitLabels[suit]
			if label == "" {
				label = suit
			}
			fmt.Printf("  %2d  声明%s\n", index+1, label)
		}
		suitPicked := choose("请选择  ", len(request.Suits))
		if suitPicked >= 0 && suitPicked < len(request.Suits) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "suit", "suit": request.Suits[suitPicked]}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	case "choose-discard", "choose-card":
		fmt.Printf("\n• %s\n", request.Reason)
		for index, source := range request.Sources {
			fmt.Printf("  %2d  %s\n", index+1, source.Label)
		}
		count := len(request.Sources)
		if request.AllowPass {
			passLabel := request.PassLabel
			if passLabel == "" {
				passLabel = "放弃"
			}
			fmt.Printf("  %2d  %s\n", count+1, passLabel)
			count++
		}
		picked := choose("请选择  ", count)
		if picked >= 0 && picked < len(request.Sources) {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "card", "sourceId": request.Sources[picked].SourceID}})
		} else {
			_ = send(writer, map[string]interface{}{"type": "interaction", "decision": map[string]interface{}{"choice": "pass"}})
		}
	}
}
