import { CardType, createDeck, shuffle } from "./cards.js";
export var TurnPhase;
(function (TurnPhase) {
    TurnPhase["Draw"] = "\u6478\u724C\u9636\u6BB5";
    TurnPhase["Play"] = "\u51FA\u724C\u9636\u6BB5";
    TurnPhase["Discard"] = "\u5F03\u724C\u9636\u6BB5";
    TurnPhase["End"] = "\u7ED3\u675F\u9636\u6BB5";
})(TurnPhase || (TurnPhase = {}));
const drawCountPerTurn = 2;
export class SanGuoGame {
    players;
    deck;
    discardPile;
    currentPlayerIndex;
    turn;
    phase;
    slashUsedThisTurn;
    winner;
    rng;
    constructor(rng = Math.random) {
        this.rng = rng;
        this.players = [];
        this.deck = [];
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.turn = 1;
        this.phase = TurnPhase.Draw;
        this.slashUsedThisTurn = false;
        this.winner = null;
    }
    initDefaultGame() {
        this.players = [
            this.createPlayer("human", "主公", false),
            this.createPlayer("ai-1", "反贼A", true),
            this.createPlayer("ai-2", "反贼B", true),
        ];
        this.deck = shuffle(createDeck(), this.rng);
        this.discardPile = [];
        this.currentPlayerIndex = 0;
        this.turn = 1;
        this.phase = TurnPhase.Draw;
        this.winner = null;
        this.slashUsedThisTurn = false;
        const logs = ["对局开始，发牌中..."];
        for (const player of this.players) {
            const drawn = this.drawCards(player.id, 4);
            logs.push(`${player.name} 获得 ${drawn} 张手牌`);
        }
        logs.push(...this.startTurn());
        return logs;
    }
    getSnapshot() {
        return {
            turn: this.turn,
            currentPlayerId: this.currentPlayer.id,
            phase: this.phase,
            players: this.players.map((player) => ({
                ...player,
                hand: [...player.hand],
            })),
            winner: this.winner,
            gameOver: this.winner !== null,
            slashUsed: this.slashUsedThisTurn,
            deckCount: this.deck.length,
            discardCount: this.discardPile.length,
        };
    }
    getCurrentPlayer() {
        return this.currentPlayer;
    }
    getPlayableActions(playerId) {
        if (this.winner !== null) {
            return [];
        }
        const player = this.mustGetPlayer(playerId);
        if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
            return [];
        }
        const actions = [];
        player.hand.forEach((card, cardIndex) => {
            if (card.type === CardType.Dodge) {
                return;
            }
            if (card.type === CardType.Slash && this.slashUsedThisTurn) {
                return;
            }
            if (card.type === CardType.Peach && player.hp >= player.maxHp) {
                return;
            }
            const targets = this.findTargetsByCard(player.id, card.type);
            if (card.type !== CardType.Peach && targets.length === 0) {
                return;
            }
            actions.push({
                type: "play",
                cardIndex,
                label: `使用 ${card.type}`,
                requiresTarget: card.type !== CardType.Peach,
                targets,
            });
        });
        actions.push({ type: "end", label: "结束出牌阶段" });
        return actions;
    }
    playAction(playerId, action, targetId) {
        if (this.winner !== null) {
            return [];
        }
        if (action.type === "end") {
            return this.endPlayPhase(playerId);
        }
        const player = this.mustGetPlayer(playerId);
        if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
            return [];
        }
        const card = player.hand[action.cardIndex];
        if (!card) {
            return [`${player.name} 选择了无效卡牌`];
        }
        if (card.type === CardType.Slash && this.slashUsedThisTurn) {
            return [`${player.name} 本回合已使用过杀`];
        }
        if (card.type === CardType.Peach && player.hp >= player.maxHp) {
            return [`${player.name} 当前体力已满`];
        }
        if (card.type !== CardType.Peach) {
            if (!targetId) {
                return ["需要选择目标"];
            }
            const target = this.mustGetPlayer(targetId);
            if (!target.alive || target.id === player.id) {
                return ["目标无效"];
            }
        }
        const usedCard = player.hand.splice(action.cardIndex, 1)[0];
        if (!usedCard) {
            return ["使用卡牌失败"];
        }
        this.discardPile.push(usedCard);
        const logs = [];
        if (usedCard.type === CardType.Slash && targetId) {
            this.slashUsedThisTurn = true;
            logs.push(...this.resolveSlash(player, this.mustGetPlayer(targetId)));
        }
        else if (usedCard.type === CardType.Peach) {
            player.hp = Math.min(player.maxHp, player.hp + 1);
            logs.push(`${player.name} 使用桃，回复 1 点体力`);
        }
        else if (usedCard.type === CardType.Dismantle && targetId) {
            logs.push(...this.resolveDismantle(player, this.mustGetPlayer(targetId)));
        }
        logs.push(...this.resolveDeaths());
        logs.push(...this.resolveWinner());
        return logs;
    }
    runAITurn() {
        if (this.winner !== null || !this.currentPlayer.isAI || !this.currentPlayer.alive) {
            return [];
        }
        const logs = [];
        while (true) {
            const ai = this.currentPlayer;
            const actions = this.getPlayableActions(ai.id);
            const best = this.pickBestAiAction(actions, ai.id);
            if (!best || best.type === "end") {
                logs.push(...this.endPlayPhase(ai.id));
                return logs;
            }
            const targetId = best.requiresTarget ? this.pickBestTarget(best.targets) : undefined;
            logs.push(...this.playAction(ai.id, best, targetId));
            if (this.winner !== null) {
                return logs;
            }
        }
    }
    startTurn() {
        if (this.winner !== null) {
            return [];
        }
        this.phase = TurnPhase.Draw;
        this.slashUsedThisTurn = false;
        const player = this.currentPlayer;
        const logs = [`第 ${this.turn} 回合：${player.name} 的回合`];
        const drawn = this.drawCards(player.id, drawCountPerTurn);
        logs.push(`${player.name} 摸了 ${drawn} 张牌`);
        this.phase = TurnPhase.Play;
        return logs;
    }
    endPlayPhase(playerId) {
        const player = this.mustGetPlayer(playerId);
        if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
            return [];
        }
        this.phase = TurnPhase.Discard;
        const logs = [];
        while (player.hand.length > player.hp) {
            const index = this.randomIndex(player.hand.length);
            const removed = player.hand.splice(index, 1)[0];
            if (removed) {
                this.discardPile.push(removed);
                logs.push(`${player.name} 弃置了 ${removed.type}`);
            }
        }
        this.phase = TurnPhase.End;
        logs.push(`${player.name} 结束回合`);
        this.moveToNextPlayer();
        if (this.winner !== null) {
            return logs;
        }
        logs.push(...this.startTurn());
        return logs;
    }
    resolveSlash(attacker, target) {
        const logs = [`${attacker.name} 对 ${target.name} 使用杀`];
        const dodgeIndex = target.hand.findIndex((card) => card.type === CardType.Dodge);
        if (dodgeIndex >= 0) {
            const dodge = target.hand.splice(dodgeIndex, 1)[0];
            if (dodge) {
                this.discardPile.push(dodge);
            }
            logs.push(`${target.name} 打出闪，抵消了杀`);
            return logs;
        }
        target.hp -= 1;
        logs.push(`${target.name} 受到 1 点伤害，当前体力 ${Math.max(target.hp, 0)}`);
        return logs;
    }
    resolveDismantle(user, target) {
        const logs = [`${user.name} 对 ${target.name} 使用过河拆桥`];
        if (target.hand.length === 0) {
            logs.push(`${target.name} 没有手牌可拆`);
            return logs;
        }
        const index = this.randomIndex(target.hand.length);
        const removed = target.hand.splice(index, 1)[0];
        if (removed) {
            this.discardPile.push(removed);
            logs.push(`${target.name} 被弃置 1 张手牌`);
        }
        return logs;
    }
    resolveDeaths() {
        const logs = [];
        for (const player of this.players) {
            if (!player.alive) {
                continue;
            }
            if (player.hp > 0) {
                continue;
            }
            const peachIndex = player.hand.findIndex((card) => card.type === CardType.Peach);
            if (peachIndex >= 0) {
                const peach = player.hand.splice(peachIndex, 1)[0];
                if (peach) {
                    this.discardPile.push(peach);
                }
                player.hp = 1;
                logs.push(`${player.name} 打出桃自救，体力恢复到 1`);
            }
            else {
                player.alive = false;
                logs.push(`${player.name} 阵亡`);
            }
        }
        return logs;
    }
    resolveWinner() {
        const humanAlive = this.players.some((player) => !player.isAI && player.alive);
        const aiAlive = this.players.some((player) => player.isAI && player.alive);
        if (!humanAlive && !aiAlive) {
            this.winner = "draw";
        }
        else if (!humanAlive) {
            this.winner = "ai";
        }
        else if (!aiAlive) {
            this.winner = "human";
        }
        if (this.winner === null) {
            return [];
        }
        if (this.winner === "draw") {
            return ["全员阵亡，平局"];
        }
        if (this.winner === "human") {
            return ["主公胜利"];
        }
        return ["反贼胜利"];
    }
    drawCards(playerId, count) {
        const player = this.mustGetPlayer(playerId);
        let drawn = 0;
        for (let i = 0; i < count; i += 1) {
            const card = this.drawCard();
            if (!card) {
                break;
            }
            player.hand.push(card);
            drawn += 1;
        }
        return drawn;
    }
    drawCard() {
        if (this.deck.length === 0) {
            if (this.discardPile.length === 0) {
                return null;
            }
            this.deck = shuffle(this.discardPile, this.rng);
            this.discardPile = [];
        }
        const card = this.deck.shift();
        return card ?? null;
    }
    findTargetsByCard(playerId, cardType) {
        if (cardType === CardType.Peach) {
            return [];
        }
        return this.players
            .filter((player) => player.id !== playerId && player.alive)
            .map((player) => player.id);
    }
    moveToNextPlayer() {
        const livingPlayers = this.players.filter((player) => player.alive);
        if (livingPlayers.length <= 1) {
            this.resolveWinner();
            return;
        }
        let moved = false;
        for (let i = 0; i < this.players.length; i += 1) {
            this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
            if (this.players[this.currentPlayerIndex]?.alive) {
                moved = true;
                break;
            }
        }
        if (moved) {
            this.turn += 1;
        }
    }
    pickBestAiAction(actions, playerId) {
        const player = this.mustGetPlayer(playerId);
        const playable = actions.filter((action) => action.type === "play");
        const emergencyPeach = playable.find((action) => {
            if (action.type !== "play") {
                return false;
            }
            const card = player.hand[action.cardIndex];
            return card?.type === CardType.Peach && player.hp <= 2;
        });
        if (emergencyPeach) {
            return emergencyPeach;
        }
        const slash = playable.find((action) => {
            if (action.type !== "play") {
                return false;
            }
            const card = player.hand[action.cardIndex];
            return card?.type === CardType.Slash;
        });
        if (slash) {
            return slash;
        }
        const dismantle = playable.find((action) => {
            if (action.type !== "play") {
                return false;
            }
            const card = player.hand[action.cardIndex];
            return card?.type === CardType.Dismantle;
        });
        if (dismantle) {
            return dismantle;
        }
        const anyPlay = playable[0];
        if (anyPlay) {
            return anyPlay;
        }
        const end = actions.find((action) => action.type === "end");
        return end ?? null;
    }
    pickBestTarget(targets) {
        const candidates = targets
            .map((id) => this.mustGetPlayer(id))
            .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length);
        return candidates[0]?.id;
    }
    createPlayer(id, name, isAI) {
        return {
            id,
            name,
            isAI,
            hp: 4,
            maxHp: 4,
            hand: [],
            alive: true,
        };
    }
    mustGetPlayer(id) {
        const player = this.players.find((item) => item.id === id);
        if (!player) {
            throw new Error(`player not found: ${id}`);
        }
        return player;
    }
    randomIndex(length) {
        return Math.floor(this.rng() * length);
    }
    get currentPlayer() {
        const player = this.players[this.currentPlayerIndex];
        if (!player) {
            throw new Error("current player missing");
        }
        return player;
    }
}
