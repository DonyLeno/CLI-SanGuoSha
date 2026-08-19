import { Card, CardType, DamageNature, formatCard } from "./cards.js";
import {
  hasRemovableCard,
  isArmorCard,
  isAttackHorseCard,
  isDefenseHorseCard,
  isSlashCard,
  isWeaponCard,
} from "./card-utils.js";
import { resolveGeneralByName } from "./generals.js";
import {
  CardSource,
  EquipCardType,
  EquipmentZone,
  formatGameWinner,
  GameWinner,
  InteractionDecision,
  InteractionRequest,
  Player,
  PlayerRole,
  ResponseKind,
  SkillName,
} from "./types.js";

export type ResolveContext = {
  players: Player[];
  discardPile: Card[];
  winner: GameWinner | null;
  deferDyingResolution: boolean;
  skipDrawPhase: string | null;
  skipPlayPhase: string | null;
  turn: number;
  mustGetPlayer(id: string): Player;
  hasSkill(player: Player, skill: SkillName): boolean;
  shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean>;
  isSkillUsed(playerId: string, skill: SkillName): boolean;
  isKongChengProtected(target: Player, cardType: CardType): boolean;
  decide(request: InteractionRequest): Promise<InteractionDecision>;
  nextInteractionId(): number;
  buildUsableSources(player: Player): CardSource[];
  removeUsableCardBySourceId(player: Player, sourceId: string, logs?: string[]): Promise<Card | undefined>;
  removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined>;
  drawCards(playerId: string, count: number): number;
  drawTopCards(count: number): Card[];
  drawJudgmentCard(reason: string, logs: string[], owner: Player): Promise<Card | null>;
  resolvePendingDeaths(): Promise<string[]>;
  applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    nature?: DamageNature,
    ignoreArmor?: boolean,
    damageCards?: Card[],
  ): Promise<void>;
  canPlayerRespond(playerId: string, kind: ResponseKind): boolean;
  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void;
  requestCardResponse(
    player: Player,
    kind: ResponseKind,
    trigger: { cardName: string; actorId: string; targetId?: string },
    logs: string[],
    reasonOverride?: string,
  ): Promise<boolean>;
  requestDiscardSelection(
    player: Player,
    count: number,
    reason: string,
    providedSources?: CardSource[],
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
  consumeWineSlashBonus(playerId: string): number;
  consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean>;
  randomIndex(length: number): number;
  buildSlashSources(player: Player): CardSource[];
  buildDodgeSources(player: Player): CardSource[];
  getLastDamageSource(playerId: string): Player | null;
  clearLastDamageSource(playerId: string): void;
};

export function resolveSlash(
  ctx: ResolveContext,
  attacker: Player,
  target: Player,
  fromSerpent = false,
  fire = false,
  slashColor: Card["color"] = "colorless",
  thunder = false,
  damageBonus = 0,
  damageCards: Card[] = [],
  triggerAttackerSkill = true,
): Promise<string[]> {
  return (async () => {
    const slashType = fire ? CardType.FireSlash : thunder ? CardType.ThunderSlash : CardType.Slash;
    const logs = [`${attacker.name} 对 ${target.name} 使用${slashType}`];
    await triggerJiAng(ctx, attacker, target, slashColor === "red", logs, triggerAttackerSkill);
    if (ctx.isKongChengProtected(target, CardType.Slash)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为杀的目标`);
      return logs;
    }
    if (fromSerpent) {
      logs.push("本次杀来自丈八蛇矛转化");
    }
    // 流离：成为杀目标时，可弃1张牌将此杀转移给攻击范围内的其他角色
    if (ctx.hasSkill(target, SkillName.LiuLi)) {
      const redirectCandidates = ctx.players.filter(
        (player) =>
          player.alive &&
          player.id !== target.id &&
          player.id !== attacker.id &&
          canReachForSlash(ctx, target, player) &&
          !ctx.isKongChengProtected(player, CardType.Slash),
      );
      const liuLiSources = ctx.buildUsableSources(target).filter((source) => source.origin !== "treasure");
      if (redirectCandidates.length > 0 && liuLiSources.length > 0) {
        const redirectDecision = await ctx.decide({
          kind: "collateral",
          requestId: ctx.nextInteractionId(),
          targetId: target.id,
          actorId: attacker.id,
          victims: redirectCandidates.map((player) => player.id),
          sources: [],
          allowHandOverWeapon: false,
          reason: `${SkillName.LiuLi}：选择转移目标，或取消`,
        });
        const chosen = redirectDecision.choice === "target"
          ? redirectCandidates.find((player) => player.id === redirectDecision.targetId)
          : undefined;
        if (chosen) {
          const discardDecision = await ctx.decide({
            kind: "choose-discard",
            requestId: ctx.nextInteractionId(),
            playerId: target.id,
            reason: `${target.name} 的${SkillName.LiuLi}：选择弃置1张牌`,
            sources: liuLiSources,
            count: 1,
            allowPass: false,
          });
          if (discardDecision.choice === "card") {
            const discarded = await ctx.removeUsableCardBySourceId(target, discardDecision.sourceId);
            if (discarded) {
              ctx.discardPile.push(discarded);
              logs.push(`${target.name} 发动${SkillName.LiuLi}，弃置 ${discarded.type} 将杀转移给 ${chosen.name}`);
              logs.push(...(await resolveSlash(ctx, attacker, chosen, fromSerpent, fire, slashColor, thunder, damageBonus, damageCards, false)));
              return logs;
            }
          }
        }
      }
    }
    const ignoreArmor = attacker.weapon === CardType.QinggangSword;
    if (ignoreArmor) logs.push(`${attacker.name} 的${CardType.QinggangSword}生效，无视${target.name}的防具`);
    if (!fire && !thunder && !ignoreArmor && target.armor === CardType.VineArmor) {
      logs.push(`${target.name} 的藤甲生效，抵消了杀`);
      return logs;
    }
    if (slashColor === "black" && !ignoreArmor && target.armor === CardType.NiohShield) {
      logs.push(`${target.name} 的${CardType.NiohShield}生效，抵消了黑色杀`);
      return logs;
    }
    if (
      attacker.weapon === CardType.FemaleSword &&
      attacker.gender !== target.gender &&
      await ctx.shouldActivateOptionalEffect(attacker, CardType.FemaleSword)
    ) {
      if (target.hand.length > 0) {
        const decision = await ctx.decide({
          kind: "choose-discard",
          requestId: ctx.nextInteractionId(),
          playerId: target.id,
          reason: `${attacker.name} 的雌雄双股剑：弃置1张牌，或令其摸1张牌`,
          sources: ctx.buildUsableSources(target).filter((source) => source.origin === "hand"),
          count: 1,
          allowPass: true,
          passLabel: `令${attacker.name}摸1张牌`,
        });
        if (decision.choice === "card") {
          const removed = await ctx.removeUsableCardBySourceId(target, decision.sourceId);
          if (removed) {
            ctx.discardPile.push(removed);
            logs.push(`${attacker.name} 的雌雄双股剑生效，${target.name} 弃置了 ${removed.type}`);
          }
        } else {
          const drawn = ctx.drawCards(attacker.id, 1);
          logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
        }
      } else {
        const drawn = ctx.drawCards(attacker.id, 1);
        logs.push(`${attacker.name} 的雌雄双股剑生效，摸了 ${drawn} 张牌`);
      }
    }
    let requireDodgeCount = ctx.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
    if (ctx.hasSkill(attacker, SkillName.TieQi) && await ctx.shouldActivateOptionalEffect(attacker, SkillName.TieQi)) {
      const judgment = await ctx.drawJudgmentCard(`${attacker.name} 的${SkillName.TieQi}`, logs, attacker);
      if (judgment?.color === "red") {
        requireDodgeCount = 0;
        logs.push(`${attacker.name} 的${SkillName.TieQi}判定为红色，此杀不可被闪避`);
      }
    }
    let dodged = true;
    for (let i = 0; i < requireDodgeCount; i += 1) {
      if (!(await consumeDodgeResponse(
        ctx,
        target,
        { cardName: fire ? CardType.FireSlash : CardType.Slash, actorId: attacker.id },
        logs,
        !ignoreArmor,
      ))) {
        dodged = false;
        break;
      }
    }
    if (dodged && requireDodgeCount > 0) {
      const wushuangNote = requireDodgeCount > 1 ? `（${SkillName.WuShuang}消耗 ${requireDodgeCount} 张闪）` : "";
      logs.push(`${target.name} 打出闪，抵消了杀${wushuangNote}`);
      const axeCosts = ctx.buildUsableSources(attacker).filter(
        (source) => source.origin !== "treasure" && !(source.origin === "weapon" && source.card.type === CardType.RockCleavingAxe),
      );
      if (
        attacker.weapon === CardType.RockCleavingAxe &&
        axeCosts.length >= 2 &&
        await ctx.shouldActivateOptionalEffect(attacker, CardType.RockCleavingAxe)
      ) {
        const discarded = await ctx.requestDiscardSelection(
          attacker,
          2,
          `${CardType.RockCleavingAxe}：选择弃置2张牌令此杀继续生效`,
          axeCosts,
          logs,
        );
        if (discarded.length === 2) {
          ctx.discardPile.push(...discarded);
          logs.push(`${attacker.name} 的贯石斧生效，此次杀强制命中`);
        } else {
          return logs;
        }
      } else if (attacker.weapon === CardType.GreenDragonBlade) {
        const slashSources = ctx.buildSlashSources(attacker);
        if (
          slashSources.length > 0 &&
          await ctx.shouldActivateOptionalEffect(attacker, CardType.GreenDragonBlade)
        ) {
          const decision = await ctx.decide({
            kind: "choose-card",
            requestId: ctx.nextInteractionId(),
            playerId: attacker.id,
            reason: `${CardType.GreenDragonBlade}：选择再使用的一张杀`,
            sources: slashSources,
            count: 1,
            allowPass: false,
          });
          const selected = decision.choice === "card"
            ? slashSources.find((source) => source.sourceId === decision.sourceId)
            : undefined;
          const slash = selected ? await ctx.removeUsableCardBySourceId(attacker, selected.sourceId, logs) : undefined;
          if (slash) {
            ctx.discardPile.push(slash);
            const converted = !isSlashCard(slash.type);
            logs.push(`${attacker.name} 的青龙偃月刀生效，追加一张${converted ? "转化" : ""}杀`);
            logs.push(...(await resolveSlash(
              ctx,
              attacker,
              target,
              false,
              !converted && slash.type === CardType.FireSlash,
              slash.color,
              !converted && slash.type === CardType.ThunderSlash,
              0,
              [slash],
            )));
            return logs;
          }
        }
        return logs;
      } else {
        return logs;
      }
    }
    if (
      attacker.weapon === CardType.IceSword &&
      hasRemovableCard(target) &&
      await ctx.shouldActivateOptionalEffect(attacker, CardType.IceSword)
    ) {
      logs.push(`${attacker.name} 的寒冰剑生效，防止本次伤害并弃置目标2张牌`);
      logs.push(...await ctx.choosePlayerCard(
        attacker,
        target,
        "弃置",
        `${CardType.IceSword}：选择弃置${target.name}的第1张牌`,
        ["hand", "weapon", "armor", "defenseHorse", "attackHorse", "treasure", "judgment"],
        false,
      ));
      if (hasRemovableCard(target)) {
        logs.push(...await ctx.choosePlayerCard(
          attacker,
          target,
          "弃置",
          `${CardType.IceSword}：选择弃置${target.name}的第2张牌`,
          ["hand", "weapon", "armor", "defenseHorse", "attackHorse", "treasure", "judgment"],
          false,
        ));
      }
      return logs;
    }
    let damage = 1 + damageBonus;
    if (attacker.weapon === CardType.GudingBlade && target.hand.length === 0) {
      damage += 1;
      logs.push(`${attacker.name} 的古锭刀生效，伤害+1`);
    }
    if (ctx.isSkillUsed(attacker.id, SkillName.LuoYi)) {
      damage += 1;
      logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次杀伤害+1`);
    }
    await ctx.applyDamage(
      attacker,
      target,
      damage,
      "杀",
      logs,
      fire ? "fire" : thunder ? "thunder" : "normal",
      ignoreArmor,
      damageCards,
    );
    if (
      attacker.weapon === CardType.KylinBow &&
      (target.defenseHorse !== null || target.attackHorse !== null) &&
      await ctx.shouldActivateOptionalEffect(attacker, CardType.KylinBow)
    ) {
      logs.push(...await ctx.choosePlayerCard(
        attacker,
        target,
        "弃置",
        `${CardType.KylinBow}：选择弃置${target.name}装备区里的一张坐骑牌`,
        ["defenseHorse", "attackHorse"],
        false,
      ));
    }
    return logs;
  })();
}

export function resolveDismantle(ctx: ResolveContext, user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用过河拆桥`];
    if (await tryNegate(ctx, target, CardType.Dismantle, logs, user.id)) {
      return logs;
    }
    if (!hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可拆的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await removeSelectedCardFromPlayer(ctx, target, "弃置", selectedCardId);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await removeRandomCardFromPlayer(ctx, target, "弃置"));
    return logs;
  })();
}

export function resolveSnatch(ctx: ResolveContext, user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用顺手牵羊`];
    if (ctx.hasSkill(target, SkillName.QianXun)) {
      logs.push(`${target.name} 的${SkillName.QianXun}生效，不能成为顺手牵羊的目标`);
      return logs;
    }
    if (await tryNegate(ctx, target, CardType.Snatch, logs, user.id)) {
      return logs;
    }
    if (!hasRemovableCard(target)) {
      logs.push(`${target.name} 没有可获得的牌`);
      return logs;
    }
    if (selectedCardId) {
      const removedByChoice = await removeSelectedCardFromPlayer(ctx, target, "获得", selectedCardId, user);
      if (removedByChoice.length > 0) {
        logs.push(...removedByChoice);
        return logs;
      }
    }
    logs.push(...await removeRandomCardFromPlayer(ctx, target, "获得", user));
    return logs;
  })();
}

export function resolveDuel(
  ctx: ResolveContext,
  user: Player,
  target: Player,
  options: { skipNegate?: boolean; damageCards?: Card[] } = {},
): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 发起决斗`];
    await triggerJiAng(ctx, user, target, true, logs);
    if (ctx.isKongChengProtected(target, CardType.Duel)) {
      logs.push(`${target.name} 的${SkillName.KongCheng}生效，无法成为决斗目标`);
      return logs;
    }
    if (!options.skipNegate && await tryNegate(ctx, target, CardType.Duel, logs, user.id)) {
      return logs;
    }
    let attacker = user;
    let defender = target;
    while (true) {
      const needCount = ctx.hasSkill(attacker, SkillName.WuShuang) ? 2 : 1;
      let valid = true;
      const available = countAvailableSlashResponses(ctx, defender);
      if (available < needCount) {
        if (needCount > 1) {
          logs.push(`${defender.name} 面对${SkillName.WuShuang}，需 ${needCount} 张杀响应，仅有 ${available} 张，未能响应`);
        }
        valid = false;
      } else {
        for (let i = 0; i < needCount; i += 1) {
          if (!(await consumeSlashResponse(ctx, defender, { cardName: CardType.Duel, actorId: attacker.id }, logs))) {
            valid = false;
            break;
          }
        }
      }
      if (!valid) {
        let damage = 1;
        if (ctx.isSkillUsed(attacker.id, SkillName.LuoYi)) {
          damage += 1;
          logs.push(`${attacker.name} 的${SkillName.LuoYi}生效，本次决斗伤害+1`);
        }
        await ctx.applyDamage(attacker, defender, damage, "决斗", logs, "normal", false, options.damageCards ?? []);
        break;
      }
      const wushuangNote = needCount > 1 ? `（${SkillName.WuShuang}消耗 ${needCount} 张杀）` : "";
      logs.push(`${defender.name} 打出杀响应决斗${wushuangNote}`);
      const swap = attacker;
      attacker = defender;
      defender = swap;
    }
    return logs;
  })();
}

export function resolveBarbarian(ctx: ResolveContext, user: Player, damageCards: Card[] = []): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 使用南蛮入侵`];
    for (const target of ctx.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await tryNegate(ctx, target, CardType.Barbarian, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消南蛮入侵`);
        continue;
      }
      if (await consumeSlashResponse(ctx, target, { cardName: CardType.Barbarian, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出杀，抵消南蛮入侵`);
      } else {
        await ctx.applyDamage(user, target, 1, "南蛮入侵", logs, "normal", false, damageCards);
      }
    }
    return logs;
  })();
}

export function resolveArrowRain(ctx: ResolveContext, user: Player, damageCards: Card[] = []): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 使用万箭齐发`];
    for (const target of ctx.players) {
      if (!target.alive || target.id === user.id) {
        continue;
      }
      if (await tryNegate(ctx, target, CardType.ArrowRain, logs, user.id)) {
        continue;
      }
      if (target.armor === CardType.VineArmor) {
        logs.push(`${target.name} 的藤甲生效，抵消万箭齐发`);
        continue;
      }
      if (await consumeDodgeResponse(ctx, target, { cardName: CardType.ArrowRain, actorId: user.id }, logs)) {
        logs.push(`${target.name} 打出闪，抵消万箭齐发`);
      } else {
        await ctx.applyDamage(user, target, 1, "万箭齐发", logs, "normal", false, damageCards);
      }
    }
    return logs;
  })();
}

export function resolveCollateral(ctx: ResolveContext, user: Player, target: Player): Promise<string[]> {
  return (async () => {
    const logs = [`${user.name} 对 ${target.name} 使用借刀杀人`];
    const slashSources = ctx.buildSlashSources(target);
    const victims = ctx.players
      .filter(
        (player) =>
          player.alive &&
          player.id !== target.id &&
          canReachForSlash(ctx, target, player) &&
          !ctx.isKongChengProtected(player, CardType.Slash),
      )
      .sort((a, b) => a.hp - b.hp || a.hand.length - b.hand.length);
    if (victims.length === 0) {
      logs.push(`${target.name} 没有合法的杀目标`);
      return logs;
    }

    // 目标角色和其被迫使用杀的目标都在借刀杀人使用时确定，无懈只取消后续效果。
    const victimDecision = await ctx.decide({
      kind: "collateral",
      requestId: ctx.nextInteractionId(),
      targetId: user.id,
      actorId: user.id,
      victims: victims.map((v) => v.id),
      sources: [],
      allowHandOverWeapon: false,
      reason: "借刀杀人：请选择要被攻击的目标",
    });
    const chosenVictim =
      victimDecision.choice === "target"
        ? victims.find((v) => v.id === victimDecision.targetId)
        : victims[0];
    if (!chosenVictim) {
      logs.push(`${target.name} 无法攻击指定目标`);
      return logs;
    }
    if (await tryNegate(ctx, target, CardType.Collateral, logs, user.id)) {
      return logs;
    }

    // 目标角色选择使用杀，否则交出武器。
    const response = await ctx.decide({
      kind: "collateral",
      requestId: ctx.nextInteractionId(),
      targetId: target.id,
      actorId: user.id,
      victims: [chosenVictim.id],
      sources: slashSources,
      allowHandOverWeapon: target.weapon !== null,
      reason: `借刀杀人：对 ${chosenVictim.name} 使用杀？否则交出武器`,
    });
    if (response.choice === "target" && response.targetId === chosenVictim.id) {
      const sourceId = response.sourceId ?? slashSources[0]?.sourceId;
      const slash = sourceId ? await ctx.removeUsableCardBySourceId(target, sourceId) : undefined;
      if (slash) {
        ctx.discardPile.push(slash);
        logs.push(`${target.name} 对 ${chosenVictim.name} 使用杀`);
        logs.push(...(await resolveSlash(ctx, target, chosenVictim, false, slash.type === CardType.FireSlash, slash.color, slash.type === CardType.ThunderSlash, ctx.consumeWineSlashBonus(target.id), [slash])));
        return logs;
      }
    }
    // Target chose to hand over weapon (or couldn't slash)
    if (target.weapon === null) {
      logs.push(`${target.name} 无法出杀且没有武器`);
      return logs;
    }
    logs.push(...(await removeSelectedCardFromPlayer(ctx, target, "获得", "weapon", user)));
    return logs;
  })();
}

export function resolveDelayedTrick(ctx: ResolveContext, user: Player, usedCard: Card, targetId: string): Promise<string[]> {
  return (async () => {
    const target = ctx.mustGetPlayer(targetId);
    const logs = [`${user.name} 对 ${target.name} 使用 ${usedCard.type}`];
    if (usedCard.type === CardType.Indulgence && ctx.hasSkill(target, SkillName.QianXun)) {
      logs.push(`${target.name} 的${SkillName.QianXun}生效，不能成为乐不思蜀的目标`);
      ctx.discardPile.push(usedCard);
      return logs;
    }
    if (await tryNegate(ctx, target, usedCard.type, logs, user.id)) {
      ctx.discardPile.push(usedCard);
      return logs;
    }
    target.delayedTricks.push({ cardType: usedCard.type, sourcePlayerId: user.id, card: usedCard });
    logs.push(`${target.name} 的判定区增加了 ${usedCard.type}`);
    return logs;
  })();
}

export function resolveDelayedJudgments(ctx: ResolveContext, player: Player): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    const pendingTricks = [...player.delayedTricks].reverse();
    for (const pendingTrick of pendingTricks) {
      const index = player.delayedTricks.indexOf(pendingTrick);
      if (index < 0) continue;
      logs.push(...(await resolveSingleDelayedJudgment(ctx, player, index)));
      logs.push(...(await ctx.resolvePendingDeaths()));
      if (!player.alive || ctx.winner !== null) return logs;
    }
    return logs;
  })();
}

function moveLightningToNextLegalPlayer(
  ctx: ResolveContext,
  player: Player,
  trick: Player["delayedTricks"][number],
  delayedCard: Card,
  logs: string[],
): void {
  const alivePlayers = ctx.players.filter((candidate) => candidate.alive);
  const playerIndex = alivePlayers.findIndex((candidate) => candidate.id === player.id);
  for (let offset = 1; offset <= alivePlayers.length; offset += 1) {
    const candidate = alivePlayers[(playerIndex + offset) % alivePlayers.length];
    if (!candidate || candidate.delayedTricks.some((item) => item.cardType === CardType.Lightning)) continue;
    candidate.delayedTricks.push({ cardType: CardType.Lightning, sourcePlayerId: trick.sourcePlayerId, card: delayedCard });
    logs.push(`闪电移至 ${candidate.name} 的判定区`);
    return;
  }
  ctx.discardPile.push(delayedCard);
  logs.push("闪电没有合法的转移目标，置入弃牌堆");
}

export function resolveSingleDelayedJudgment(ctx: ResolveContext, player: Player, index: number): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    const trick = player.delayedTricks[index];
    if (!trick) return logs;
    player.delayedTricks.splice(index, 1);
    const delayedCard = trick.card ?? createCard(ctx, trick.cardType, `legacy-delayed-${player.id}`);
    if (await tryNegate(ctx, player, trick.cardType, logs, trick.sourcePlayerId)) {
      if (trick.cardType === CardType.Lightning) {
        logs.push(`${player.name} 判定区的${trick.cardType}本次失效`);
        moveLightningToNextLegalPlayer(ctx, player, trick, delayedCard, logs);
      } else {
        ctx.discardPile.push(delayedCard);
        logs.push(`${player.name} 判定区的${trick.cardType}本次失效并置入弃牌堆`);
      }
      return logs;
    }

    const judgment = await ctx.drawJudgmentCard(`${player.name} 的 ${trick.cardType}`, logs, player);
    if (!judgment) {
      if (trick.cardType === CardType.Lightning) moveLightningToNextLegalPlayer(ctx, player, trick, delayedCard, logs);
      else ctx.discardPile.push(delayedCard);
      return logs;
    }

    if (trick.cardType === CardType.Lightning) {
      if (judgment.suit === "spade" && judgment.rank >= 2 && judgment.rank <= 9) {
        logs.push(`${player.name} 的闪电判定为黑桃${judgment.rank}，受到 3 点雷电伤害`);
        ctx.discardPile.push(delayedCard);
        await ctx.applyDamage(null, player, 3, "闪电", logs, "thunder", false, [delayedCard]);
      } else {
        logs.push(`${player.name} 的闪电判定未命中`);
        moveLightningToNextLegalPlayer(ctx, player, trick, delayedCard, logs);
        return logs;
      }
    } else if (trick.cardType === CardType.SuppliesCut) {
      if (judgment.suit !== "club") {
        logs.push(`${player.name} 的兵粮寸断生效，跳过摸牌阶段`);
        ctx.skipDrawPhase = player.id;
      } else {
        logs.push(`${player.name} 的兵粮寸断判定为梅花，不生效`);
      }
    } else if (trick.cardType === CardType.Indulgence) {
      if (judgment.suit !== "heart") {
        logs.push(`${player.name} 的乐不思蜀生效，跳过出牌阶段`);
        ctx.skipPlayPhase = player.id;
      } else {
        logs.push(`${player.name} 的乐不思蜀判定为红桃，不生效`);
      }
    }
    if (!ctx.discardPile.some((card) => card.id === delayedCard.id)) ctx.discardPile.push(delayedCard);
    return logs;
  })();
}

export async function resolvePeachGarden(ctx: ResolveContext, user: Player): Promise<string[]> {
  const logs = [`${user.name} 使用桃园结义`];
  for (const target of getAlivePlayersFrom(ctx, user)) {
    if (await tryNegate(ctx, target, CardType.PeachGarden, logs, user.id)) continue;
    if (target.hp >= target.maxHp) {
      logs.push(`${target.name} 体力已满`);
      continue;
    }
    target.hp = Math.min(target.maxHp, target.hp + 1);
    logs.push(`${target.name} 回复 1 点体力`);
  }
  return logs;
}

export async function resolveHarvest(ctx: ResolveContext, user: Player): Promise<string[]> {
  const logs = [`${user.name} 使用五谷丰登`];
  const targets = getAlivePlayersFrom(ctx, user);
  const revealed = ctx.drawTopCards(targets.length);
  logs.push(`亮出 ${revealed.map(formatCard).join("、") || "无牌"}`);
  for (const target of targets) {
    if (await tryNegate(ctx, target, CardType.Harvest, logs, user.id)) continue;
    if (revealed.length === 0) break;
    const sources: CardSource[] = revealed.map((card) => ({
      sourceId: `harvest:${card.id}`,
      origin: "hand",
      card,
      label: formatCard(card),
    }));
    const decision = await ctx.decide({
      kind: "choose-card",
      requestId: ctx.nextInteractionId(),
      playerId: target.id,
      reason: `${CardType.Harvest}：选择获得一张亮出的牌`,
      sources,
      count: 1,
      allowPass: false,
    });
    const selectedId = decision.choice === "card" ? decision.sourceId.slice("harvest:".length) : revealed[0]?.id;
    const index = revealed.findIndex((card) => card.id === selectedId);
    const [picked] = revealed.splice(index >= 0 ? index : 0, 1);
    if (!picked) continue;
    target.hand.push(picked);
    logs.push(`${target.name} 从五谷丰登中获得 ${formatCard(picked)}`);
  }
  if (revealed.length > 0) {
    ctx.discardPile.push(...revealed);
    logs.push(`五谷丰登剩余 ${revealed.length} 张牌置入弃牌堆`);
  }
  return logs;
}

export async function resolveFireAttack(
  ctx: ResolveContext,
  user: Player,
  target: Player,
  damageCards: Card[] = [],
): Promise<string[]> {
  const logs = [`${user.name} 对 ${target.name} 使用${CardType.FireAttack}`];
  if (await tryNegate(ctx, target, CardType.FireAttack, logs, user.id)) return logs;
  if (target.hand.length === 0) {
    logs.push(`${target.name} 没有手牌，火攻不生效`);
    return logs;
  }
  const revealSources: CardSource[] = target.hand.map((card) => ({
    sourceId: `reveal:${card.id}`,
    origin: "hand",
    card,
    label: formatCard(card),
  }));
  const revealDecision = await ctx.decide({
    kind: "choose-card",
    requestId: ctx.nextInteractionId(),
    playerId: target.id,
    reason: `${CardType.FireAttack}：选择展示一张手牌`,
    sources: revealSources,
    count: 1,
    allowPass: false,
  });
  const revealId = revealDecision.choice === "card" ? revealDecision.sourceId.slice("reveal:".length) : target.hand[0]?.id;
  const revealed = target.hand.find((card) => card.id === revealId) ?? target.hand[0];
  if (!revealed) return logs;
  logs.push(`${target.name} 展示了 ${formatCard(revealed)}`);

  const discardSources = ctx.buildUsableSources(user).filter(
    (source) => source.origin === "hand" && source.card.suit === revealed.suit,
  );
  if (discardSources.length === 0) {
    logs.push(`${user.name} 没有与展示牌同花色的牌，火攻未造成伤害`);
    return logs;
  }
  const discardDecision = await ctx.decide({
    kind: "choose-discard",
    requestId: ctx.nextInteractionId(),
    playerId: user.id,
    reason: `${CardType.FireAttack}：可弃置一张${formatCard(revealed).slice(0, 1)}花色牌造成火焰伤害`,
    sources: discardSources,
    count: 1,
    allowPass: true,
    passLabel: "不弃牌",
  });
  if (discardDecision.choice !== "card") {
    logs.push(`${user.name} 放弃弃牌，火攻未造成伤害`);
    return logs;
  }
  const discarded = await ctx.removeUsableCardBySourceId(user, discardDecision.sourceId);
  if (!discarded || discarded.suit !== revealed.suit) return logs;
  ctx.discardPile.push(discarded);
  logs.push(`${user.name} 弃置 ${formatCard(discarded)}`);
  await ctx.applyDamage(user, target, 1, CardType.FireAttack, logs, "fire", false, damageCards);
  return logs;
}

export async function resolveIronChain(ctx: ResolveContext, user: Player, primary: Player): Promise<string[]> {
  const logs = [`${user.name} 使用${CardType.IronChain}`];
  const targets = [primary];
  const candidates = ctx.players.filter((player) => player.alive && player.id !== primary.id);
  if (candidates.length > 0) {
    const decision = await ctx.decide({
      kind: "collateral",
      requestId: ctx.nextInteractionId(),
      targetId: user.id,
      actorId: user.id,
      victims: candidates.map((player) => player.id),
      sources: [],
      allowHandOverWeapon: false,
      reason: `${CardType.IronChain}：可再选择一名角色，或取消并只处理第一名角色`,
    });
    const second = decision.choice === "target"
      ? candidates.find((player) => player.id === decision.targetId)
      : undefined;
    if (second) targets.push(second);
  }
  for (const target of targets) {
    if (await tryNegate(ctx, target, CardType.IronChain, logs, user.id)) continue;
    target.chained = !target.chained;
    logs.push(`${target.name} ${target.chained ? "横置并进入连环状态" : "重置并解除连环状态"}`);
  }
  return logs;
}

export function resolveEquip(ctx: ResolveContext, user: Player, equipCard: Card): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    const equipType = equipCard.type as EquipCardType;
    if (isWeaponCard(equipType)) {
      const previous = user.weapon;
      const previousCard = previous === null ? null : takeEquipmentCard(ctx, user, "weapon", previous);
      user.weapon = equipType;
      storeEquipmentCard(user, "weapon", equipCard);
      if (previous !== null && previousCard) {
        ctx.discardPile.push(previousCard);
        logs.push(`${user.name} 的旧武器 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isArmorCard(equipType)) {
      const previous = user.armor;
      const previousCard = previous === null ? null : takeEquipmentCard(ctx, user, "armor", previous);
      user.armor = equipType;
      storeEquipmentCard(user, "armor", equipCard);
      if (previous !== null && previousCard) {
        ctx.discardPile.push(previousCard);
        logs.push(`${user.name} 的旧防具 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isDefenseHorseCard(equipType)) {
      const previous = user.defenseHorse;
      const previousCard = previous === null ? null : takeEquipmentCard(ctx, user, "defenseHorse", previous);
      user.defenseHorse = equipType;
      storeEquipmentCard(user, "defenseHorse", equipCard);
      if (previous !== null && previousCard) {
        ctx.discardPile.push(previousCard);
        logs.push(`${user.name} 的旧+1马 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    if (isAttackHorseCard(equipType)) {
      const previous = user.attackHorse;
      const previousCard = previous === null ? null : takeEquipmentCard(ctx, user, "attackHorse", previous);
      user.attackHorse = equipType;
      storeEquipmentCard(user, "attackHorse", equipCard);
      if (previous !== null && previousCard) {
        ctx.discardPile.push(previousCard);
        logs.push(`${user.name} 的旧-1马 ${previous} 被替换并弃置`);
        logs.push(...(await onLoseEquip(ctx, user, previous)));
      }
      logs.push(`${user.name} 装备了${equipType}`);
      return logs;
    }
    const previous = user.treasure;
    const previousCard = previous === null ? null : takeEquipmentCard(ctx, user, "treasure", previous);
    user.treasure = equipType;
    storeEquipmentCard(user, "treasure", equipCard);
    if (previous !== null && previousCard) {
      ctx.discardPile.push(previousCard);
      discardWoodenOxStorage(ctx, user, logs);
      logs.push(`${user.name} 的旧宝物 ${previous} 被替换并弃置`);
      logs.push(...(await onLoseEquip(ctx, user, previous)));
    }
    logs.push(`${user.name} 装备了${equipType}`);
    return logs;
  })();
}

export async function moveWoodenOx(ctx: ResolveContext, user: Player, target: Player): Promise<string[]> {
  if (user.treasure !== CardType.WoodenOx || target.treasure !== null) return ["目标无效"];
  const logs = [`${user.name} 将${CardType.WoodenOx}移动给${target.name}`];
  const woodenOxCard = takeEquipmentCard(ctx, user, "treasure", CardType.WoodenOx);
  user.treasure = null;
  logs.push(...(await onLoseEquip(ctx, user, CardType.WoodenOx)));
  target.treasure = CardType.WoodenOx;
  storeEquipmentCard(target, "treasure", woodenOxCard);
  target.treasureCards.push(...user.treasureCards);
  user.treasureCards = [];
  return logs;
}

export function resolveDeaths(ctx: ResolveContext): Promise<string[]> {
  return (async () => {
    if (ctx.deferDyingResolution) return [];
    const logs: string[] = [];
    for (const player of ctx.players) {
      if (!player.alive || player.hp > 0) continue;
      logs.push(`${player.name} 进入濒死状态（体力 ${player.hp}），需要 ${1 - player.hp} 个回复点`);
      while (player.hp <= 0) {
        let rescuedThisRound = false;
        for (const rescuer of [player, ...getRescuersInOrder(ctx, player)]) {
          if (!(await ctx.consumePeachResponse(rescuer, player.id, logs))) continue;
          let recovered = 1;
          if (
            rescuer.id !== player.id &&
            ctx.hasSkill(player, SkillName.JiuYuan) &&
            player.role === PlayerRole.Lord &&
            getPlayerKingdom(ctx, rescuer) === "吴"
          ) {
            recovered += 1;
            logs.push(`${player.name} 的${SkillName.JiuYuan}生效，额外回复 1 点体力`);
          }
          player.hp = Math.min(player.maxHp, player.hp + recovered);
          logs.push(`${rescuer.name} 对${player.name}使用${CardType.Peach}，其体力恢复到 ${player.hp}`);
          rescuedThisRound = true;
          break;
        }
        if (!rescuedThisRound) break;
      }
      if (player.hp > 0) continue;

      const killer = ctx.getLastDamageSource(player.id);
      player.alive = false;
      await discardAllPlayerCards(ctx, player, logs, true);
      ctx.clearLastDamageSource(player.id);
      logs.push(`${player.name} 阵亡，身份：${player.role}`);
      if (player.role === PlayerRole.Rebel && killer?.alive) {
        const drawn = ctx.drawCards(killer.id, 3);
        logs.push(`${killer.name} 击杀反贼，摸了 ${drawn} 张牌`);
      } else if (player.role === PlayerRole.Loyalist && killer?.alive && killer.role === PlayerRole.Lord) {
        await discardAllPlayerCards(ctx, killer, logs, false);
        logs.push(`${killer.name} 误杀忠臣，弃置所有手牌和装备牌`);
      }
    }
    return logs;
  })();
}

export function getPlayerKingdom(ctx: ResolveContext, player: Player): "魏" | "蜀" | "吴" | "群雄" {
  return resolveGeneralByName(player.general).kingdom;
}

export function getKingdomRespondersInOrder(
  ctx: ResolveContext,
  requester: Player,
  kingdom: "魏" | "蜀" | "吴" | "群雄",
): Player[] {
  const start = ctx.players.findIndex((item) => item.id === requester.id);
  const ordered: Player[] = [];
  for (let i = 1; i < ctx.players.length; i += 1) {
    const index = (start + i) % ctx.players.length;
    const candidate = ctx.players[index];
    if (!candidate || !candidate.alive || candidate.id === requester.id) {
      continue;
    }
    if (getPlayerKingdom(ctx, candidate) !== kingdom) {
      continue;
    }
    ordered.push(candidate);
  }
  return ordered;
}

export function getRescuersInOrder(ctx: ResolveContext, target: Player): Player[] {
  const start = ctx.players.findIndex((item) => item.id === target.id);
  const ordered: Player[] = [];
  for (let i = 1; i < ctx.players.length; i += 1) {
    const index = (start + i) % ctx.players.length;
    const candidate = ctx.players[index];
    if (!candidate || !candidate.alive || candidate.id === target.id) {
      continue;
    }
    ordered.push(candidate);
  }
  return ordered;
}

export function resolveWinner(ctx: ResolveContext): string[] {
  const alivePlayers = ctx.players.filter((player) => player.alive);
  if (alivePlayers.length === 0) {
    ctx.winner = "draw";
  } else {
    const lordAlive = alivePlayers.some((player) => player.role === PlayerRole.Lord);
    const rebelAlive = alivePlayers.some((player) => player.role === PlayerRole.Rebel);
    const traitorAlive = alivePlayers.some((player) => player.role === PlayerRole.Traitor);
    if (!lordAlive) {
      ctx.winner = alivePlayers.length === 1 && alivePlayers[0]?.role === PlayerRole.Traitor
        ? "traitor"
        : "rebel";
    } else if (!rebelAlive && !traitorAlive) {
      ctx.winner = "lord";
    } else {
      return [];
    }
  }
  if (ctx.winner === "draw") {
    return ["全员阵亡，平局"];
  }
  return [formatGameWinner(ctx.winner)];
}

export function canReachForSlash(ctx: ResolveContext, attacker: Player, target: Player): boolean {
  const distance = computeDistance(ctx, attacker, target);
  return distance <= getAttackRange(attacker);
}

export function getAttackRange(player: Player): number {
  if (!player.weapon) {
    return 1;
  }
  if (
    player.weapon === CardType.FemaleSword ||
    player.weapon === CardType.QinggangSword ||
    player.weapon === CardType.IceSword ||
    player.weapon === CardType.GudingBlade
  ) {
    return 2;
  }
  if (
    player.weapon === CardType.SerpentSpear ||
    player.weapon === CardType.GreenDragonBlade ||
    player.weapon === CardType.RockCleavingAxe
  ) {
    return 3;
  }
  if (player.weapon === CardType.Halberd || player.weapon === CardType.ZhuqueFan) {
    return 4;
  }
  if (player.weapon === CardType.KylinBow) {
    return 5;
  }
  return 1;
}

export function computeDistance(ctx: ResolveContext, attacker: Player, target: Player): number {
  return computeDistanceBetween(ctx.players, attacker, target);
}

// 纯快照版距离计算：仅依赖 players 数组（座位序）+ 攻防双方字段，供 UI/Go 客户端本地展示复用。
export function computeDistanceBetween(players: Player[], attacker: Player, target: Player): number {
  const alivePlayers = players.filter((player) => player.alive);
  const attackerIndex = alivePlayers.findIndex((item) => item.id === attacker.id);
  const targetIndex = alivePlayers.findIndex((item) => item.id === target.id);
  if (attackerIndex < 0 || targetIndex < 0) {
    return 99;
  }
  const gap = Math.abs(attackerIndex - targetIndex);
  const ringDistance = Math.min(gap, alivePlayers.length - gap);
  let distance = ringDistance;
  if (attacker.attackHorse !== null) {
    distance -= 1;
  }
  if (attacker.skills.includes(SkillName.MaShu)) {
    distance -= 1;
  }
  if (target.defenseHorse !== null) {
    distance += 1;
  }
  return Math.max(1, distance);
}

export function expandSlashTargets(ctx: ResolveContext, player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]> {
  return (async () => {
    if (player.weapon !== CardType.Halberd || !isLastHandSlash) {
      return [primary];
    }
    const candidates = ctx.players.filter(
      (item) =>
        item.alive &&
        item.id !== player.id &&
        item.id !== primary.id &&
        canReachForSlash(ctx, player, item) &&
        !ctx.isKongChengProtected(item, CardType.Slash),
    );
    const extras: Player[] = [];
    while (extras.length < 2 && candidates.length > 0) {
      const decision = await ctx.decide({
        kind: "collateral",
        requestId: ctx.nextInteractionId(),
        targetId: player.id,
        actorId: player.id,
        victims: candidates.map((candidate) => candidate.id),
        sources: [],
        allowHandOverWeapon: true,
        reason: `${CardType.Halberd}：选择第${extras.length + 1}名额外目标，或取消`,
      });
      if (decision.choice !== "target") break;
      const index = candidates.findIndex((candidate) => candidate.id === decision.targetId);
      const [picked] = index < 0 ? [] : candidates.splice(index, 1);
      if (!picked) break;
      extras.push(picked);
    }
    return [primary, ...extras];
  })();
}

export function countDirectDodgeSources(ctx: ResolveContext, player: Player): number {
  return ctx.buildDodgeSources(player).length;
}

export function countAvailableDodgeResponses(ctx: ResolveContext, player: Player): number {
  let count = countDirectDodgeSources(ctx, player);
  if (player.role === PlayerRole.Lord && ctx.hasSkill(player, SkillName.HuJia)) {
    for (const responder of getKingdomRespondersInOrder(ctx, player, "魏")) {
      count += countDirectDodgeSources(ctx, responder);
    }
  }
  return count;
}

export function countDirectSlashSources(ctx: ResolveContext, player: Player): number {
  const directSourceIds = new Set(ctx.buildSlashSources(player).map((source) => source.sourceId));
  let count = directSourceIds.size;
  if (player.weapon === CardType.SerpentSpear) {
    const remainingHandLikeCards = ctx.buildUsableSources(player).filter(
      (source) =>
        (source.origin === "hand" || source.origin === "treasure") &&
        !directSourceIds.has(source.sourceId),
    ).length;
    count += Math.floor(remainingHandLikeCards / 2);
  }
  return count;
}

export function countAvailableSlashResponses(ctx: ResolveContext, player: Player): number {
  let count = countDirectSlashSources(ctx, player);
  if (player.role === PlayerRole.Lord && ctx.hasSkill(player, SkillName.JiJiang)) {
    for (const responder of getKingdomRespondersInOrder(ctx, player, "蜀")) {
      count += countDirectSlashSources(ctx, responder);
    }
  }
  return count;
}

export function consumeDodgeResponse(
  ctx: ResolveContext,
  player: Player,
  trigger: { cardName: string; actorId: string },
  logs: string[],
  allowEightDiagram = true,
  allowHuJia = true,
): Promise<boolean> {
  return (async () => {
    if (!ctx.canPlayerRespond(player.id, "dodge")) {
      ctx.setPlayerResponseSelection(player.id, "dodge", null);
      return false;
    }
    if (
      allowEightDiagram &&
      player.armor === CardType.EightDiagram &&
      await ctx.shouldActivateOptionalEffect(player, CardType.EightDiagram)
    ) {
      const judgment = await ctx.drawJudgmentCard(`${player.name} 的${CardType.EightDiagram}`, logs, player);
      if (judgment?.color === "red") {
        logs.push(`${player.name} 的${CardType.EightDiagram}判定为红色，视为打出闪`);
        return true;
      }
      logs.push(`${player.name} 的${CardType.EightDiagram}判定未通过`);
    }
    if (await ctx.requestCardResponse(player, "dodge", trigger, logs)) {
      return true;
    }
    if (!allowHuJia || player.role !== PlayerRole.Lord || !ctx.hasSkill(player, SkillName.HuJia)) {
      return false;
    }
    const responders = getKingdomRespondersInOrder(ctx, player, "魏");
    for (const responder of responders) {
      if (await consumeDodgeResponse(ctx, responder, trigger, logs, true, false)) {
        logs.push(`${player.name} 的${SkillName.HuJia}生效，${responder.name}为其提供了${CardType.Dodge}`);
        return true;
      }
    }
    return false;
  })();
}

export function consumeSlashResponse(
  ctx: ResolveContext,
  player: Player,
  trigger: { cardName: string; actorId: string },
  logs: string[],
): Promise<boolean> {
  return (async () => {
    if (!ctx.canPlayerRespond(player.id, "slash")) {
      ctx.setPlayerResponseSelection(player.id, "slash", null);
      return false;
    }
    if (await ctx.requestCardResponse(player, "slash", trigger, logs)) {
      return true;
    }
    const serpentSources = ctx.buildUsableSources(player).filter(
      (source) => source.origin === "hand" || source.origin === "treasure",
    );
    if (
      player.weapon === CardType.SerpentSpear &&
      serpentSources.length >= 2 &&
      await ctx.shouldActivateOptionalEffect(player, CardType.SerpentSpear)
    ) {
      const costs = await ctx.requestDiscardSelection(
        player,
        2,
        `${CardType.SerpentSpear}：选择两张手牌/粮当${CardType.Slash}打出`,
        serpentSources,
        logs,
      );
      if (costs.length > 0) ctx.discardPile.push(...costs);
      if (costs.length === 2) {
        logs.push(`${player.name} 发动${CardType.SerpentSpear}，将两张手牌/粮当${CardType.Slash}打出`);
        return true;
      }
    }
    if (player.role !== PlayerRole.Lord || !ctx.hasSkill(player, SkillName.JiJiang)) {
      return false;
    }
    const responders = getKingdomRespondersInOrder(ctx, player, "蜀");
    for (const responder of responders) {
      if (await consumeSlashResponse(ctx, responder, trigger, logs)) {
        logs.push(`${player.name} 的${SkillName.JiJiang}生效，${responder.name}为其提供了${CardType.Slash}`);
        return true;
      }
    }
    return false;
  })();
}

export function onLoseEquip(ctx: ResolveContext, player: Player, equip: EquipCardType): Promise<string[]> {
  return (async () => {
    const logs: string[] = [];
    if (player.alive && ctx.hasSkill(player, SkillName.XiaoJi) && await ctx.shouldActivateOptionalEffect(player, SkillName.XiaoJi)) {
      const drawn = ctx.drawCards(player.id, 2);
      if (drawn > 0) {
        logs.push(`${player.name} 的${SkillName.XiaoJi}生效，摸了 ${drawn} 张牌`);
      }
    }
    if (player.alive && equip === CardType.SilverLion && player.hp < player.maxHp) {
      player.hp += 1;
      logs.push(`${player.name} 失去白银狮子，回复 1 点体力`);
    }
    return logs;
  })();
}

export function createCard(ctx: ResolveContext, type: CardType, seed: string): Card {
  return { id: `${type}-${seed}-${ctx.turn}`, type, color: "colorless", suit: "none", rank: 0 };
}

function storeEquipmentCard(player: Player, zone: EquipmentZone, card: Card): void {
  player.equippedCards ??= {};
  player.equippedCards[zone] = card;
}

function takeEquipmentCard(
  ctx: ResolveContext,
  player: Player,
  zone: EquipmentZone,
  fallbackType: EquipCardType,
): Card {
  const card = player.equippedCards?.[zone];
  if (player.equippedCards) delete player.equippedCards[zone];
  return card ?? createCard(ctx, fallbackType, `legacy-equip-${player.id}-${zone}`);
}

function discardWoodenOxStorage(ctx: ResolveContext, player: Player, logs: string[]): void {
  if (player.treasureCards.length === 0) return;
  const dropped = player.treasureCards.splice(0);
  ctx.discardPile.push(...dropped);
  logs.push(`${player.name} 的${CardType.WoodenOx}离开装备区，其下 ${dropped.length} 张牌置入弃牌堆`);
}

async function discardAllPlayerCards(ctx: ResolveContext, player: Player, logs: string[], includeDelayed: boolean): Promise<void> {
  const cards = player.hand.splice(0);
  const lostEquips: EquipCardType[] = [];
  for (const [zone, type] of [
    ["weapon", player.weapon],
    ["armor", player.armor],
    ["defenseHorse", player.defenseHorse],
    ["attackHorse", player.attackHorse],
    ["treasure", player.treasure],
  ] as const) {
    if (type !== null) {
      cards.push(takeEquipmentCard(ctx, player, zone, type));
      lostEquips.push(type);
    }
  }
  cards.push(...player.treasureCards.splice(0));
  player.weapon = null;
  player.armor = null;
  player.defenseHorse = null;
  player.attackHorse = null;
  player.treasure = null;
  if (includeDelayed) {
    for (const trick of player.delayedTricks.splice(0)) {
      cards.push(trick.card ?? createCard(ctx, trick.cardType, `legacy-death-delayed-${player.id}`));
    }
  }
  ctx.discardPile.push(...cards);
  if (cards.length > 0) logs.push(`${player.name} 的 ${cards.length} 张牌置入弃牌堆`);
  for (const equip of lostEquips) {
    logs.push(...(await onLoseEquip(ctx, player, equip)));
  }
}

export function tryNegate(ctx: ResolveContext, target: Player, trickType: CardType, logs: string[], actorId = ""): Promise<boolean> {
  return (async () => {
    let negated = false;
    let startIndex = Math.max(0, ctx.players.findIndex((player) => player.id === target.id));
    let lastNegateResponder: Player | undefined;
    while (true) {
      let responder: Player | undefined;
      for (let offset = 0; offset < ctx.players.length; offset += 1) {
        const candidate = ctx.players[(startIndex + offset) % ctx.players.length];
        if (!candidate?.alive || !ctx.canPlayerRespond(candidate.id, "negate")) continue;
        if (lastNegateResponder === undefined && actorId !== "" && candidate.id === actorId) continue;
        if (candidate.id === lastNegateResponder?.id) continue;
        const previousResponder = lastNegateResponder;
        const respondingToNegate = previousResponder !== undefined;
        const reason = previousResponder
          ? `${previousResponder.name}打出的${CardType.Negate}${negated ? `正在抵消${trickType}对${target.name}的效果` : `正在令${trickType}对${target.name}重新生效`}：是否再打出${CardType.Negate}进行反制？`
          : `${trickType}即将对${target.name}生效：是否打出${CardType.Negate}抵消该目标的锦囊效果？`;
        if (await ctx.requestCardResponse(
          candidate,
          "negate",
          {
            cardName: respondingToNegate ? CardType.Negate : trickType,
            actorId: previousResponder?.id ?? actorId,
            targetId: target.id,
          },
          logs,
          reason,
        )) {
          responder = candidate;
          startIndex = (ctx.players.indexOf(candidate) + 1) % ctx.players.length;
          break;
        }
      }
      if (!responder) break;
      negated = !negated;
      lastNegateResponder = responder;
      logs.push(`${responder.name} 打出${CardType.Negate}，${negated ? `抵消了${trickType}` : `令${trickType}重新生效`}`);
    }
    return negated;
  })();
}

function getAlivePlayersFrom(ctx: ResolveContext, startingPlayer: Player): Player[] {
  const start = Math.max(0, ctx.players.findIndex((player) => player.id === startingPlayer.id));
  const ordered: Player[] = [];
  for (let offset = 0; offset < ctx.players.length; offset += 1) {
    const player = ctx.players[(start + offset) % ctx.players.length];
    if (player?.alive) ordered.push(player);
  }
  return ordered;
}

export function removeRandomCardFromPlayer(
  ctx: ResolveContext,
  player: Player,
  mode: "弃置" | "获得",
  receiver?: Player,
): Promise<string[]> {
  const options: string[] = [];
  for (let i = 0; i < player.hand.length; i += 1) {
    options.push("hand-random");
  }
  if (player.weapon !== null) {
    options.push("weapon");
  }
  if (player.armor !== null) {
    options.push("armor");
  }
  if (player.defenseHorse !== null) {
    options.push("defenseHorse");
  }
  if (player.attackHorse !== null) {
    options.push("attackHorse");
  }
  if (player.treasure !== null) {
    options.push("treasure");
  }
  for (const trick of player.delayedTricks) {
    options.push(`delayed:${trick.card?.id ?? trick.cardType}`);
  }
  if (options.length === 0) {
    return Promise.resolve([]);
  }
  const picked = options[ctx.randomIndex(options.length)];
  if (!picked) {
    return Promise.resolve([]);
  }
  return removeSelectedCardFromPlayer(ctx, player, mode, picked, receiver);
}

export function removeSelectedCardFromPlayer(
  ctx: ResolveContext,
  player: Player,
  mode: "弃置" | "获得",
  selectedCardId: string,
  receiver?: Player,
): Promise<string[]> {
  return (async () => {
    if (selectedCardId === "hand-random") {
      if (player.hand.length === 0) {
        return [];
      }
      const index = ctx.randomIndex(player.hand.length);
      const extraLogs: string[] = [];
      const removed = await ctx.removeHandCardAt(player, index, extraLogs);
      if (!removed) {
        return extraLogs;
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [...extraLogs, `${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      ctx.discardPile.push(removed);
      return [...extraLogs, `${player.name} 的手牌 ${formatCard(removed)} 被弃置`];
    }
    if (selectedCardId.startsWith("hand:")) {
      const handCardId = selectedCardId.slice(5);
      const index = player.hand.findIndex((card) => card.id === handCardId);
      if (index < 0) {
        return [];
      }
      const extraLogs: string[] = [];
      const removed = await ctx.removeHandCardAt(player, index, extraLogs);
      if (!removed) {
        return extraLogs;
      }
      if (mode === "获得" && receiver) {
        receiver.hand.push(removed);
        return [...extraLogs, `${receiver.name} 获得了 ${player.name} 的 1 张手牌`];
      }
      ctx.discardPile.push(removed);
      return [...extraLogs, `${player.name} 的手牌 ${formatCard(removed)} 被弃置`];
    }
    if (selectedCardId.startsWith("delayed:")) {
      const delayedCardId = selectedCardId.slice("delayed:".length);
      const index = player.delayedTricks.findIndex(
        (trick) => (trick.card?.id ?? trick.cardType) === delayedCardId,
      );
      const [removedTrick] = index < 0 ? [] : player.delayedTricks.splice(index, 1);
      if (!removedTrick) return [];
      const removedCard = removedTrick.card ?? createCard(ctx, removedTrick.cardType, `legacy-delayed-${player.id}`);
      if (mode === "获得" && receiver) {
        receiver.hand.push(removedCard);
        return [`${receiver.name} 获得了 ${player.name} 判定区的 ${formatCard(removedCard)}`];
      }
      ctx.discardPile.push(removedCard);
      return [`${player.name} 判定区的 ${formatCard(removedCard)} 被弃置`];
    }
    if (selectedCardId === "weapon") {
      const removedWeapon = player.weapon;
      player.weapon = null;
      if (removedWeapon === null) {
        return [];
      }
      const logs: string[] = [];
      const removedCard = takeEquipmentCard(ctx, player, "weapon", removedWeapon);
      if (mode === "获得" && receiver) {
        receiver.hand.push(removedCard);
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedWeapon}`);
      } else {
        ctx.discardPile.push(removedCard);
        logs.push(`${player.name} 的装备 ${removedWeapon} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removedWeapon))];
    }
    if (selectedCardId === "armor") {
      const removedArmor = player.armor;
      player.armor = null;
      if (removedArmor === null) {
        return [];
      }
      const logs: string[] = [];
      const removedCard = takeEquipmentCard(ctx, player, "armor", removedArmor);
      if (mode === "获得" && receiver) {
        receiver.hand.push(removedCard);
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removedArmor}`);
      } else {
        ctx.discardPile.push(removedCard);
        logs.push(`${player.name} 的装备 ${removedArmor} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removedArmor))];
    }
    if (selectedCardId === "defenseHorse") {
      const removed = player.defenseHorse;
      player.defenseHorse = null;
      if (removed === null) {
        return [];
      }
      const logs: string[] = [];
      const removedCard = takeEquipmentCard(ctx, player, "defenseHorse", removed);
      if (mode === "获得" && receiver) {
        receiver.hand.push(removedCard);
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`);
      } else {
        ctx.discardPile.push(removedCard);
        logs.push(`${player.name} 的装备 ${removed} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removed))];
    }
    if (selectedCardId === "attackHorse") {
      const removed = player.attackHorse;
      player.attackHorse = null;
      if (removed === null) {
        return [];
      }
      const logs: string[] = [];
      const removedCard = takeEquipmentCard(ctx, player, "attackHorse", removed);
      if (mode === "获得" && receiver) {
        receiver.hand.push(removedCard);
        logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${removed}`);
      } else {
        ctx.discardPile.push(removedCard);
        logs.push(`${player.name} 的装备 ${removed} 被弃置`);
      }
      return [...logs, ...(await onLoseEquip(ctx, player, removed))];
    }
    if (selectedCardId !== "treasure") {
      return [];
    }
    const removedTreasure = player.treasure;
    player.treasure = null;
    if (removedTreasure === null) {
      return [];
    }
    const logs: string[] = [];
    const removedCard = takeEquipmentCard(ctx, player, "treasure", removedTreasure);
    discardWoodenOxStorage(ctx, player, logs);
    if (mode === "获得" && receiver) {
      receiver.hand.push(removedCard);
      logs.push(`${receiver.name} 获得了 ${player.name} 的装备 ${formatCard(removedCard)}`);
    } else {
      ctx.discardPile.push(removedCard);
      logs.push(`${player.name} 的装备 ${formatCard(removedCard)} 被弃置`);
    }
    return [...logs, ...(await onLoseEquip(ctx, player, removedTreasure))];
  })();
}

export function triggerJiAng(
  ctx: ResolveContext,
  attacker: Player,
  target: Player,
  qualifies: boolean,
  logs: string[],
  triggerAttackerSkill = true,
): Promise<void> {
  return (async () => {
    if (!qualifies) {
      return;
    }
    if (triggerAttackerSkill && ctx.hasSkill(attacker, SkillName.JiAng) && await ctx.shouldActivateOptionalEffect(attacker, SkillName.JiAng)) {
      const drawn = ctx.drawCards(attacker.id, 1);
      logs.push(`${attacker.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
    if (ctx.hasSkill(target, SkillName.JiAng) && await ctx.shouldActivateOptionalEffect(target, SkillName.JiAng)) {
      const drawn = ctx.drawCards(target.id, 1);
      logs.push(`${target.name} 的${SkillName.JiAng}生效，摸了 ${drawn} 张牌`);
    }
  })();
}
