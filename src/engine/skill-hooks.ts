import { Card, CardType, DamageNature } from "./cards.js";
import { InteractionDecision, InteractionRequest, Player, SkillHook, SkillName, SkillTrigger } from "./types.js";

export type SkillHooksContext = {
  players: Player[];
  discardPile: Card[];
  hasSkill(player: Player, skill: SkillName): boolean;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  drawCard(): Card | null;
  drawCards(playerId: string, count: number): number;
  takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined>;
  drawTopCards(count: number): Card[];
  placeCardsOnTop(cards: Card[]): void;
  placeCardsOnBottom(cards: Card[]): void;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  buildUsableSources(player: Player): import("./interaction.js").CardSource[];
  requestDiscardSelection(
    player: Player,
    count: number,
    reason: string,
    providedSources?: import("./interaction.js").CardSource[],
    logs?: string[],
  ): Promise<Card[]>;
  choosePlayerCard(
    chooser: Player,
    target: Player,
    mode: "弃置" | "获得",
    reason: string,
    allowedZones: Array<"hand" | "weapon" | "armor" | "defenseHorse" | "attackHorse" | "treasure" | "judgment">,
    allowPass?: boolean,
  ): Promise<string[]>;
  obtainDamageCards(player: Player, cards: Card[], logs: string[]): number;
  markSkillUsed(playerId: string, skill: SkillName): void;
  hasRemovableCard(player: Player): boolean;
  drawJudgmentCard(reason: string, logs: string[], owner: Player): Promise<Card | null>;
  applyDamage(source: Player | null, target: Player, amount: number, reason: string, logs: string[], nature?: DamageNature, ignoreArmor?: boolean): Promise<void>;
};

export function createSkillHooks(ctx: SkillHooksContext): Record<SkillTrigger, SkillHook[]> {
  return {
    turn_start: [
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.LuoShen) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.LuoShen)) {
          return;
        }
        const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
        let gained = 0;
        while (true) {
          const card = await ctx.drawJudgmentCard(`${actor.name} 的${SkillName.LuoShen}`, logs, actor);
          if (!card) {
            logs.push(`${actor.name} 的${SkillName.LuoShen}判定失败：牌堆为空`);
            break;
          }
          if (card.color === "black") {
            const discardIndex = ctx.discardPile.findIndex((item) => item.id === card.id);
            const [obtained] = discardIndex < 0 ? [] : ctx.discardPile.splice(discardIndex, 1);
            if (obtained) {
              actor.hand.push(obtained);
              gained += 1;
              logs.push(`${actor.name} 的${SkillName.LuoShen}判定：${suitNames[card.suit]}${card.rank} ${card.type}，获得之`);
            }
            if (!await ctx.shouldActivateOptionalEffect(actor, SkillName.LuoShen)) break;
            continue;
          }
          logs.push(`${actor.name} 的${SkillName.LuoShen}判定：${suitNames[card.suit]}${card.rank} ${card.type}，停止判定`);
          break;
        }
        if (gained > 0) logs.push(`${actor.name} 的${SkillName.LuoShen}生效，共获得 ${gained} 张牌`);
      },
      (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.HunZi)) {
          return;
        }
        if (actor.skills.includes(SkillName.YingHun)) {
          return;
        }
        if (actor.hp !== 1) {
          return;
        }
        const newMax = Math.max(1, actor.maxHp - 1);
        actor.maxHp = newMax;
        actor.skills.push(SkillName.Heroic, SkillName.YingHun);
        logs.push(`${actor.name} 的${SkillName.HunZi}觉醒，体力上限-1 并获得${SkillName.Heroic}、${SkillName.YingHun}`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.YingHun) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.YingHun)) {
          return;
        }
        const lost = Math.max(0, actor.maxHp - actor.hp);
        if (lost <= 0) {
          return;
        }
        const others = ctx.players.filter((player) => player.alive && player.id !== actor.id);
        if (others.length === 0) {
          return;
        }
        const targetDecision = await ctx.decide({
          kind: "collateral",
          requestId: ctx.nextInteractionId(),
          targetId: actor.id,
          actorId: actor.id,
          victims: others.map((player) => player.id),
          sources: [],
          allowHandOverWeapon: false,
          reason: `${SkillName.YingHun}：选择一名其他角色`,
        });
        const target = targetDecision.choice === "target"
          ? others.find((player) => player.id === targetDecision.targetId)
          : undefined;
        if (!target) {
          return;
        }
        const x = lost;
        const optionDecision = await ctx.decide({
          kind: "optional-effect",
          requestId: ctx.nextInteractionId(),
          playerId: actor.id,
          effect: SkillName.YingHun,
          reason: `${SkillName.YingHun}：发动表示令${target.name}摸${x}弃1；不发动表示令其摸1弃${x}`,
        });
        if (optionDecision.choice === "effect" && optionDecision.enabled) {
          const drawn = ctx.drawCards(target.id, x);
          const discardSources = ctx.buildUsableSources(target).filter((source) => source.origin !== "treasure");
          const picked = await ctx.requestDiscardSelection(target, 1, `${SkillName.YingHun}：弃置1张牌`, discardSources, logs);
          ctx.discardPile.push(...picked);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${picked.length} 张牌`);
        } else {
          const drawn = ctx.drawCards(target.id, 1);
          const discardSources = ctx.buildUsableSources(target).filter((source) => source.origin !== "treasure");
          const picked = await ctx.requestDiscardSelection(target, x, `${SkillName.YingHun}：弃置${x}张牌`, discardSources, logs);
          ctx.discardPile.push(...picked);
          logs.push(`${actor.name} 的${SkillName.YingHun}生效，令 ${target.name} 摸 ${drawn} 张牌并弃置 ${picked.length} 张牌`);
        }
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || !ctx.hasSkill(actor, SkillName.GuanXing) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.GuanXing)) {
          return;
        }
        const aliveCount = ctx.players.filter((player) => player.alive).length;
        const count = Math.min(5, aliveCount);
        if (count <= 0) {
          return;
        }
        const drawn = ctx.drawTopCards(count);
        if (drawn.length === 0) {
          return;
        }
        const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
        logs.push(`${actor.name} 的${SkillName.GuanXing}生效，查看了牌堆顶 ${drawn.length} 张牌`);
        const kept: Card[] = [];
        const remaining = [...drawn];
        while (remaining.length > 0) {
          const sources = remaining.map((card) => ({
            sourceId: `guangxing:${card.id}`,
            origin: "hand" as const,
            card,
            label: `${suitNames[card.suit]}${card.rank} ${card.type}`,
          }));
          const decision = await ctx.decide({
            kind: "choose-card",
            requestId: ctx.nextInteractionId(),
            playerId: actor.id,
            reason: `${SkillName.GuanXing}：依次选择置于牌堆顶的牌（先选的更靠近牌堆顶，其余置入牌堆底）`,
            sources,
            count: 1,
            allowPass: true,
            passLabel: "完成观星",
          });
          if (decision.choice !== "card") {
            break;
          }
          const pickedCard = remaining.find((card) => card.id === decision.sourceId.slice("guangxing:".length));
          if (!pickedCard) {
            break;
          }
          remaining.splice(remaining.indexOf(pickedCard), 1);
          kept.push(pickedCard);
        }
        const bottom: Card[] = [];
        while (remaining.length > 0) {
          const sources = remaining.map((card) => ({
            sourceId: `guangxing-bottom:${card.id}`,
            origin: "hand" as const,
            card,
            label: `${suitNames[card.suit]}${card.rank} ${card.type}`,
          }));
          const decision = await ctx.decide({
            kind: "choose-card",
            requestId: ctx.nextInteractionId(),
            playerId: actor.id,
            reason: `${SkillName.GuanXing}：依次选择置于牌堆底的牌`,
            sources,
            count: 1,
            allowPass: false,
          });
          const selectedId = decision.choice === "card"
            ? decision.sourceId.slice("guangxing-bottom:".length)
            : remaining[0]?.id;
          const index = remaining.findIndex((card) => card.id === selectedId);
          const [picked] = remaining.splice(index >= 0 ? index : 0, 1);
          if (picked) bottom.push(picked);
        }
        ctx.placeCardsOnTop(kept);
        ctx.placeCardsOnBottom(bottom);
        logs.push(`${actor.name} 的${SkillName.GuanXing}结束：${kept.length} 张牌置于牌堆顶，${bottom.length} 张置于牌堆底`);
      },
    ],
    before_draw: [
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.Heroic) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.Heroic)) {
          return;
        }
        payload.drawCount += 1;
        logs.push(`${actor.name} 的${SkillName.Heroic}生效，额外摸 1 张牌`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.LuoYi) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.LuoYi) || payload.drawCount <= 0) {
          return;
        }
        payload.drawCount = Math.max(0, payload.drawCount - 1);
        ctx.markSkillUsed(actor.id, SkillName.LuoYi);
        logs.push(`${actor.name} 的${SkillName.LuoYi}生效，本回合少摸 1 张牌且伤害+1`);
      },
      async (payload, logs) => {
        const actor = payload.actor;
        if (!actor || payload.drawCount === undefined) {
          return;
        }
        if (!ctx.hasSkill(actor, SkillName.TuXi) || !await ctx.shouldActivateOptionalEffect(actor, SkillName.TuXi)) {
          return;
        }
        const candidates = ctx.players.filter((item) => item.alive && item.id !== actor.id && item.hand.length > 0);
        if (candidates.length === 0) return;
        const targets: Player[] = [];
        while (targets.length < 2 && candidates.length > 0) {
          const decision = await ctx.decide({
            kind: "collateral",
            requestId: ctx.nextInteractionId(),
            targetId: actor.id,
            actorId: actor.id,
            victims: candidates.map((item) => item.id),
            sources: [],
            allowHandOverWeapon: targets.length > 0,
            reason: `${SkillName.TuXi}：选择第 ${targets.length + 1} 名目标${targets.length > 0 ? "（可放弃）" : ""}`,
          });
          if (decision.choice !== "target") break;
          const index = candidates.findIndex((item) => item.id === decision.targetId);
          const [target] = index < 0 ? [] : candidates.splice(index, 1);
          if (!target) break;
          targets.push(target);
        }
        if (targets.length === 0) return;
        payload.drawCount = 0;
        let obtained = 0;
        for (const target of targets) {
          const card = await ctx.takeRandomHandCard(target, actor);
          if (card) {
            obtained += 1;
            logs.push(`${actor.name} 发动${SkillName.TuXi}，从 ${target.name} 处获得 1 张手牌`);
          }
        }
        logs.push(`${actor.name} 的${SkillName.TuXi}生效，本回合改为从 ${obtained} 名角色处各获得 1 张手牌`);
      },
    ],
    before_damage: [],
    after_damage: [
      async (payload, logs) => {
        const target = payload.target;
        const source = payload.source;
        if (!target) return;
        if (
          source?.alive &&
          ctx.hasSkill(target, SkillName.FanKui) &&
          ctx.hasRemovableCard(source) &&
          await ctx.shouldActivateOptionalEffect(target, SkillName.FanKui)
        ) {
          logs.push(...await ctx.choosePlayerCard(
            target,
            source,
            "获得",
            `${SkillName.FanKui}：选择获得${source.name}的一张手牌或装备牌`,
            ["hand", "weapon", "armor", "defenseHorse", "attackHorse", "treasure"],
            false,
          ));
        }
        const obtainableDamageCards = (payload.damageCards ?? []).filter((card) =>
          ctx.discardPile.some((discarded) => discarded.id === card.id),
        );
        if (
          obtainableDamageCards.length > 0 &&
          ctx.hasSkill(target, SkillName.JianXiong) &&
          await ctx.shouldActivateOptionalEffect(target, SkillName.JianXiong)
        ) {
          const obtained = ctx.obtainDamageCards(target, obtainableDamageCards, logs);
          logs.push(`${target.name} 的${SkillName.JianXiong}生效，获得了 ${obtained} 张造成伤害的牌`);
        }
        if (ctx.hasSkill(target, SkillName.YiJi)) {
          const damage = Math.max(0, payload.damage ?? 0);
          for (let point = 0; point < damage && target.alive; point += 1) {
            if (!await ctx.shouldActivateOptionalEffect(target, SkillName.YiJi)) continue;
            const remaining = ctx.drawTopCards(2);
            while (remaining.length > 0) {
              const targetDecision = await ctx.decide({
                kind: "collateral",
                requestId: ctx.nextInteractionId(),
                targetId: target.id,
                actorId: target.id,
                victims: ctx.players.filter((player) => player.alive).map((player) => player.id),
                sources: [],
                allowHandOverWeapon: true,
                reason: `${SkillName.YiJi}：选择获得牌的角色；放弃则剩余牌由自己获得`,
              });
              if (targetDecision.choice !== "target") {
                target.hand.push(...remaining.splice(0));
                break;
              }
              const receiver = ctx.players.find((player) => player.alive && player.id === targetDecision.targetId);
              if (!receiver) {
                target.hand.push(...remaining.splice(0));
                break;
              }
              const sources = remaining.map((card) => ({
                sourceId: `yiji:${card.id}`,
                origin: "hand" as const,
                card,
                label: `${card.suit}${card.rank} ${card.type}`,
              }));
              const cardDecision = await ctx.decide({
                kind: "choose-card",
                requestId: ctx.nextInteractionId(),
                playerId: target.id,
                reason: `${SkillName.YiJi}：选择交给${receiver.name}的牌`,
                sources,
                count: 1,
                allowPass: false,
              });
              const selectedId = cardDecision.choice === "card"
                ? cardDecision.sourceId.slice("yiji:".length)
                : remaining[0]?.id;
              const index = remaining.findIndex((card) => card.id === selectedId);
              const [given] = remaining.splice(index >= 0 ? index : 0, 1);
              if (given) {
                receiver.hand.push(given);
                logs.push(`${target.name} 发动${SkillName.YiJi}，将 ${given.type} 分配给 ${receiver.name}`);
              }
            }
          }
        }
        if (
          source?.alive &&
          source.id !== target.id &&
          ctx.hasSkill(target, SkillName.GangLie) &&
          await ctx.shouldActivateOptionalEffect(target, SkillName.GangLie)
        ) {
          const judgment = await ctx.drawJudgmentCard(`${target.name} 的${SkillName.GangLie}`, logs, target);
          const succeeded = judgment !== null && judgment.suit !== "heart";
          logs.push(`${target.name} 发动${SkillName.GangLie}，判定${succeeded ? "成功" : "失败"}`);
          if (succeeded) {
            let choseDiscard = false;
            if (source.hand.length >= 2) {
              const choice = await ctx.decide({
                kind: "optional-effect",
                requestId: ctx.nextInteractionId(),
                playerId: source.id,
                effect: SkillName.GangLie,
                reason: `${SkillName.GangLie}：发动表示弃置2张手牌；不发动表示受到1点伤害`,
              });
              choseDiscard = choice.choice === "effect" && choice.enabled;
            }
            if (choseDiscard) {
              const handSources = ctx.buildUsableSources(source).filter((item) => item.origin === "hand");
              const discarded = await ctx.requestDiscardSelection(
                source,
                2,
                `${SkillName.GangLie}：选择弃置2张手牌`,
                handSources,
                logs,
              );
              ctx.discardPile.push(...discarded);
              if (discarded.length === 2) logs.push(`${source.name} 为响应${SkillName.GangLie}弃置了 2 张手牌`);
              else choseDiscard = false;
            }
            if (!choseDiscard) {
              logs.push(`${source.name} 无法弃置 2 张牌，受到${SkillName.GangLie}的 1 点伤害`);
              await ctx.applyDamage(target, source, 1, SkillName.GangLie, logs);
            }
          }
        }
      },
    ],
  };
}
