import { BoxRenderable, TextRenderable, createCliRenderer } from "@opentui/core";
export class CliSanGuoApp {
    game;
    renderer;
    textView;
    logs;
    mode;
    actionOptions;
    targetOptions;
    pendingAction;
    constructor(game) {
        this.game = game;
        this.logs = [];
        this.mode = "action";
        this.actionOptions = [];
        this.targetOptions = [];
        this.pendingAction = null;
    }
    async start() {
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
            flexDirection: "column",
        });
        this.textView = new TextRenderable(this.renderer, {
            width: "100%",
            height: "100%",
            content: "",
        });
        rootBox.add(this.textView);
        this.renderer.root.add(rootBox);
        this.renderer.keyInput.on("keypress", (event) => this.onKeyPress(event));
        this.logs.push(...this.game.initDefaultGame());
        this.resolveAiTurns();
        this.refresh();
        this.renderer.start();
    }
    onKeyPress(event) {
        if (event.name === "q") {
            this.shutdown();
            return;
        }
        if (this.mode === "gameover") {
            if (event.name === "r") {
                this.restart();
            }
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
            this.handleActionChoice(action);
            return;
        }
        if (this.mode === "target") {
            const target = this.targetOptions[picked];
            if (!target || !this.pendingAction) {
                return;
            }
            const current = this.game.getCurrentPlayer();
            this.logs.push(...this.game.playAction(current.id, this.pendingAction, target.id));
            this.pendingAction = null;
            this.mode = "action";
            this.resolveAiTurns();
            this.refresh();
        }
    }
    handleActionChoice(action) {
        const current = this.game.getCurrentPlayer();
        if (action.type === "end") {
            this.logs.push(...this.game.playAction(current.id, action));
            this.resolveAiTurns();
            this.refresh();
            return;
        }
        if (!action.requiresTarget) {
            this.logs.push(...this.game.playAction(current.id, action));
            this.resolveAiTurns();
            this.refresh();
            return;
        }
        this.pendingAction = action;
        const snapshot = this.game.getSnapshot();
        this.targetOptions = snapshot.players.filter((player) => action.targets.includes(player.id));
        this.mode = "target";
        this.refresh();
    }
    resolveAiTurns() {
        while (!this.game.getSnapshot().gameOver && this.game.getCurrentPlayer().isAI) {
            this.logs.push(...this.game.runAITurn());
        }
        this.mode = this.game.getSnapshot().gameOver ? "gameover" : "action";
    }
    refresh() {
        if (!this.textView) {
            return;
        }
        const snapshot = this.game.getSnapshot();
        if (!snapshot.gameOver) {
            const current = this.game.getCurrentPlayer();
            this.actionOptions = current.isAI ? [] : this.game.getPlayableActions(current.id);
        }
        else {
            this.actionOptions = [];
        }
        const lines = [];
        lines.push(`回合: ${snapshot.turn}`);
        lines.push(`当前玩家: ${this.labelPlayer(snapshot.currentPlayerId)}`);
        lines.push(`阶段: ${snapshot.phase}`);
        lines.push(`牌堆: ${snapshot.deckCount}  弃牌堆: ${snapshot.discardCount}`);
        lines.push("");
        lines.push("玩家状态:");
        for (const player of snapshot.players) {
            const status = player.alive ? "存活" : "阵亡";
            const hand = player.isAI ? `${player.hand.length} 张` : this.describeHand(player.hand);
            lines.push(`- ${player.name} | HP ${Math.max(player.hp, 0)}/${player.maxHp} | 手牌 ${hand} | ${status}`);
        }
        lines.push("");
        lines.push("输入:");
        if (this.mode === "action") {
            this.actionOptions.forEach((action, index) => {
                lines.push(`${index + 1}. ${action.label}`);
            });
            if (this.actionOptions.length === 0) {
                lines.push("等待 AI 执行...");
            }
        }
        else if (this.mode === "target") {
            this.targetOptions.forEach((target, index) => {
                lines.push(`${index + 1}. 目标 ${target.name}`);
            });
        }
        else {
            lines.push("按 r 重开，按 q 退出");
        }
        lines.push("按 q 退出");
        lines.push("");
        lines.push("战报:");
        const latest = this.logs.slice(-14);
        for (const item of latest) {
            lines.push(`- ${item}`);
        }
        if (snapshot.gameOver) {
            lines.push("");
            if (snapshot.winner === "human") {
                lines.push("结果: 主公获胜");
            }
            else if (snapshot.winner === "ai") {
                lines.push("结果: 反贼获胜");
            }
            else {
                lines.push("结果: 平局");
            }
        }
        this.textView.content = lines.join("\n");
    }
    restart() {
        this.logs = [];
        this.pendingAction = null;
        this.targetOptions = [];
        this.actionOptions = [];
        this.logs.push(...this.game.initDefaultGame());
        this.resolveAiTurns();
        this.refresh();
    }
    shutdown() {
        if (this.renderer) {
            this.renderer.destroy();
        }
        process.exit(0);
    }
    labelPlayer(playerId) {
        const player = this.game.getSnapshot().players.find((item) => item.id === playerId);
        return player ? player.name : playerId;
    }
    describeHand(cards) {
        if (cards.length === 0) {
            return "0 张";
        }
        return cards.map((card, index) => `${index + 1}:${card.type}`).join(" ");
    }
    toOptionIndex(event) {
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
}
