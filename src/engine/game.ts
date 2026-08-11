import { Card, CardType, CARD_LIBRARY_SUMMARY, createDeck, DamageNature, formatCard, shuffle } from "./cards.js";
import {
  cardNeedsTarget as cardNeedsTargetImpl,
  hasRemovableCard,
  isDelayedTrickCard as isDelayedTrickCardImpl,
  isEquipCard as isEquipCardImpl,
  isNonDelayedTrickCard as isNonDelayedTrickCardImpl,
  isSlashCard as isSlashCardImpl,
} from "./card-utils.js";
import {
  AiHeuristicsContext,
  pickBestAiAction,
  pickBestTarget,
} from "./ai-heuristics.js";
import {
  buildRoleList,
  dealGeneralCandidates,
  getAiName,
  getRoleDistribution,
  GENERAL_LIBRARY,
  pickRandomUnusedGeneral,
  resolveGeneralByName,
} from "./generals.js";
import {
  canReachForSlash as canReachForSlashImpl,
  computeDistance as computeDistanceImpl,
  consumeSlashResponse as consumeSlashResponseImpl,
  createCard as createCardImpl,
  expandSlashTargets as expandSlashTargetsImpl,
  removeRandomCardFromPlayer as removeRandomCardFromPlayerImpl,
  removeSelectedCardFromPlayer as removeSelectedCardFromPlayerImpl,
  ResolveContext,
  resolveArrowRain as resolveArrowRainImpl,
  resolveBarbarian as resolveBarbarianImpl,
  resolveCollateral as resolveCollateralImpl,
  resolveDeaths as resolveDeathsImpl,
  resolveDelayedJudgments as resolveDelayedJudgmentsImpl,
  resolveDelayedTrick as resolveDelayedTrickImpl,
  resolveDismantle as resolveDismantleImpl,
  resolveDuel as resolveDuelImpl,
  resolveEquip as resolveEquipImpl,
  resolveFireAttack as resolveFireAttackImpl,
  resolveHarvest as resolveHarvestImpl,
  resolveIronChain as resolveIronChainImpl,
  moveWoodenOx as moveWoodenOxImpl,
  onLoseEquip as onLoseEquipImpl,
  resolvePeachGarden as resolvePeachGardenImpl,
  resolveSingleDelayedJudgment as resolveSingleDelayedJudgmentImpl,
  resolveSlash as resolveSlashImpl,
  resolveSnatch as resolveSnatchImpl,
  resolveWinner as resolveWinnerImpl,
  tryNegate as tryNegateImpl,
} from "./resolve.js";
import { createSkillHooks, SkillHooksContext } from "./skill-hooks.js";
import {
  canPlaySlashInTurn as canPlaySlashInTurnImpl,
  canUseAssault as canUseAssaultImpl,
  canUseFanJian as canUseFanJianImpl,
  canUseJieYin as canUseJieYinImpl,
  canUseJiJiang as canUseJiJiangImpl,
  canUseKuRou as canUseKuRouImpl,
  canUseLiJian as canUseLiJianImpl,
  canUseQingNang as canUseQingNangImpl,
  canUseRenDe as canUseRenDeImpl,
  canUseZhiBa as canUseZhiBaImpl,
  canUseZhiHeng as canUseZhiHengImpl,
  getLordWithZhiBa as getLordWithZhiBaImpl,
  hasSkill as playerHasSkill,
  isSkillUsed as playerIsSkillUsed,
  markSkillUsed as playerMarkSkillUsed,
  resetTurnSkillState as playerResetTurnSkillState,
  shouldActivateOptionalEffect as playerShouldActivateOptionalEffect,
  SkillUseContext,
  useSkillAction as useSkillActionImpl,
} from "./skills.js";
import {
  CardSource,
  DecisionHandler,
  DiscardOption,
  EquipCardType,
  EquipmentZone,
  GameAction,
  GameInitOptions,
  GameSnapshot,
  GameWinner,
  GeneralDefinition,
  GeneralDraftSeat,
  InteractionDecision,
  InteractionRequest,
  NetworkPlayerConfig,
  Player,
  PlayerRole,
  RemovableCardOption,
  ResponseKind,
  ResponseOption,
  SkillEventPayload,
  SkillHook,
  SkillName,
  SkillTrigger,
  TurnPhase,
} from "./types.js";

export { formatGameWinner, TurnPhase, SkillName, PlayerRole } from "./types.js";
export type {
  Player,
  GameAction,
  GameSnapshot,
  GameWinner,
  GameInitOptions,
  NetworkPlayerConfig,
  GeneralDefinition,
  GeneralDraftSeat,
  ResponseOption,
  DiscardOption,
  RemovableCardOption,
} from "./types.js";
export { GENERAL_LIBRARY } from "./generals.js";
export type { CardSource, DecisionHandler, InteractionDecision, InteractionRequest, ResponseKind } from "./interaction.js";

const drawCountPerTurn = 2;

const defaultInitOptions: GameInitOptions = {
  playerCount: 3,
  aiCount: 2,
  openingHandCount: 4,
  humanName: "主公",
  humanRole: PlayerRole.Lord,
  humanGeneral: "孙策",
  generalAssignments: {},
};

export class SanGuoGame {
  private players: Player[];

  private deck: Card[];

  private discardPile: Card[];

  private currentPlayerIndex: number;

  private turn: number;

  private phase: TurnPhase;

  private slashUsedThisTurn: boolean;

  private wineUsedThisTurn: Set<string>;

  private wineSlashBonus: Set<string>;

  private woodenOxUsedThisTurn: Set<string>;

  private winner: GameWinner | null;

  private readonly rng: () => number;

  private skillUsedThisTurn: Map<string, Set<SkillName>>;

  private skillCountsThisTurn: Map<string, Map<SkillName, number>>;

  private skillFlagsThisTurn: Map<string, Set<SkillName>>;

  private readonly skillHooks: Record<SkillTrigger, SkillHook[]>;

  private responsePolicyByPlayer: Map<string, Partial<Record<ResponseKind, boolean>>>;

  private responseSelectionByPlayer: Map<string, Partial<Record<ResponseKind, string>>>;

  private decisionHandlers: Map<string, DecisionHandler>;

  private interactionSeq: number;

  private optionalEffectDecisions: Map<string, boolean>;

  private peachDecisions: Map<string, Map<string, string | null>>;

  private deferDyingResolution: boolean;
  private lastDamageSourceByPlayer: Map<string, string | null>;
  private skipDrawPhase: string | null;
  private skipPlayPhase: string | null;
  private staged = false;
  private pendingNextTurn = false;
  private pendingTurnEndPlayer: string | null = null;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
    this.players = [];
    this.deck = [];
    this.discardPile = [];
    this.currentPlayerIndex = 0;
    this.turn = 1;
    this.phase = TurnPhase.Start;
    this.slashUsedThisTurn = false;
    this.wineUsedThisTurn = new Set();
    this.wineSlashBonus = new Set();
    this.woodenOxUsedThisTurn = new Set();
    this.winner = null;
    this.skillUsedThisTurn = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.skillHooks = createSkillHooks(this as unknown as SkillHooksContext);
    this.responsePolicyByPlayer = new Map();
    this.responseSelectionByPlayer = new Map();
    this.decisionHandlers = new Map();
    this.interactionSeq = 0;
    this.optionalEffectDecisions = new Map();
    this.peachDecisions = new Map();
    this.deferDyingResolution = false;
    this.lastDamageSourceByPlayer = new Map();
    this.skipDrawPhase = null;
    this.skipPlayPhase = null;
    this.staged = false;
    this.pendingNextTurn = false;
    this.pendingTurnEndPlayer = null;
  }

  async initDefaultGame(options: Partial<GameInitOptions> = {}, startImmediately = true): Promise<string[]> {
    const initOptions = this.normalizeInitOptions(options);
    const roleList = this.buildRoleList(initOptions.playerCount);
    const distribution = this.getRoleDistribution(roleList);
    const humanRole = roleList.includes(initOptions.humanRole) ? initOptions.humanRole : PlayerRole.Lord;
    const humanGeneralDefinition = this.resolveGeneralByName(initOptions.humanGeneral);
    const rolePool = [...roleList];
    const humanRoleIndex = rolePool.indexOf(humanRole);
    if (humanRoleIndex >= 0) {
      rolePool.splice(humanRoleIndex, 1);
    }

    this.players = [this.createPlayer("human", initOptions.humanName, false, humanGeneralDefinition, humanRole)];
    const usedGeneralNames = new Set<string>([humanGeneralDefinition.name]);
    for (let i = 0; i < rolePool.length; i += 1) {
      const role = rolePool[i] ?? PlayerRole.Rebel;
      const playerId = `ai-${i + 1}`;
      const assignedName = initOptions.generalAssignments[playerId];
      const assignedGeneral = assignedName ? GENERAL_LIBRARY.find((item) => item.name === assignedName) : undefined;
      const general = assignedGeneral && !usedGeneralNames.has(assignedGeneral.name)
        ? assignedGeneral
        : this.pickRandomUnusedGeneral(usedGeneralNames);
      usedGeneralNames.add(general.name);
      this.players.push(this.createPlayer(playerId, `玩家${this.getAiName(i)}`, true, general, role));
    }
    const lordBonusApplied = this.applyLordStartingHpBonus();
    this.deck = shuffle(createDeck(), this.rng);
    this.discardPile = [];
    this.currentPlayerIndex = this.players.findIndex((player) => player.role === PlayerRole.Lord && player.alive);
    if (this.currentPlayerIndex < 0) {
      this.currentPlayerIndex = 0;
    }
    this.turn = 1;
    this.phase = TurnPhase.Start;
    this.winner = null;
    this.slashUsedThisTurn = false;
    this.wineUsedThisTurn.clear();
    this.wineSlashBonus.clear();
    this.woodenOxUsedThisTurn.clear();
    this.skillUsedThisTurn = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.responsePolicyByPlayer.clear();
    this.responseSelectionByPlayer.clear();
    this.optionalEffectDecisions.clear();
    this.lastDamageSourceByPlayer.clear();

    const logs = [
      `对局开始：${initOptions.playerCount} 人局`,
      `身份配比：反贼${distribution.rebel} 忠臣${distribution.loyalist} 内奸${distribution.traitor}`,
      `你的身份：${humanRole}`,
      `你的武将：${humanGeneralDefinition.name}`,
      ...(lordBonusApplied ? ["五人及以上对局：主公体力上限与体力各增加 1"] : []),
      `初始手牌：每人 ${initOptions.openingHandCount} 张`,
      "发牌中...",
    ];
    for (const player of this.players) {
      const drawn = this.drawCards(player.id, initOptions.openingHandCount);
      logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
    }
    if (startImmediately) {
      logs.push(...(await this.startTurn()));
    }
    return logs;
  }

  async initNetworkGame(playerConfigs: NetworkPlayerConfig[], openingHandCount = 4, startImmediately = true): Promise<string[]> {
    if (playerConfigs.length < 2 || playerConfigs.length > 6) {
      throw new Error("联机人数必须在 2 到 6 人之间");
    }
    const ids = new Set(playerConfigs.map((player) => player.id));
    if (ids.size !== playerConfigs.length) {
      throw new Error("联机玩家 ID 不能重复");
    }
    const roles = this.buildRoleList(playerConfigs.length);
    const suppliedRoleCount = playerConfigs.filter((config) => config.role !== undefined).length;
    if (suppliedRoleCount !== 0 && suppliedRoleCount !== playerConfigs.length) {
      throw new Error("联机身份必须全部指定或全部由引擎随机分配");
    }
    const shuffledRoles = suppliedRoleCount === playerConfigs.length
      ? playerConfigs.map((config) => config.role ?? PlayerRole.Rebel)
      : shuffle(roles, this.rng);
    if (suppliedRoleCount === playerConfigs.length) {
      const expected = [...roles].sort();
      const actual = [...shuffledRoles].sort();
      if (expected.some((role, index) => role !== actual[index])) {
        throw new Error("联机身份配比无效");
      }
    }
    const usedGeneralNames = new Set<string>();
    this.players = playerConfigs.map((config, index) => {
      const requestedGeneral = config.general
        ? GENERAL_LIBRARY.find((general) => general.name === config.general)
        : undefined;
      if (config.general && !requestedGeneral) {
        throw new Error(`未知武将：${config.general}`);
      }
      if (requestedGeneral && usedGeneralNames.has(requestedGeneral.name)) {
        throw new Error(`武将不能重复：${requestedGeneral.name}`);
      }
      const general = requestedGeneral ?? this.pickRandomUnusedGeneral(usedGeneralNames);
      usedGeneralNames.add(general.name);
      return this.createPlayer(config.id, config.name, config.isAI ?? false, general, shuffledRoles[index] ?? PlayerRole.Rebel);
    });
    const lordBonusApplied = this.applyLordStartingHpBonus();
    this.deck = shuffle(createDeck(), this.rng);
    this.discardPile = [];
    this.currentPlayerIndex = this.players.findIndex((player) => player.role === PlayerRole.Lord);
    this.currentPlayerIndex = Math.max(0, this.currentPlayerIndex);
    this.turn = 1;
    this.phase = TurnPhase.Start;
    this.winner = null;
    this.slashUsedThisTurn = false;
    this.wineUsedThisTurn.clear();
    this.wineSlashBonus.clear();
    this.woodenOxUsedThisTurn.clear();
    this.skillUsedThisTurn = new Map();
    this.skillCountsThisTurn = new Map();
    this.skillFlagsThisTurn = new Map();
    this.responsePolicyByPlayer.clear();
    this.responseSelectionByPlayer.clear();
    this.optionalEffectDecisions.clear();
    this.lastDamageSourceByPlayer.clear();

    const handCount = Math.min(6, Math.max(3, Math.floor(openingHandCount)));
    const logs = [
      `联机对局开始：${playerConfigs.length} 人局`,
      ...(lordBonusApplied ? ["五人及以上对局：主公体力上限与体力各增加 1"] : []),
      `初始手牌：每人 ${handCount} 张`,
    ];
    this.staged = true;
    this.pendingNextTurn = false;
    this.pendingTurnEndPlayer = null;
    for (const player of this.players) {
      const drawn = this.drawCards(player.id, handCount);
      logs.push(`${player.name}[${player.general}] 获得 ${drawn} 张手牌`);
    }
    if (startImmediately) logs.push(...(await this.startTurn()));
    return logs;
  }

  getSnapshot(): GameSnapshot {
    return {
      turn: this.turn,
      currentPlayerId: this.players.length > 0 ? this.currentPlayer.id : "",
      phase: this.phase,
      players: this.players.map((player) => ({
        ...player,
        hand: [...player.hand],
        treasureCards: [...player.treasureCards],
        equippedCards: player.equippedCards ? { ...player.equippedCards } : {},
        delayedTricks: player.delayedTricks.map((trick) => ({ ...trick })),
      })),
      winner: this.winner,
      gameOver: this.winner !== null,
      slashUsed: this.slashUsedThisTurn,
      deckCount: this.deck.length,
      discardCount: this.discardPile.length,
    };
  }

  getCurrentPlayer(): Player {
    return this.currentPlayer;
  }

  async ensureTurnState(): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    const current = this.currentPlayer;
    if (current.alive) {
      return [];
    }
    const logs = [`${current.name} 已阵亡，跳过其回合`];
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return logs;
    }
    if (this.staged) {
      this.pendingNextTurn = true;
      return logs;
    }
    logs.push(...(await this.startTurn()));
    return logs;
  }

  getCardLibrary() {
    return CARD_LIBRARY_SUMMARY.map((item) => ({ ...item }));
  }

  getGeneralLibrary(): GeneralDefinition[] {
    return GENERAL_LIBRARY.map((item) => ({
      kingdom: item.kingdom,
      name: item.name,
      gender: item.gender,
      maxHp: item.maxHp,
      skills: [...item.skills],
    }));
  }

  getPlayerSnapshotSummary(playerId: string): {
    id: string;
    name: string;
    hp: number;
    maxHp: number;
    handCount: number;
    alive: boolean;
    faceDown: boolean;
  } {
    const player = this.mustGetPlayer(playerId);
    return {
      id: player.id,
      name: player.name,
      hp: player.hp,
      maxHp: player.maxHp,
      handCount: player.hand.length,
      alive: player.alive,
      faceDown: player.faceDown,
    };
  }

  getPlayableActions(playerId: string): GameAction[] {
    if (this.winner !== null) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    const actions: GameAction[] = [];
    const canPlaySlash = this.canPlaySlashInTurn(player);

    player.hand.forEach((card, cardIndex) => {
      if (card.type === CardType.Dodge || card.type === CardType.Negate) {
        return;
      }
      if (this.isSlashCard(card.type) && !canPlaySlash) {
        return;
      }
      if (
        card.type === CardType.Peach &&
        !this.players.some((candidate) => candidate.alive && candidate.hp < candidate.maxHp)
      ) {
        return;
      }
      if (card.type === CardType.Wine && this.wineUsedThisTurn.has(player.id)) return;
      if (card.type === CardType.Lightning && player.delayedTricks.some((t) => t.cardType === CardType.Lightning)) {
        return;
      }
      let targets = this.findTargetsByCard(player.id, card.type);
      if (card.type === CardType.FireAttack && player.hand.length === 1) {
        targets = targets.filter((targetId) => targetId !== player.id);
      }
      if (this.cardNeedsTarget(card.type) && targets.length === 0) {
        return;
      }
      actions.push({
        type: "play",
        cardIndex,
        label: `使用 ${card.type}`,
        requiresTarget: this.cardNeedsTarget(card.type),
        targets,
      });
      if (card.type === CardType.IronChain) {
        actions.push({
          type: "play",
          cardIndex: -2000 - cardIndex,
          label: `重铸 ${CardType.IronChain}`,
          requiresTarget: false,
          targets: [],
        });
      }
    });
    if (canPlaySlash && this.hasSkill(player, SkillName.LongDan)) {
      player.hand.forEach((card, cardIndex) => {
        if (card.type !== CardType.Dodge) {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Slash);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -200 - cardIndex,
          label: `使用 龙胆（将${formatCard(card)}当${CardType.Slash}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (canPlaySlash && this.hasSkill(player, SkillName.WuSheng)) {
      player.hand.forEach((card, cardIndex) => {
        if (this.isSlashCard(card.type) || card.color !== "red") {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Slash);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -400 - cardIndex,
          label: `使用 武圣（将${formatCard(card)}当${CardType.Slash}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (this.hasSkill(player, SkillName.GuoSe)) {
      player.hand.forEach((card, cardIndex) => {
        if (card.suit !== "diamond") {
          return;
        }
        const targets = this.findTargetsByCard(player.id, CardType.Indulgence);
        if (targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -100 - cardIndex,
          label: `使用 国色（将${formatCard(card)}当${CardType.Indulgence}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    if (this.hasSkill(player, SkillName.QiXi)) {
      player.hand.forEach((card, cardIndex) => {
        if (card.color !== "black") return;
        const targets = this.findTargetsByCard(player.id, CardType.Dismantle);
        if (targets.length === 0) return;
        actions.push({
          type: "play",
          cardIndex: -3000 - cardIndex,
          label: `使用 ${SkillName.QiXi}（将${formatCard(card)}当${CardType.Dismantle}）`,
          requiresTarget: true,
          targets,
        });
      });
    }
    const conversionSources = this.buildUsableSources(player).filter((source) => source.origin !== "hand");
    for (const source of conversionSources) {
      const sourceZoneLabel = source.origin === "treasure" ? `${CardType.WoodenOx}下` : "装备区";
      if (canPlaySlash && this.hasSkill(player, SkillName.LongDan) && source.card.type === CardType.Dodge) {
        const targets = this.findTargetsByCard(player.id, CardType.Slash);
        if (targets.length > 0) {
          actions.push({
            type: "play",
            cardIndex: -9000,
            sourceId: source.sourceId,
            conversionSkill: SkillName.LongDan,
            label: `使用${SkillName.LongDan}（将${sourceZoneLabel}${formatCard(source.card)}当${CardType.Slash}）`,
            requiresTarget: true,
            targets,
          });
        }
      }
      if (canPlaySlash && this.hasSkill(player, SkillName.WuSheng) && source.card.color === "red") {
        const targets = this.findTargetsForConvertedSlash(player, source);
        if (targets.length > 0) {
          actions.push({
            type: "play",
            cardIndex: -9001,
            sourceId: source.sourceId,
            conversionSkill: SkillName.WuSheng,
            label: `使用${SkillName.WuSheng}（将${sourceZoneLabel}${formatCard(source.card)}当${CardType.Slash}）`,
            requiresTarget: true,
            targets,
          });
        }
      }
      if (this.hasSkill(player, SkillName.GuoSe) && source.card.suit === "diamond") {
        const targets = this.findTargetsByCard(player.id, CardType.Indulgence);
        if (targets.length > 0) {
          actions.push({
            type: "play",
            cardIndex: -9002,
            sourceId: source.sourceId,
            conversionSkill: SkillName.GuoSe,
            label: `使用${SkillName.GuoSe}（将${sourceZoneLabel}${formatCard(source.card)}当${CardType.Indulgence}）`,
            requiresTarget: true,
            targets,
          });
        }
      }
      if (this.hasSkill(player, SkillName.QiXi) && source.card.color === "black") {
        const targets = this.findTargetsByCard(player.id, CardType.Dismantle);
        if (targets.length > 0) {
          actions.push({
            type: "play",
            cardIndex: -9003,
            sourceId: source.sourceId,
            conversionSkill: SkillName.QiXi,
            label: `使用${SkillName.QiXi}（将${sourceZoneLabel}${formatCard(source.card)}当${CardType.Dismantle}）`,
            requiresTarget: true,
            targets,
          });
        }
      }
    }
    if (
      player.weapon === CardType.SerpentSpear &&
      player.hand.length + player.treasureCards.length >= 2 &&
      (!this.slashUsedThisTurn || this.hasSkill(player, SkillName.Roar))
    ) {
      const targets = this.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length > 0) {
        actions.push({
          type: "play",
          cardIndex: -1,
          label: "使用 丈八蛇矛（将2张手牌/粮当杀）",
          requiresTarget: true,
          targets,
        });
      }
    }
    if (player.treasure === CardType.WoodenOx) {
      if (player.hand.length > 0 && !this.woodenOxUsedThisTurn.has(player.id)) {
        actions.push({
          type: "play",
          cardIndex: -11,
          label: `使用 ${CardType.WoodenOx}（置入1张手牌）`,
          requiresTarget: false,
          targets: [],
        });
      }
      player.treasureCards.forEach((card, index) => {
        if (card.type === CardType.Dodge || card.type === CardType.Negate) return;
        if (this.isSlashCard(card.type) && !canPlaySlash) return;
        if (
          card.type === CardType.Peach &&
          !this.players.some((candidate) => candidate.alive && candidate.hp < candidate.maxHp)
        ) return;
        if (card.type === CardType.Wine && this.wineUsedThisTurn.has(player.id)) return;
        if (card.type === CardType.Lightning && player.delayedTricks.some((trick) => trick.cardType === CardType.Lightning)) return;
        const targets = this.findTargetsByCard(player.id, card.type);
        if (this.cardNeedsTarget(card.type) && targets.length === 0) {
          return;
        }
        actions.push({
          type: "play",
          cardIndex: -1000 - index,
          label: `使用 木牛流马下的 ${formatCard(card)}`,
          requiresTarget: this.cardNeedsTarget(card.type),
          targets,
        });
      });
    }

    if (this.canUseAssault(player)) {
      const targets = this.players
        .filter((target) => target.alive && target.id !== player.id && this.canReachForSlash(player, target))
        .map((target) => target.id);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.Assault,
          label: `发动${SkillName.Assault}（失去1点体力或弃武器牌，造成1点伤害）`,
          requiresTarget: true,
          targets,
        });
      }
    }
    if (this.canUseZhiHeng(player)) {
      actions.push({
        type: "skill",
        skill: SkillName.ZhiHeng,
        label: `发动${SkillName.ZhiHeng}（弃任意张并摸等量，限一次）`,
        requiresTarget: false,
        targets: [],
      });
    }
    if (this.canUseQingNang(player)) {
      const targets = this.players.filter((item) => item.alive && item.hp < item.maxHp).map((item) => item.id);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.QingNang,
          label: `发动${SkillName.QingNang}（弃1手牌令1名角色回复1点）`,
          requiresTarget: true,
          targets,
        });
      }
    }
    if (this.canUseKuRou(player)) {
      actions.push({
        type: "skill",
        skill: SkillName.KuRou,
        label: `发动${SkillName.KuRou}（失去1点体力并摸2张牌）`,
        requiresTarget: false,
        targets: [],
      });
    }
    if (this.canUseRenDe(player)) {
      const renDeTargets = this.players
        .filter((item) => item.alive && item.id !== player.id)
        .map((item) => item.id);
      if (renDeTargets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.RenDe,
          label: `发动${SkillName.RenDe}（将手牌交给1名角色，本回合累计给出2张回复1点）`,
          requiresTarget: true,
          targets: renDeTargets,
        });
      }
    }
    if (this.canUseFanJian(player)) {
      const targets = this.players.filter((item) => item.alive && item.id !== player.id).map((item) => item.id);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.FanJian,
          label: `发动${SkillName.FanJian}（令目标声明花色并获得一张手牌）`,
          requiresTarget: true,
          targets,
        });
      }
    }

    if (this.canUseZhiBa(player)) {
      const lord = this.getLordWithZhiBa();
      if (lord && lord.id !== player.id && lord.hand.length > 0 && player.hand.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.ZhiBa,
          label: `发动${SkillName.ZhiBa}（与主公拼点，未赢则主公得两张拼点牌）`,
          requiresTarget: false,
          targets: [lord.id],
        });
      }
    }
    if (this.canUseLiJian(player)) {
      const maleTargets = this.players
        .filter(
          (p) =>
            p.alive &&
            p.id !== player.id &&
            p.gender === "男" &&
            !this.isKongChengProtected(p, CardType.Duel),
        )
        .map((p) => p.id);
      const otherMaleCount = this.players.filter(
        (candidate) => candidate.alive && candidate.id !== player.id && candidate.gender === "男",
      ).length;
      if (maleTargets.length > 0 && otherMaleCount >= 2) {
        actions.push({
          type: "skill",
          skill: SkillName.LiJian,
          label: `发动${SkillName.LiJian}（弃1牌令两名男性角色决斗）`,
          requiresTarget: true,
          targets: maleTargets,
        });
      }
    }
    if (this.canUseJieYin(player)) {
      const maleWounded = this.players
        .filter((p) => p.alive && p.gender === "男" && p.id !== player.id && p.hp < p.maxHp)
        .map((p) => p.id);
      if (player.hand.length >= 2 && maleWounded.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.JieYin,
          label: `发动${SkillName.JieYin}（弃2牌令自己与一名男性角色各回复1点体力）`,
          requiresTarget: true,
          targets: maleWounded,
        });
      }
    }
    if (canUseJiJiangImpl(this as unknown as SkillUseContext, player)) {
      const targets = this.findTargetsByCard(player.id, CardType.Slash);
      if (targets.length > 0) {
        actions.push({
          type: "skill",
          skill: SkillName.JiJiang,
          label: `发动${SkillName.JiJiang}（请求蜀势力角色提供杀）`,
          requiresTarget: true,
          targets,
        });
      }
    }
    actions.push({ type: "end", label: "结束出牌阶段" });
    return actions;
  }

  getPendingDiscardCount(playerId: string): number {
    if (this.winner !== null) {
      return 0;
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Discard) {
      return 0;
    }
    return Math.max(0, player.hand.length - player.hp);
  }

  getDiscardOptions(playerId: string): DiscardOption[] {
    if (this.getPendingDiscardCount(playerId) <= 0) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    return player.hand.map((card, handIndex) => ({
      handIndex,
      cardId: card.id,
      cardType: card.type,
    }));
  }

  getRemovableCardOptions(targetId: string): RemovableCardOption[] {
    const target = this.players.find((item) => item.id === targetId);
    if (!target || !target.alive) {
      return [];
    }
    const options: RemovableCardOption[] = [];
    if (target.hand.length > 0) {
      options.push({
        id: "hand-random",
        zone: "hand",
        cardType: null,
        label: `手牌（随机1张，当前${target.hand.length}张）`,
      });
    }
    if (target.weapon !== null) {
      options.push({
        id: "weapon",
        zone: "weapon",
        cardType: target.weapon,
        label: `武器 ${target.weapon}`,
      });
    }
    if (target.armor !== null) {
      options.push({
        id: "armor",
        zone: "armor",
        cardType: target.armor,
        label: `防具 ${target.armor}`,
      });
    }
    if (target.defenseHorse !== null) {
      options.push({
        id: "defenseHorse",
        zone: "defenseHorse",
        cardType: target.defenseHorse,
        label: `+1马 ${target.defenseHorse}`,
      });
    }
    if (target.attackHorse !== null) {
      options.push({
        id: "attackHorse",
        zone: "attackHorse",
        cardType: target.attackHorse,
        label: `-1马 ${target.attackHorse}`,
      });
    }
    if (target.treasure !== null) {
      options.push({
        id: "treasure",
        zone: "treasure",
        cardType: target.treasure,
        label: `宝物 ${target.treasure}`,
      });
    }
    for (const trick of target.delayedTricks) {
      options.push({
        id: `delayed:${trick.card?.id ?? trick.cardType}`,
        zone: "judgment",
        cardType: trick.cardType,
        label: `判定区 ${trick.cardType}${trick.card ? `（${formatCard(trick.card)}）` : ""}`,
      });
    }
    return options;
  }

  async discardForCurrentPlayer(playerId: string, handIndex: number): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Discard) {
      return [];
    }
    if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= player.hand.length) {
      return ["弃牌选择无效"];
    }
    const removed = await this.removeHandCardAt(player, handIndex);
    if (!removed) {
      return ["弃牌选择无效"];
    }
    this.discardPile.push(removed);
    const logs = [`${player.name} 弃置了 ${removed.type}`];
    if (player.hand.length > player.hp) {
      return logs;
    }
    if (this.staged) {
      this.pendingTurnEndPlayer = player.id;
    } else {
      logs.push(...(await this.finishTurn(player)));
    }
    return logs;
  }

  async playAction(playerId: string, action: GameAction, targetId?: string, selectedCardId?: string): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    if (action.type === "end") {
      return this.endPlayPhase(playerId);
    }
    if (action.type === "skill") {
      return this.useSkillAction(playerId, action, targetId);
    }
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    if (action.sourceId && action.conversionSkill) {
      const source = this.peekUsableCard(player, action.sourceId);
      if (!source || source.origin === "hand" || !targetId) {
        return ["技能转化牌无效"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id || !action.targets.includes(target.id)) return ["目标无效"];
      const logs: string[] = [];
      const sourceZoneLabel = source.origin === "treasure" ? `${CardType.WoodenOx}下` : "装备区";
      if (action.conversionSkill === SkillName.LongDan) {
        if (!this.hasSkill(player, SkillName.LongDan) || source.card.type !== CardType.Dodge || !this.canPlaySlashInTurn(player)) {
          return ["使用龙胆失败"];
        }
        if (!this.canReachForSlash(player, target) || this.isKongChengProtected(target, CardType.Slash)) return ["目标无效"];
        const used = await this.removeUsableCardBySourceId(player, action.sourceId, logs);
        if (!used) return ["使用龙胆失败"];
        this.discardPile.push(used);
        this.slashUsedThisTurn = true;
        logs.push(`${player.name} 发动${SkillName.LongDan}，将${sourceZoneLabel}${formatCard(used)}当${CardType.Slash}使用`);
        logs.push(...(await this.resolveSlash(player, target, false, false, used.color, false, this.consumeWineSlashBonus(player.id), [used])));
      } else if (action.conversionSkill === SkillName.WuSheng) {
        if (!this.hasSkill(player, SkillName.WuSheng) || source.card.color !== "red" || !this.canPlaySlashInTurn(player)) {
          return ["使用武圣失败"];
        }
        if (!this.canReachForSlash(player, target) || this.isKongChengProtected(target, CardType.Slash)) return ["目标无效"];
        const used = await this.removeUsableCardBySourceId(player, action.sourceId, logs);
        if (!used) return ["使用武圣失败"];
        this.discardPile.push(used);
        this.slashUsedThisTurn = true;
        logs.push(`${player.name} 发动${SkillName.WuSheng}，将${sourceZoneLabel}${formatCard(used)}当${CardType.Slash}使用`);
        logs.push(...(await this.resolveSlash(player, target, false, false, "red", false, this.consumeWineSlashBonus(player.id), [used])));
      } else if (action.conversionSkill === SkillName.GuoSe) {
        if (!this.hasSkill(player, SkillName.GuoSe) || source.card.suit !== "diamond") return ["使用国色失败"];
        if (target.delayedTricks.some((trick) => trick.cardType === CardType.Indulgence)) return ["目标判定区已有乐不思蜀"];
        const used = await this.removeUsableCardBySourceId(player, action.sourceId, logs);
        if (!used) return ["使用国色失败"];
        logs.push(`${player.name} 发动${SkillName.GuoSe}，将${sourceZoneLabel}${formatCard(used)}当${CardType.Indulgence}使用`);
        if (await tryNegateImpl(this as unknown as ResolveContext, target, CardType.Indulgence, logs, player.id)) {
          this.discardPile.push(used);
        } else {
          target.delayedTricks.push({ cardType: CardType.Indulgence, sourcePlayerId: player.id, card: used });
        }
      } else if (action.conversionSkill === SkillName.QiXi) {
        if (!this.hasSkill(player, SkillName.QiXi) || source.card.color !== "black" || !hasRemovableCard(target)) {
          return ["使用奇袭失败"];
        }
        const used = await this.removeUsableCardBySourceId(player, action.sourceId, logs);
        if (!used) return ["使用奇袭失败"];
        this.discardPile.push(used);
        logs.push(`${player.name} 发动${SkillName.QiXi}，将${sourceZoneLabel}${formatCard(used)}当${CardType.Dismantle}使用`);
        logs.push(...(await this.resolveDismantle(player, target, selectedCardId)));
      } else {
        return ["未知转化技能"];
      }
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -100 && action.cardIndex > -200) {
      const index = -100 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.suit !== "diamond" || !this.hasSkill(player, SkillName.GuoSe)) {
        return ["使用卡牌失败"];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || target.id === player.id || !action.targets.includes(target.id)) {
        return ["目标无效"];
      }
      if (target.delayedTricks.some((t) => t.cardType === CardType.Indulgence)) {
        return ["目标判定区已有乐不思蜀"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      const logs = [`${player.name} 发动${SkillName.GuoSe}，将${formatCard(used)}当${CardType.Indulgence}使用`];
      if (await tryNegateImpl(this as unknown as ResolveContext, target, CardType.Indulgence, logs, player.id)) {
        this.discardPile.push(used);
      } else {
        target.delayedTricks.push({ cardType: CardType.Indulgence, sourcePlayerId: player.id, card: used });
        logs.push(`${target.name} 的判定区增加了 ${CardType.Indulgence}`);
      }
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -200 && action.cardIndex > -400) {
      const index = -200 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.type !== CardType.Dodge || !this.hasSkill(player, SkillName.LongDan)) {
        return ["使用卡牌失败"];
      }
      if (!this.canPlaySlashInTurn(player)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (
        !target.alive ||
        target.id === player.id ||
        !action.targets.includes(target.id) ||
        !this.canReachForSlash(player, target) ||
        this.isKongChengProtected(target, CardType.Slash)
      ) {
        return ["目标无效"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.LongDan}，将${CardType.Dodge}当${CardType.Slash}使用`];
      const targets = await this.expandSlashTargets(player, target, player.hand.length === 0);
      const wineBonus = this.consumeWineSlashBonus(player.id);
      for (let i = 0; i < targets.length; i += 1) {
        const slashTarget = targets[i];
        if (!slashTarget) continue;
        logs.push(...(await this.resolveSlash(player, slashTarget, false, false, used.color, false, wineBonus, [used], i === 0)));
      }
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex <= -400 && action.cardIndex > -1000) {
      const index = -400 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.type === CardType.Slash || converted.color !== "red" || !this.hasSkill(player, SkillName.WuSheng)) {
        return ["使用卡牌失败"];
      }
      if (!this.canPlaySlashInTurn(player)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (
        !target.alive ||
        target.id === player.id ||
        !action.targets.includes(target.id) ||
        !this.canReachForSlash(player, target) ||
        this.isKongChengProtected(target, CardType.Slash)
      ) {
        return ["目标无效"];
      }
      const used = await this.removeHandCardAt(player, index);
      if (!used) {
        return ["使用卡牌失败"];
      }
      this.discardPile.push(used);
      this.slashUsedThisTurn = true;
      const logs = [`${player.name} 发动${SkillName.WuSheng}，将红色${used.type}当${CardType.Slash}使用`];
      const targets = await this.expandSlashTargets(player, target, player.hand.length === 0);
      const wineBonus = this.consumeWineSlashBonus(player.id);
      for (let i = 0; i < targets.length; i += 1) {
        const slashTarget = targets[i];
        if (!slashTarget) continue;
        logs.push(...(await this.resolveSlash(player, slashTarget, false, false, "red", false, wineBonus, [used], i === 0)));
      }
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    if (action.cardIndex === -11) {
      if (
        player.treasure !== CardType.WoodenOx ||
        player.hand.length === 0 ||
        this.woodenOxUsedThisTurn.has(player.id)
      ) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      const handSources = this.buildUsableSources(player).filter((source) => source.origin === "hand");
      const [moved] = await this.requestCardSelection(player, 1, "木牛流马：选择1张手牌置于其下", handSources);
      if (!moved) {
        return [`${player.name} 当前无法发动${CardType.WoodenOx}`];
      }
      player.treasureCards.push(moved);
      this.woodenOxUsedThisTurn.add(player.id);
      const logs = [`${player.name} 将 ${formatCard(moved)} 置于${CardType.WoodenOx}下方`];
      const moveTargets = this.players.filter(
        (candidate) => candidate.alive && candidate.id !== player.id && candidate.treasure === null,
      );
      if (moveTargets.length > 0) {
        const decision = await this.decide({
          kind: "collateral",
          requestId: this.nextInteractionId(),
          targetId: player.id,
          actorId: player.id,
          victims: moveTargets.map((candidate) => candidate.id),
          sources: [],
          allowHandOverWeapon: true,
          reason: `${CardType.WoodenOx}：是否立即将木牛流马及所有“粮”移动给一名宝物栏为空的其他角色？`,
        });
        const target = decision.choice === "target"
          ? moveTargets.find((candidate) => candidate.id === decision.targetId)
          : undefined;
        if (target) logs.push(...(await moveWoodenOxImpl(this as unknown as ResolveContext, player, target)));
      }
      return logs;
    }
    if (action.cardIndex <= -3000) {
      const index = -3000 - action.cardIndex;
      const converted = player.hand[index];
      if (!converted || converted.color !== "black" || !this.hasSkill(player, SkillName.QiXi) || !targetId) {
        return ["使用卡牌失败"];
      }
      const target = this.mustGetPlayer(targetId);
      if (!target.alive || !action.targets.includes(target.id) || !hasRemovableCard(target)) return ["目标无效"];
      const used = await this.removeHandCardAt(player, index);
      if (!used) return ["使用卡牌失败"];
      this.discardPile.push(used);
      const logs = [`${player.name} 发动${SkillName.QiXi}，将${formatCard(used)}当${CardType.Dismantle}使用`];
      logs.push(...(await this.resolveDismantle(player, target, selectedCardId)));
      logs.push(...(await this.resolveDeaths()));
      logs.push(...this.resolveWinner());
      return logs;
    }
    if (action.cardIndex <= -2000) {
      const index = -2000 - action.cardIndex;
      const card = player.hand[index];
      if (card?.type !== CardType.IronChain) return ["重铸选择无效"];
      const lossLogs: string[] = [];
      const recast = await this.removeHandCardAt(player, index, lossLogs);
      if (!recast) return ["重铸选择无效"];
      this.discardPile.push(recast);
      const drawn = this.drawCards(player.id, 1);
      return [...lossLogs, `${player.name} 重铸${formatCard(recast)}，摸了 ${drawn} 张牌`];
    }
    if (action.cardIndex <= -1000) {
      if (player.treasure !== CardType.WoodenOx) {
        return [`${player.name} 当前无法使用${CardType.WoodenOx}下的牌`];
      }
      const index = -1000 - action.cardIndex;
      const usedCard = player.treasureCards.splice(index, 1)[0];
      if (!usedCard) {
        return ["使用卡牌失败"];
      }
      return this.resolveUsedCard(player, usedCard, targetId, true, selectedCardId);
    }
    if (action.cardIndex === -1) {
      if (player.weapon !== CardType.SerpentSpear || player.hand.length + player.treasureCards.length < 2) {
        return [`${player.name} 当前无法发动丈八蛇矛`];
      }
      if (this.slashUsedThisTurn && !this.hasSkill(player, SkillName.Roar)) {
        return [`${player.name} 本回合已使用过杀`];
      }
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (
        !target.alive ||
        target.id === player.id ||
        !action.targets.includes(target.id) ||
        !this.canReachForSlash(player, target) ||
        this.isKongChengProtected(target, CardType.Slash)
      ) {
        return ["目标无效"];
      }
      const serpentSources = this.buildUsableSources(player).filter(
        (source) => source.origin === "hand" || source.origin === "treasure",
      );
      const [first, second] = await this.requestDiscardSelection(
        player,
        2,
        `${CardType.SerpentSpear}：依次选择2张手牌或“粮”当杀`,
        serpentSources,
      );
      if (!first || !second) {
        return [`${player.name} 可转化的牌不足，无法发动丈八蛇矛`];
      }
      this.discardPile.push(first);
      this.discardPile.push(second);
      this.slashUsedThisTurn = true;
      const slashColor = first.color === second.color ? first.color : "colorless";
      const logs = [
        `${player.name} 发动丈八蛇矛，弃置 ${first.type}、${second.type} 视为使用杀`,
        ...(await this.resolveSlash(player, target, true, false, slashColor, false, this.consumeWineSlashBonus(player.id), [first, second])),
      ];
      return logs;
    }
    const card = player.hand[action.cardIndex];
    if (!card) {
      return [`${player.name} 选择了无效卡牌`];
    }
    if (
      this.isSlashCard(card.type) &&
      this.slashUsedThisTurn &&
      !this.hasSkill(player, SkillName.Roar) &&
      player.weapon !== CardType.Crossbow
    ) {
      return [`${player.name} 本回合已使用过杀`];
    }
    if (card.type === CardType.Negate) {
      return [`${player.name} 不能主动使用无懈可击`];
    }
    if (this.cardNeedsTarget(card.type)) {
      if (!targetId) {
        return ["需要选择目标"];
      }
      const target = this.mustGetPlayer(targetId);
      if (card.type === CardType.Wine && target.id !== player.id) {
        return ["酒只能对自己使用"];
      }
      const mayTargetSelf =
        card.type === CardType.Peach ||
        card.type === CardType.Wine ||
        card.type === CardType.ExNihilo ||
        card.type === CardType.FireAttack ||
        card.type === CardType.IronChain;
      if (!target.alive || !action.targets.includes(target.id) || (!mayTargetSelf && target.id === player.id)) {
        return ["目标无效"];
      }
      if (card.type === CardType.Peach && target.hp >= target.maxHp) return [`${target.name} 当前体力已满`];
      if (card.type === CardType.FireAttack && target.hand.length === 0) return ["目标无效"];
      if ((this.isSlashCard(card.type) || card.type === CardType.Duel) && this.isKongChengProtected(target, card.type)) {
        return [`${target.name} 的${SkillName.KongCheng}生效，无法成为目标`];
      }
      if (this.isSlashCard(card.type) && !this.canReachForSlash(player, target)) {
        return ["目标超出攻击范围"];
      }
    }

    const usedCard = await this.removeHandCardAt(player, action.cardIndex);
    if (!usedCard) {
      return ["使用卡牌失败"];
    }
    return this.resolveUsedCard(player, usedCard, targetId, false, selectedCardId);
  }

  private async resolveUsedCard(
    player: Player,
    usedCard: Card,
    targetId: string | undefined,
    fromTreasure: boolean,
    selectedCardId?: string,
  ): Promise<string[]> {
    const remainsOnBoard = this.isDelayedTrickCard(usedCard.type) || this.isEquipCard(usedCard.type);
    if (!remainsOnBoard) {
      this.discardPile.push(usedCard);
    }
    const logs: string[] = [];
    if (fromTreasure) {
      logs.push(`${player.name} 从${CardType.WoodenOx}下使用了 ${formatCard(usedCard)}`);
    }
    if (
      this.hasSkill(player, SkillName.JiZhi) &&
      this.isNonDelayedTrickCard(usedCard.type) &&
      await this.shouldActivateOptionalEffect(player, SkillName.JiZhi)
    ) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.JiZhi}生效，摸了 ${drawn} 张牌`);
    }
    if (this.isSlashCard(usedCard.type) && targetId) {
      this.slashUsedThisTurn = true;
      const slashTargets = await this.expandSlashTargets(
        player,
        this.mustGetPlayer(targetId),
        !fromTreasure && player.hand.length === 0,
      );
      const wineBonus = this.consumeWineSlashBonus(player.id);
      let fire = usedCard.type === CardType.FireSlash;
      if (
        usedCard.type === CardType.Slash &&
        player.weapon === CardType.ZhuqueFan &&
        await this.shouldActivateOptionalEffect(player, CardType.ZhuqueFan)
      ) {
        fire = true;
        logs.push(`${player.name} 发动${CardType.ZhuqueFan}，将普通杀改为火杀`);
      }
      for (let targetIndex = 0; targetIndex < slashTargets.length; targetIndex += 1) {
        const slashTarget = slashTargets[targetIndex];
        if (!slashTarget) continue;
        logs.push(...(await this.resolveSlash(
          player,
          slashTarget,
          false,
          fire,
          usedCard.color,
          usedCard.type === CardType.ThunderSlash,
          wineBonus,
          [usedCard],
          targetIndex === 0,
        )));
      }
    } else if (usedCard.type === CardType.Peach) {
      const target = targetId ? this.mustGetPlayer(targetId) : player;
      target.hp = Math.min(target.maxHp, target.hp + 1);
      logs.push(`${player.name} 对${target.name}使用桃，${target.name}回复 1 点体力`);
    } else if (usedCard.type === CardType.Wine) {
      this.wineUsedThisTurn.add(player.id);
      this.wineSlashBonus.add(player.id);
      logs.push(`${player.name} 对自己使用酒，本回合使用的下一张杀伤害+1`);
    } else if (usedCard.type === CardType.Dismantle && targetId) {
      logs.push(...(await this.resolveDismantle(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Snatch && targetId) {
      logs.push(...(await this.resolveSnatch(player, this.mustGetPlayer(targetId), selectedCardId)));
    } else if (usedCard.type === CardType.Duel && targetId) {
      logs.push(...(await this.resolveDuel(player, this.mustGetPlayer(targetId), { damageCards: [usedCard] })));
    } else if (usedCard.type === CardType.ExNihilo) {
      const target = targetId ? this.mustGetPlayer(targetId) : player;
      logs.push(`${player.name} 对${target.name}使用无中生有`);
      if (!(await tryNegateImpl(this as unknown as ResolveContext, target, CardType.ExNihilo, logs, player.id))) {
        const drawn = this.drawCards(target.id, 2);
        logs.push(`${target.name} 摸了 ${drawn} 张牌`);
      }
    } else if (usedCard.type === CardType.Barbarian) {
      logs.push(...(await this.resolveBarbarian(player, [usedCard])));
    } else if (usedCard.type === CardType.ArrowRain) {
      logs.push(...(await this.resolveArrowRain(player, [usedCard])));
    } else if (usedCard.type === CardType.Collateral && targetId) {
      logs.push(...(await this.resolveCollateral(player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.PeachGarden) {
      logs.push(...(await this.resolvePeachGarden(player)));
    } else if (usedCard.type === CardType.Harvest) {
      logs.push(...(await this.resolveHarvest(player)));
    } else if (usedCard.type === CardType.FireAttack && targetId) {
      logs.push(...(await resolveFireAttackImpl(this as unknown as ResolveContext, player, this.mustGetPlayer(targetId), [usedCard])));
    } else if (usedCard.type === CardType.IronChain && targetId) {
      logs.push(...(await resolveIronChainImpl(this as unknown as ResolveContext, player, this.mustGetPlayer(targetId))));
    } else if (usedCard.type === CardType.Lightning) {
      logs.push(...(await this.resolveDelayedTrick(player, usedCard, player.id)));
    } else if (this.isDelayedTrickCard(usedCard.type) && targetId) {
      logs.push(...(await this.resolveDelayedTrick(player, usedCard, targetId)));
    } else if (this.isEquipCard(usedCard.type)) {
      logs.push(...(await this.resolveEquip(player, usedCard)));
    }
    logs.push(...(await this.resolveDeaths()));
    logs.push(...this.resolveWinner());
    await this.advanceIfCurrentPlayerDead(logs);
    return logs;
  }

  async runAITurn(): Promise<string[]> {
    if (this.winner !== null || !this.currentPlayer.isAI || !this.currentPlayer.alive) {
      return [];
    }
    const logs: string[] = [];
    while (true) {
      const ai = this.currentPlayer;
      const actions = this.getPlayableActions(ai.id);
      const best = pickBestAiAction(this as unknown as AiHeuristicsContext, actions, ai.id);
      if (!best || best.type === "end") {
        logs.push(...(await this.endPlayPhase(ai.id)));
        return logs;
      }
      const targetId = best.requiresTarget ? pickBestTarget(this as unknown as AiHeuristicsContext, best.targets) : undefined;
      logs.push(...(await this.playAction(ai.id, best, targetId)));
      if (this.winner !== null) {
        return logs;
      }
    }
  }

  getBestAiDecision(playerId: string): { action: GameAction; targetId?: string } | null {
    const player = this.players.find((item) => item.id === playerId);
    if (!player || !player.alive || !player.isAI) {
      return null;
    }
    const actions = this.getPlayableActions(player.id);
    const best = pickBestAiAction(this as unknown as AiHeuristicsContext, actions, player.id);
    if (!best) {
      return null;
    }
    if (best.type === "end" || !best.requiresTarget) {
      return { action: best };
    }
    const targetId = pickBestTarget(this as unknown as AiHeuristicsContext, best.targets);
    return targetId ? { action: best, targetId } : { action: best };
  }

  setPlayerResponsePolicy(playerId: string, policy: Partial<Record<ResponseKind, boolean>> | null): void {
    if (policy === null) {
      this.responsePolicyByPlayer.delete(playerId);
      return;
    }
    this.responsePolicyByPlayer.set(playerId, { ...(this.responsePolicyByPlayer.get(playerId) ?? {}), ...policy });
  }

  setDecisionHandler(playerId: string, handler: DecisionHandler | null): void {
    if (handler === null) {
      this.decisionHandlers.delete(playerId);
      return;
    }
    this.decisionHandlers.set(playerId, handler);
  }

  getUsableCardSources(playerId: string): CardSource[] {
    return this.buildUsableSources(this.mustGetPlayer(playerId));
  }

  private nextInteractionId(): number {
    this.interactionSeq += 1;
    return this.interactionSeq;
  }

  private async decide(request: InteractionRequest): Promise<InteractionDecision> {
    const playerId =
      request.kind === "respond" ? request.responderId : request.kind === "collateral" ? request.targetId : request.playerId;
    const target = this.players.find((player) => player.id === playerId);
    if (target && !target.alive) {
      return this.autoDecisionForDeadPlayer(request);
    }
    const handler = this.decisionHandlers.get(playerId);
    if (handler) {
      try {
        const decision = await handler(request);
        if (decision) {
          return decision;
        }
      } catch {
        // 处理器异常时回退自动决策，避免结算中断
      }
    }
    return this.autoDecision(request);
  }

  private autoDecisionForDeadPlayer(request: InteractionRequest): InteractionDecision {
    if (
      request.kind === "optional-effect" ||
      request.kind === "respond" ||
      request.kind === "collateral"
    ) {
      return { choice: "pass" };
    }
    if (request.kind === "choose-discard" || request.kind === "choose-card") {
      return { choice: "pass" };
    }
    if (request.kind === "choose-suit") {
      return { choice: "suit", suit: request.suits[0] ?? "heart" };
    }
    return { choice: "pass" };
  }

  private autoDecision(request: InteractionRequest): InteractionDecision {
    if (request.kind === "optional-effect") {
      return { choice: "effect", enabled: false };
    }
    if (request.kind === "collateral") {
      const victim = request.victims[0];
      if (victim) {
        const firstSlash = request.sources[0];
        return firstSlash
          ? { choice: "target", targetId: victim, sourceId: firstSlash.sourceId }
          : { choice: "target", targetId: victim };
      }
      return { choice: "pass" };
    }
    if (request.kind === "choose-discard" || request.kind === "choose-card") {
      const first = request.sources[0];
      if (first) {
        return { choice: "card", sourceId: first.sourceId };
      }
      return { choice: "pass" };
    }
    if (request.kind === "choose-suit") {
      const suit = request.suits[this.randomIndex(request.suits.length)] ?? "heart";
      return { choice: "suit", suit };
    }
    const nonHarmfulNegateTargets = new Set<string>([
      CardType.ExNihilo,
      CardType.PeachGarden,
      CardType.Harvest,
      CardType.IronChain,
    ]);
    if (
      request.kind === "respond" &&
      request.responseKind === "negate" &&
      (
        request.responderId !== request.trigger.targetId ||
        nonHarmfulNegateTargets.has(request.trigger.cardName)
      )
    ) {
      return { choice: "pass" };
    }
    const first = request.sources[0];
    if (first) {
      return { choice: "card", sourceId: first.sourceId };
    }
    return { choice: "pass" };
  }

  private buildUsableSources(player: Player): CardSource[] {
    const sources: CardSource[] = [];
    for (const card of player.hand) {
      sources.push({ sourceId: `hand:${card.id}`, origin: "hand", card, label: formatCard(card) });
    }
    for (const card of player.treasureCards) {
      sources.push({ sourceId: `treasure:${card.id}`, origin: "treasure", card, label: `${formatCard(card)}（木牛流马）` });
    }
    for (const [origin, zone, type] of [
      ["weapon", "weapon", player.weapon],
      ["armor", "armor", player.armor],
      ["defenseHorse", "defenseHorse", player.defenseHorse],
      ["attackHorse", "attackHorse", player.attackHorse],
      ["equippedTreasure", "treasure", player.treasure],
    ] as const) {
      if (type === null) continue;
      player.equippedCards ??= {};
      const card = player.equippedCards[zone] ?? this.createCard(type, `legacy-source-${player.id}-${zone}`);
      player.equippedCards[zone] = card;
      sources.push({
        sourceId: `${origin}:${card.id}`,
        origin,
        card,
        label: `${formatCard(card)}（装备区）`,
      });
    }
    return sources;
  }

  createDefaultGeneralDraft(playerCount: number, requestedHumanRole: PlayerRole): GeneralDraftSeat[] {
    const normalizedCount = Math.min(6, Math.max(2, Math.floor(playerCount)));
    const roles = this.buildRoleList(normalizedCount);
    const humanRole = roles.includes(requestedHumanRole) ? requestedHumanRole : PlayerRole.Lord;
    const remainingRoles = [...roles];
    remainingRoles.splice(remainingRoles.indexOf(humanRole), 1);
    return dealGeneralCandidates([
      { playerId: "human", role: humanRole },
      ...remainingRoles.map((role, index) => ({ playerId: `ai-${index + 1}`, role })),
    ], this.rng);
  }

  createNetworkGeneralDraft(playerConfigs: NetworkPlayerConfig[]): GeneralDraftSeat[] {
    if (playerConfigs.length < 2 || playerConfigs.length > 6) {
      throw new Error("联机人数必须在 2 到 6 人之间");
    }
    const ids = new Set(playerConfigs.map((player) => player.id));
    if (ids.size !== playerConfigs.length) {
      throw new Error("联机玩家 ID 不能重复");
    }
    const shuffledRoles = shuffle(this.buildRoleList(playerConfigs.length), this.rng);
    return dealGeneralCandidates(playerConfigs.map((config, index) => ({
      playerId: config.id,
      role: shuffledRoles[index] ?? PlayerRole.Rebel,
    })), this.rng);
  }

  private peekUsableCard(player: Player, sourceId: string): CardSource | undefined {
    const separator = sourceId.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    const origin = sourceId.slice(0, separator);
    const cardId = sourceId.slice(separator + 1);
    const pool = origin === "treasure" ? player.treasureCards : origin === "hand" ? player.hand : null;
    if (!pool) {
      const zone = this.cardOriginToEquipmentZone(origin);
      if (!zone) return undefined;
      const card = player.equippedCards?.[zone];
      if (!card || card.id !== cardId) return undefined;
      return { sourceId, origin: origin as CardSource["origin"], card, label: `${formatCard(card)}（装备区）` };
    }
    const card = pool.find((item) => item.id === cardId);
    if (!card) {
      return undefined;
    }
    return { sourceId, origin: origin as CardSource["origin"], card, label: formatCard(card) };
  }

  private async removeUsableCardBySourceId(player: Player, sourceId: string, logs?: string[]): Promise<Card | undefined> {
    const separator = sourceId.indexOf(":");
    if (separator < 0) {
      return undefined;
    }
    const origin = sourceId.slice(0, separator);
    const cardId = sourceId.slice(separator + 1);
    if (origin === "treasure") {
      const index = player.treasureCards.findIndex((item) => item.id === cardId);
      if (index < 0) {
        return undefined;
      }
      return player.treasureCards.splice(index, 1)[0];
    }
    if (origin === "hand") {
      const index = player.hand.findIndex((item) => item.id === cardId);
      if (index < 0) {
        return undefined;
      }
      return this.removeHandCardAt(player, index);
    }
    const zone = this.cardOriginToEquipmentZone(origin);
    if (!zone) return undefined;
    const equipped = player.equippedCards?.[zone];
    if (!equipped || equipped.id !== cardId) return undefined;
    const equipType = this.getEquipmentType(player, zone);
    if (equipType === null) return undefined;
    this.clearEquipmentZone(player, zone);
    if (player.equippedCards) delete player.equippedCards[zone];
    if (zone === "treasure" && player.treasureCards.length > 0) {
      const dropped = player.treasureCards.splice(0);
      this.discardPile.push(...dropped);
      logs?.push(`${player.name} 的${CardType.WoodenOx}离开装备区，其下 ${dropped.length} 张牌置入弃牌堆`);
    }
    const effectLogs = await onLoseEquipImpl(this as unknown as ResolveContext, player, equipType);
    logs?.push(...effectLogs);
    return equipped;
  }

  private cardOriginToEquipmentZone(origin: string): EquipmentZone | null {
    if (origin === "weapon" || origin === "armor" || origin === "defenseHorse" || origin === "attackHorse") {
      return origin;
    }
    return origin === "equippedTreasure" ? "treasure" : null;
  }

  private getEquipmentType(player: Player, zone: EquipmentZone): EquipCardType | null {
    if (zone === "weapon") return player.weapon;
    if (zone === "armor") return player.armor;
    if (zone === "defenseHorse") return player.defenseHorse;
    if (zone === "attackHorse") return player.attackHorse;
    return player.treasure;
  }

  private clearEquipmentZone(player: Player, zone: EquipmentZone): void {
    if (zone === "weapon") player.weapon = null;
    else if (zone === "armor") player.armor = null;
    else if (zone === "defenseHorse") player.defenseHorse = null;
    else if (zone === "attackHorse") player.attackHorse = null;
    else player.treasure = null;
  }

  private buildDodgeSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Dodge) {
        sources.push({ ...source, label: `打出${CardType.Dodge}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.QingGuo)) {
      for (const source of all) {
        if (
          (source.origin === "hand" || source.origin === "treasure") &&
          source.card.color === "black" &&
          source.card.type !== CardType.Dodge
        ) {
          sources.push({ ...source, label: `${SkillName.QingGuo}当${CardType.Dodge}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${SkillName.LongDan}当${CardType.Dodge}` });
        }
      }
    }
    return sources;
  }

  private buildSlashSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (this.isSlashCard(source.card.type)) {
        sources.push({ ...source, label: `打出${source.card.type}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.WuSheng)) {
      for (const source of all) {
        if (source.card.color === "red" && !this.isSlashCard(source.card.type)) {
          sources.push({ ...source, label: `${SkillName.WuSheng}当${CardType.Slash}` });
        }
      }
    }
    if (this.hasSkill(player, SkillName.LongDan)) {
      for (const source of all) {
        if (source.card.type === CardType.Dodge) {
          sources.push({ ...source, label: `${SkillName.LongDan}当${CardType.Slash}` });
        }
      }
    }
    return sources;
  }

  private buildNegateSources(player: Player): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources = all
      .filter((source) => source.card.type === CardType.Negate)
      .map((source) => ({ ...source, label: `打出${CardType.Negate}${source.origin === "treasure" ? "（木牛流马）" : ""}` }));
    if (this.hasSkill(player, SkillName.JieWei)) {
      for (const source of all) {
        if (source.origin !== "hand" && source.origin !== "treasure") {
          sources.push({ ...source, label: `${SkillName.JieWei}将装备牌当${CardType.Negate}` });
        }
      }
    }
    return sources;
  }

  private buildPeachSources(player: Player, dyingPlayerId?: string): CardSource[] {
    const all = this.buildUsableSources(player);
    const sources: CardSource[] = [];
    for (const source of all) {
      if (source.card.type === CardType.Peach) {
        sources.push({ ...source, label: `使用${CardType.Peach}${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      } else if (source.card.type === CardType.Wine && player.id === dyingPlayerId) {
        sources.push({ ...source, label: `使用${CardType.Wine}自救${source.origin === "treasure" ? "（木牛流马）" : ""}` });
      }
    }
    if (this.hasSkill(player, SkillName.JiJiu) && player.id !== this.currentPlayer.id) {
      for (const source of all) {
        if (source.card.color === "red" && source.card.type !== CardType.Peach) {
          sources.push({ ...source, label: `${SkillName.JiJiu}当${CardType.Peach}` });
        }
      }
    }
    return sources;
  }

  private buildResponseSources(player: Player, kind: ResponseKind, dyingPlayerId?: string): CardSource[] {
    if (kind === "dodge") return this.buildDodgeSources(player);
    if (kind === "slash") return this.buildSlashSources(player);
    if (kind === "negate") return this.buildNegateSources(player);
    return this.buildPeachSources(player, dyingPlayerId);
  }

  private async consumeResponseCard(
    player: Player,
    kind: ResponseKind,
    sourceId: string,
    logs: string[],
    dyingPlayerId?: string,
  ): Promise<boolean> {
    const source = this.peekUsableCard(player, sourceId);
    if (!source) {
      return false;
    }
    const card = source.card;
    const direct =
      kind === "dodge"
        ? card.type === CardType.Dodge
        : kind === "slash"
          ? this.isSlashCard(card.type)
          : kind === "negate"
            ? card.type === CardType.Negate
            : card.type === CardType.Peach || (card.type === CardType.Wine && player.id === dyingPlayerId);
    if (!direct) {
      const convertedLabel =
        kind === "dodge" &&
        (source.origin === "hand" || source.origin === "treasure") &&
        card.color === "black" &&
        this.hasSkill(player, SkillName.QingGuo)
          ? `${SkillName.QingGuo}当${CardType.Dodge}`
          : kind === "dodge" && this.isSlashCard(card.type) && this.hasSkill(player, SkillName.LongDan)
            ? `${SkillName.LongDan}当${CardType.Dodge}`
            : kind === "slash" && card.color === "red" && this.hasSkill(player, SkillName.WuSheng)
              ? `${SkillName.WuSheng}当${CardType.Slash}`
              : kind === "slash" && card.type === CardType.Dodge && this.hasSkill(player, SkillName.LongDan)
                ? `${SkillName.LongDan}当${CardType.Slash}`
                : kind === "peach" && card.color === "red" && this.hasSkill(player, SkillName.JiJiu)
                  ? `${SkillName.JiJiu}当${CardType.Peach}`
                  : kind === "negate" && source.origin !== "hand" && source.origin !== "treasure" && this.hasSkill(player, SkillName.JieWei)
                    ? `${SkillName.JieWei}当${CardType.Negate}`
                  : null;
      if (!convertedLabel) {
        return false;
      }
      logs.push(`${player.name} 发动${convertedLabel}（${card.type}）`);
    }
    const removed = await this.removeUsableCardBySourceId(player, sourceId, logs);
    if (!removed) {
      return false;
    }
    this.discardPile.push(removed);
    if (kind === "slash" && player.id === this.currentPlayer.id) this.slashUsedThisTurn = true;
    return true;
  }

  private async requestCardResponse(
    player: Player,
    kind: ResponseKind,
    trigger: { cardName: string; actorId: string; targetId?: string },
    logs: string[],
    reasonOverride?: string,
  ): Promise<boolean> {
    const policy = this.responsePolicyByPlayer.get(player.id);
    if (policy && policy[kind] === false) {
      this.setPlayerResponseSelection(player.id, kind, null);
      return false;
    }
    const selection = this.takePlayerResponseSelection(player.id, kind);
    if (selection) {
      return await this.consumeSelectedResponse(player, kind, selection, logs);
    }
    const dyingPlayerId = kind === "peach" ? trigger.actorId : undefined;
    const sources = this.buildResponseSources(player, kind, dyingPlayerId);
    if (sources.length === 0) {
      return false;
    }
    const cardNames: Record<ResponseKind, string> = {
      dodge: CardType.Dodge,
      slash: CardType.Slash,
      negate: CardType.Negate,
      peach: CardType.Peach,
    };
    const decision = await this.decide({
      kind: "respond",
      requestId: this.nextInteractionId(),
      responderId: player.id,
      trigger,
      responseKind: kind,
      sources,
      allowPass: true,
      reason: reasonOverride ?? `${trigger.cardName}：是否打出${cardNames[kind]}？`,
    });
    if (decision.choice !== "card") {
      return false;
    }
    return await this.consumeResponseCard(player, kind, decision.sourceId, logs, dyingPlayerId);
  }

  private async requestDiscardSelection(
    player: Player,
    count: number,
    reason: string,
    providedSources?: CardSource[],
    logs?: string[],
  ): Promise<Card[]> {
    return this.requestCardRemovalSelection("choose-discard", player, count, reason, providedSources, logs);
  }

  private async requestCardSelection(
    player: Player,
    count: number,
    reason: string,
    providedSources?: CardSource[],
    logs?: string[],
  ): Promise<Card[]> {
    return this.requestCardRemovalSelection("choose-card", player, count, reason, providedSources, logs);
  }

  private consumeWineSlashBonus(playerId: string): number {
    return this.wineSlashBonus.delete(playerId) ? 1 : 0;
  }

  private async requestCardRemovalSelection(
    kind: "choose-card" | "choose-discard",
    player: Player,
    count: number,
    reason: string,
    providedSources?: CardSource[],
    logs?: string[],
  ): Promise<Card[]> {
    const picked: Card[] = [];
    const selectableSources = providedSources ?? this.buildUsableSources(player);
    for (let i = 0; i < count; i += 1) {
      const sources = selectableSources
        .filter((source) => this.peekUsableCard(player, source.sourceId) !== undefined);
      if (sources.length === 0) {
        break;
      }
      const decision = await this.decide({
        kind,
        requestId: this.nextInteractionId(),
        playerId: player.id,
        reason: count > 1 ? `${reason}（第 ${i + 1}/${count} 张）` : reason,
        sources,
        count: 1,
        allowPass: false,
      });
      if (decision.choice !== "card") {
        break;
      }
      const card = await this.removeUsableCardBySourceId(player, decision.sourceId, logs);
      if (!card) {
        break;
      }
      picked.push(card);
    }
    return picked;
  }

  private canPlayerRespond(playerId: string, kind: ResponseKind): boolean {
    const policy = this.responsePolicyByPlayer.get(playerId);
    if (!policy) {
      return true;
    }
    const allowed = policy[kind];
    return allowed !== false;
  }

  private async consumeSelectedResponse(
    player: Player,
    kind: ResponseKind,
    optionId: string,
    logs: string[],
    dyingPlayerId?: string,
  ): Promise<boolean> {
    let cardId = optionId;
    if (optionId.startsWith("qingguo:") || optionId.startsWith("wusheng:") || optionId.startsWith("longdan:")) {
      cardId = optionId.slice(optionId.indexOf(":") + 1);
    }
    const handSourceId = `hand:${cardId}`;
    if (this.peekUsableCard(player, handSourceId)) {
      return await this.consumeResponseCard(player, kind, handSourceId, logs, dyingPlayerId);
    }
    const treasureSourceId = `treasure:${cardId}`;
    if (this.peekUsableCard(player, treasureSourceId)) {
      return await this.consumeResponseCard(player, kind, treasureSourceId, logs, dyingPlayerId);
    }
    const responseSource = this.buildResponseSources(player, kind, dyingPlayerId)
      .find((source) => source.sourceId === optionId || source.card.id === cardId);
    if (responseSource) {
      return await this.consumeResponseCard(player, kind, responseSource.sourceId, logs, dyingPlayerId);
    }
    return false;
  }

  private async consumePeachResponse(player: Player, dyingPlayerId: string, logs: string[]): Promise<boolean> {
    const targetedDecisions = this.peachDecisions.get(dyingPlayerId);
    if (targetedDecisions?.has(player.id)) {
      const optionId = targetedDecisions.get(player.id);
      if (optionId === null || optionId === undefined) return false;
      return await this.consumeSelectedResponse(player, "peach", optionId, logs, dyingPlayerId);
    }
    if (!this.canPlayerRespond(player.id, "peach")) return false;
    return this.requestCardResponse(player, "peach", { cardName: CardType.Peach, actorId: dyingPlayerId }, logs);
  }

  private takePlayerResponseSelection(playerId: string, kind: ResponseKind): string | undefined {
    const selected = this.responseSelectionByPlayer.get(playerId);
    if (!selected) {
      return undefined;
    }
    const optionId = selected[kind];
    delete selected[kind];
    if (Object.keys(selected).length === 0) {
      this.responseSelectionByPlayer.delete(playerId);
    } else {
      this.responseSelectionByPlayer.set(playerId, selected);
    }
    return optionId;
  }

  setOptionalEffectDecision(playerId: string, effect: SkillName | CardType, enabled: boolean | null): void {
    const key = `${playerId}:${effect}`;
    if (enabled === null) this.optionalEffectDecisions.delete(key);
    else this.optionalEffectDecisions.set(key, enabled);
  }

  getPlayerResponseOptions(playerId: string, kind: ResponseKind): ResponseOption[] {
    const player = this.players.find((item) => item.id === playerId);
    if (!player || !player.alive) {
      return [];
    }
    if (kind === "negate" || kind === "peach") {
      const cardType = kind === "negate" ? CardType.Negate : CardType.Peach;
      return player.hand
        .filter((card) => card.type === cardType)
        .map((card) => ({ id: card.id, kind, label: `打出${cardType}` }));
    }
    if (kind === "dodge") {
      const direct = player.hand
        .filter((card) => card.type === CardType.Dodge)
        .map((card) => ({ id: card.id, kind, label: `打出${CardType.Dodge}` }));
      const qingGuo = this.hasSkill(player, SkillName.QingGuo)
        ? player.hand
            .filter((card) => card.color === "black" && card.type !== CardType.Dodge)
            .map((card) => ({ id: `qingguo:${card.id}`, kind, label: `${SkillName.QingGuo}当${CardType.Dodge}` }))
        : [];
      const longDan = this.hasSkill(player, SkillName.LongDan)
        ? player.hand
            .filter((card) => this.isSlashCard(card.type))
            .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Dodge}` }))
        : [];
      return [...direct, ...qingGuo, ...longDan];
    }
    const direct = player.hand
      .filter((card) => this.isSlashCard(card.type))
      .map((card) => ({ id: card.id, kind, label: `打出${card.type}` }));
    const wuSheng = this.hasSkill(player, SkillName.WuSheng)
      ? player.hand
          .filter((card) => card.color === "red" && !this.isSlashCard(card.type))
          .map((card) => ({ id: `wusheng:${card.id}`, kind, label: `${SkillName.WuSheng}当${CardType.Slash}` }))
      : [];
    const longDan = this.hasSkill(player, SkillName.LongDan)
      ? player.hand
          .filter((card) => card.type === CardType.Dodge)
          .map((card) => ({ id: `longdan:${card.id}`, kind, label: `${SkillName.LongDan}当${CardType.Slash}` }))
      : [];
    return [...direct, ...wuSheng, ...longDan];
  }

  setPlayerResponseSelection(playerId: string, kind: ResponseKind, optionId: string | null): void {
    if (optionId === null) {
      const existed = this.responseSelectionByPlayer.get(playerId);
      if (!existed) {
        return;
      }
      delete existed[kind];
      if (Object.keys(existed).length === 0) {
        this.responseSelectionByPlayer.delete(playerId);
      }
      return;
    }
    const existed = this.responseSelectionByPlayer.get(playerId) ?? {};
    existed[kind] = optionId;
    this.responseSelectionByPlayer.set(playerId, existed);
  }

  setPeachDecision(dyingPlayerId: string, rescuerId: string, optionId: string | null): void {
    const decisions = this.peachDecisions.get(dyingPlayerId) ?? new Map<string, string | null>();
    decisions.set(rescuerId, optionId);
    this.peachDecisions.set(dyingPlayerId, decisions);
  }

  clearPeachDecisions(): void {
    this.peachDecisions.clear();
  }

  setDeferDyingResolution(enabled: boolean): void {
    this.deferDyingResolution = enabled;
  }

  consumePendingNextTurn(): boolean {
    const value = this.pendingNextTurn;
    this.pendingNextTurn = false;
    return value;
  }

  consumePendingTurnEnd(): string | null {
    const value = this.pendingTurnEndPlayer;
    this.pendingTurnEndPlayer = null;
    return value;
  }

  isGameOver(): boolean {
    return this.winner !== null;
  }

  getTurnStartOptionalEffects(playerId: string): (SkillName | CardType)[] {
    const player = this.mustGetPlayer(playerId);
    if (player.faceDown) {
      return this.hasSkill(player, SkillName.JieWei) ? [SkillName.JieWei] : [];
    }
    const effects: (SkillName | CardType)[] = [];
    if (this.hasSkill(player, SkillName.GuanXing)) effects.push(SkillName.GuanXing);
    if (this.hasSkill(player, SkillName.LuoShen)) effects.push(SkillName.LuoShen);
    if (this.hasSkill(player, SkillName.YingHun) && Math.max(0, player.maxHp - player.hp) > 0) {
      const others = this.players.filter((item) => item.alive && item.id !== player.id);
      if (others.length > 0) effects.push(SkillName.YingHun);
    }
    if (this.hasSkill(player, SkillName.Heroic)) effects.push(SkillName.Heroic);
    if (this.hasSkill(player, SkillName.LuoYi)) effects.push(SkillName.LuoYi);
    if (this.hasSkill(player, SkillName.TuXi)) effects.push(SkillName.TuXi);
    return effects;
  }

  getTurnEndOptionalEffects(playerId: string): (SkillName | CardType)[] {
    const player = this.mustGetPlayer(playerId);
    const effects: (SkillName | CardType)[] = [];
    if (this.hasSkill(player, SkillName.BiYue)) effects.push(SkillName.BiYue);
    if (this.hasSkill(player, SkillName.JuShou)) effects.push(SkillName.JuShou);
    return effects;
  }

  async resolvePendingDeaths(): Promise<string[]> {
    const deferred = this.deferDyingResolution;
    this.deferDyingResolution = false;
    const logs = [...(await this.resolveDeaths()), ...this.resolveWinner()];
    this.deferDyingResolution = deferred;
    return logs;
  }

  async startTurn(): Promise<string[]> {
    if (this.winner !== null) {
      return [];
    }
    this.phase = TurnPhase.Start;
    this.slashUsedThisTurn = false;
    this.wineUsedThisTurn = new Set();
    this.wineSlashBonus = new Set();
    this.woodenOxUsedThisTurn = new Set();
    const player = this.currentPlayer;
    this.resetTurnSkillState(player.id);
    const logs = [`第 ${this.turn} 回合：${player.name} 的回合`, `进入${TurnPhase.Start}`];
    if (player.faceDown) {
      player.faceDown = false;
      logs.push(`${player.name} 翻至正面，跳过本回合`);
      if (this.hasSkill(player, SkillName.JieWei) && await this.shouldActivateOptionalEffect(player, SkillName.JieWei)) {
        logs.push(...(await this.moveFieldCardForJieWei(player)));
      }
      this.moveToNextPlayer();
      if (this.winner !== null) return logs;
      if (this.staged) {
        this.pendingNextTurn = true;
        return logs;
      }
      logs.push(...(await this.startTurn()));
      return logs;
    }
    await this.emitSkillTrigger("turn_start", { actor: player }, logs);
    this.phase = TurnPhase.Judgment;
    logs.push(`进入${TurnPhase.Judgment}`);
    if (player.delayedTricks.length > 0) {
      logs.push(...(await this.resolveDelayedJudgments(player)));
    } else {
      logs.push(`${player.name} 的判定区为空`);
    }
    logs.push(...(await this.resolvePendingDeaths()));
    if (this.winner !== null) {
      return logs;
    }
    if (!player.alive) {
      await this.advanceIfCurrentPlayerDead(logs);
      return logs;
    }
    this.phase = TurnPhase.Draw;
    logs.push(`进入${TurnPhase.Draw}`);
    if (this.skipDrawPhase === player.id) {
      this.skipDrawPhase = null;
      logs.push(`${player.name} 跳过摸牌阶段`);
    } else {
      const drawPayload: SkillEventPayload = { actor: player, drawCount: drawCountPerTurn };
      await this.emitSkillTrigger("before_draw", drawPayload, logs);
      const drawn = this.drawCards(player.id, drawPayload.drawCount ?? drawCountPerTurn);
      logs.push(`${player.name} 摸了 ${drawn} 张牌`);
    }
    this.phase = TurnPhase.Play;
    if (this.skipPlayPhase === player.id) {
      this.skipPlayPhase = null;
      logs.push(`${player.name} 跳过出牌阶段`);
      logs.push(...(await this.endPlayPhase(player.id)));
      return logs;
    }
    logs.push(`进入${TurnPhase.Play}`);
    return logs;
  }

  private async endPlayPhase(playerId: string): Promise<string[]> {
    const player = this.mustGetPlayer(playerId);
    if (!player.alive || player.id !== this.currentPlayer.id || this.phase !== TurnPhase.Play) {
      return [];
    }
    this.phase = TurnPhase.Discard;
    const logs: string[] = [];
    logs.push(`进入${TurnPhase.Discard}`);
    if (
      this.hasSkill(player, SkillName.KeJi) &&
      !this.slashUsedThisTurn &&
      await this.shouldActivateOptionalEffect(player, SkillName.KeJi)
    ) {
      logs.push(`${player.name} 的${SkillName.KeJi}生效，跳过弃牌阶段`);
      if (this.staged) this.pendingTurnEndPlayer = player.id;
      else logs.push(...(await this.finishTurn(player)));
      return logs;
    }
    if (!player.isAI && player.hand.length > player.hp) {
      logs.push(`${player.name} 需要弃置 ${player.hand.length - player.hp} 张手牌`);
      return logs;
    }
    while (player.hand.length > player.hp) {
      const index = this.randomIndex(player.hand.length);
      const removed = await this.removeHandCardAt(player, index);
      if (removed) {
        this.discardPile.push(removed);
        logs.push(`${player.name} 弃置了 ${removed.type}`);
      }
    }
    if (this.staged) {
      this.pendingTurnEndPlayer = player.id;
    } else {
      logs.push(...(await this.finishTurn(player)));
    }
    return logs;
  }

  async finishTurn(player: Player): Promise<string[]> {
    const logs: string[] = [];
    this.phase = TurnPhase.End;
    logs.push(`进入${TurnPhase.End}`);
    if (this.hasSkill(player, SkillName.BiYue) && await this.shouldActivateOptionalEffect(player, SkillName.BiYue)) {
      const drawn = this.drawCards(player.id, 1);
      logs.push(`${player.name} 的${SkillName.BiYue}生效，摸了 ${drawn} 张牌`);
    }
    if (this.hasSkill(player, SkillName.JuShou) && await this.shouldActivateOptionalEffect(player, SkillName.JuShou)) {
      const drawn = this.drawCards(player.id, 4);
      player.faceDown = true;
      logs.push(`${player.name} 发动${SkillName.JuShou}，将武将牌翻至背面并摸了 ${drawn} 张牌`);
      const handSources = this.buildUsableSources(player).filter((source) => source.origin === "hand");
      const [discarded] = await this.requestDiscardSelection(player, 1, `${SkillName.JuShou}：弃置1张手牌`, handSources, logs);
      if (discarded) {
        if (isEquipCardImpl(discarded.type)) {
          logs.push(`${player.name} 以${SkillName.JuShou}弃置了装备牌，改为使用${formatCard(discarded)}`);
          logs.push(...(await resolveEquipImpl(this as unknown as ResolveContext, player, discarded)));
        } else {
          this.discardPile.push(discarded);
          logs.push(`${player.name} 以${SkillName.JuShou}弃置了${formatCard(discarded)}`);
        }
      }
    }
    logs.push(`${player.name} 结束回合`);
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return logs;
    }
    if (this.staged) {
      this.pendingNextTurn = true;
      return logs;
    }
    logs.push(...(await this.startTurn()));
    return logs;
  }

  private findTargetsByCard(playerId: string, cardType: CardType): string[] {
    if (!this.cardNeedsTarget(cardType)) {
      return [];
    }
    if (cardType === CardType.Wine) {
      return this.players.some((player) => player.id === playerId && player.alive) ? [playerId] : [];
    }
    if (cardType === CardType.IronChain || cardType === CardType.ExNihilo) {
      return this.players.filter((player) => player.alive).map((player) => player.id);
    }
    if (cardType === CardType.Peach) {
      return this.players.filter((player) => player.alive && player.hp < player.maxHp).map((player) => player.id);
    }
    const targets = this.players
      .filter((player) => player.id !== playerId && player.alive)
      .map((player) => player.id);
    if (this.isSlashCard(cardType)) {
      const attacker = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const target = this.mustGetPlayer(id);
        return this.canReachForSlash(attacker, target) && !this.isKongChengProtected(target, cardType);
      });
    }
    if (cardType === CardType.Duel) {
      return targets.filter((id) => !this.isKongChengProtected(this.mustGetPlayer(id), cardType));
    }
    if (cardType === CardType.FireAttack) {
      return this.players.filter((player) => player.alive && player.hand.length > 0).map((player) => player.id);
    }
    if (cardType === CardType.Dismantle) {
      return targets.filter((id) => hasRemovableCard(this.mustGetPlayer(id)));
    }
    if (cardType === CardType.Snatch) {
      const user = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        if (this.hasSkill(holder, SkillName.QianXun)) {
          return false;
        }
        return hasRemovableCard(holder) && (
          this.hasSkill(user, SkillName.QiCai) ||
          computeDistanceImpl(this as unknown as ResolveContext, user, holder) <= 1
        );
      });
    }
    if (cardType === CardType.Collateral) {
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        if (holder.weapon === null) return false;
        return this.players.some(
          (victim) =>
            victim.alive &&
            victim.id !== holder.id &&
            this.canReachForSlash(holder, victim) &&
            !this.isKongChengProtected(victim, CardType.Slash),
        );
      });
    }
    if (cardType === CardType.Indulgence || cardType === CardType.SuppliesCut) {
      const user = this.mustGetPlayer(playerId);
      return targets.filter((id) => {
        const holder = this.mustGetPlayer(id);
        if (cardType === CardType.Indulgence && this.hasSkill(holder, SkillName.QianXun)) {
          return false;
        }
        if (holder.delayedTricks.some((t) => t.cardType === cardType)) return false;
        return cardType !== CardType.SuppliesCut || this.hasSkill(user, SkillName.QiCai) ||
          computeDistanceImpl(this as unknown as ResolveContext, user, holder) <= 1;
      });
    }
    return targets;
  }

  private findTargetsForConvertedSlash(player: Player, source: CardSource): string[] {
    const zone = this.cardOriginToEquipmentZone(source.origin);
    if (
      zone === "weapon" &&
      source.card.type === CardType.Crossbow &&
      this.slashUsedThisTurn &&
      !this.hasSkill(player, SkillName.Roar)
    ) {
      return [];
    }
    if (zone === null) return this.findTargetsByCard(player.id, CardType.Slash);
    const equipment = this.getEquipmentType(player, zone);
    this.clearEquipmentZone(player, zone);
    const targets = this.findTargetsByCard(player.id, CardType.Slash);
    if (zone === "weapon") player.weapon = equipment as Player["weapon"];
    else if (zone === "armor") player.armor = equipment as Player["armor"];
    else if (zone === "defenseHorse") player.defenseHorse = equipment as Player["defenseHorse"];
    else if (zone === "attackHorse") player.attackHorse = equipment as Player["attackHorse"];
    else player.treasure = equipment as Player["treasure"];
    return targets;
  }

  private drawCards(playerId: string, count: number): number {
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

  private drawCard(): Card | null {
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

  private async drawJudgmentCard(reason: string, logs: string[], owner?: Player): Promise<Card | null> {
    let card = this.drawCard();
    if (!card) {
      logs.push(`${reason}无法判定：牌堆为空`);
      return null;
    }
    const suitNames = { heart: "红桃", diamond: "方片", club: "梅花", spade: "黑桃", none: "无花色" } as const;
    logs.push(`${reason}判定牌：${suitNames[card.suit]}${card.rank} ${card.type}`);
    const guiCaiPlayer = this.players.find((item) => item.alive && this.hasSkill(item, SkillName.GuiCai));
    if (guiCaiPlayer) {
      const sources = this.buildUsableSources(guiCaiPlayer).filter((source) => source.origin === "hand");
      if (sources.length > 0) {
        const decision = await this.decide({
          kind: "choose-card",
          requestId: this.nextInteractionId(),
          playerId: guiCaiPlayer.id,
          reason: `${reason}：${guiCaiPlayer.name} 是否发动${SkillName.GuiCai}，用手牌替换判定牌？`,
          sources,
          count: 1,
          allowPass: true,
          passLabel: `不发动${SkillName.GuiCai}`,
        });
        if (decision.choice === "card") {
          const replacement = await this.removeUsableCardBySourceId(guiCaiPlayer, decision.sourceId);
          if (replacement) {
            this.discardPile.push(card);
            card = replacement;
            logs.push(`${guiCaiPlayer.name} 发动${SkillName.GuiCai}，以 ${formatCard(replacement)} 替换判定牌`);
          }
        }
      }
    }
    logs.push(`${reason}最终判定牌：${formatCard(card)}`);
    if (owner && this.hasSkill(owner, SkillName.TianDu) && await this.shouldActivateOptionalEffect(owner, SkillName.TianDu)) {
      owner.hand.push(card);
      logs.push(`${owner.name} 的${SkillName.TianDu}生效，获得判定牌 ${formatCard(card)}`);
    } else {
      this.discardPile.push(card);
    }
    return card;
  }

  private moveToNextPlayer(): void {
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

  private async advanceIfCurrentPlayerDead(logs: string[]): Promise<void> {
    if (this.winner !== null) {
      return;
    }
    const current = this.players[this.currentPlayerIndex];
    if (current?.alive) {
      return;
    }
    this.moveToNextPlayer();
    if (this.winner !== null) {
      return;
    }
    if (this.staged) {
      this.pendingNextTurn = true;
      return;
    }
    logs.push(...(await this.startTurn()));
  }

  private normalizeInitOptions(options: Partial<GameInitOptions>): GameInitOptions {
    const playerCountSource = options.playerCount ?? ((options.aiCount ?? defaultInitOptions.aiCount) + 1);
    const playerCount = Math.min(6, Math.max(2, Math.floor(playerCountSource)));
    const aiCount = playerCount - 1;
    const openingHandCount = options.openingHandCount ?? defaultInitOptions.openingHandCount;
    const humanName = options.humanName ?? defaultInitOptions.humanName;
    const humanRole = options.humanRole ?? defaultInitOptions.humanRole;
    const humanGeneral = options.humanGeneral ?? defaultInitOptions.humanGeneral;
    const generalAssignments = options.generalAssignments ?? defaultInitOptions.generalAssignments;
    return {
      playerCount,
      aiCount,
      openingHandCount: Math.min(6, Math.max(3, Math.floor(openingHandCount))),
      humanName,
      humanRole,
      humanGeneral,
      generalAssignments: { ...generalAssignments },
    };
  }

  private createPlayer(
    id: string,
    name: string,
    isAI: boolean,
    general: GeneralDefinition,
    role: PlayerRole,
  ): Player {
    return {
      id,
      name,
      role,
      gender: general.gender,
      general: general.name,
      skills: [...general.skills],
      isAI,
      hp: general.maxHp,
      maxHp: general.maxHp,
      hand: [],
      weapon: null,
      armor: null,
      defenseHorse: null,
      attackHorse: null,
      treasure: null,
      treasureCards: [],
      equippedCards: {},
      delayedTricks: [],
      alive: true,
      faceDown: false,
      chained: false,
    };
  }

  private applyLordStartingHpBonus(): boolean {
    if (this.players.length < 5) return false;
    const lord = this.players.find((player) => player.role === PlayerRole.Lord);
    if (!lord) return false;
    lord.maxHp += 1;
    lord.hp += 1;
    return true;
  }

  private mustGetPlayer(id: string): Player {
    const player = this.players.find((item) => item.id === id);
    if (!player) {
      throw new Error(`player not found: ${id}`);
    }
    return player;
  }

  private randomIndex(length: number): number {
    return Math.floor(this.rng() * length);
  }

  private async discardFromPlayerHand(player: Player, count: number, logs: string[]): Promise<number> {
    let discarded = 0;
    for (let i = 0; i < count && player.hand.length > 0; i += 1) {
      const index = this.randomIndex(player.hand.length);
      const removed = await this.removeHandCardAt(player, index);
      if (removed) {
        this.discardPile.push(removed);
        discarded += 1;
      }
    }
    if (discarded > 0) {
      logs.push(`${player.name} 弃置了 ${discarded} 张手牌`);
    }
    return discarded;
  }

  // 集中式手牌移除：所有“失去手牌”的路径统一走这里，便于触发连营。
  private async removeHandCardAt(player: Player, index: number, logs?: string[]): Promise<Card | undefined> {
    const removed = player.hand.splice(index, 1)[0];
    if (removed) {
      await this.checkLianYing(player, logs);
    }
    return removed;
  }

  // 连营：失去最后一张手牌时可摸一张牌。
  private async checkLianYing(player: Player, logs?: string[]): Promise<void> {
    if (this.winner !== null || !player.alive || player.hand.length > 0) {
      return;
    }
    if (!this.hasSkill(player, SkillName.LianYing)) {
      return;
    }
    if (!await this.shouldActivateOptionalEffect(player, SkillName.LianYing)) {
      return;
    }
    const drawn = this.drawCards(player.id, 1);
    if (drawn > 0 && logs) {
      logs.push(`${player.name} 的${SkillName.LianYing}生效，失去最后手牌后摸了 ${drawn} 张牌`);
    }
  }

  // 突袭/其他技能用：从目标获得 1 张随机手牌（不取装备）。
  private async takeRandomHandCard(player: Player, receiver: Player): Promise<Card | undefined> {
    if (player.hand.length === 0) {
      return undefined;
    }
    const index = this.randomIndex(player.hand.length);
    const removed = await this.removeHandCardAt(player, index);
    if (removed) {
      receiver.hand.push(removed);
    }
    return removed;
  }

  private drawTopCards(count: number): Card[] {
    const drawn: Card[] = [];
    for (let i = 0; i < count; i += 1) {
      const card = this.drawCard();
      if (!card) {
        break;
      }
      drawn.push(card);
    }
    return drawn;
  }

  private placeCardsOnTop(cards: Card[]): void {
    for (let i = cards.length - 1; i >= 0; i -= 1) {
      const card = cards[i];
      if (card) {
        this.deck.unshift(card);
      }
    }
  }

  private placeCardsOnBottom(cards: Card[]): void {
    this.deck.push(...cards);
  }

  private async emitSkillTrigger(trigger: SkillTrigger, payload: SkillEventPayload, logs: string[]): Promise<void> {
    const hooks = this.skillHooks[trigger];
    for (const hook of hooks) {
      await hook(payload, logs);
    }
  }

  private async applyDamage(
    source: Player | null,
    target: Player,
    amount: number,
    reason: string,
    logs: string[],
    nature: DamageNature = "normal",
    ignoreArmor = false,
    damageCards: Card[] = [],
    chainedVisited: Set<string> = new Set(),
  ): Promise<void> {
    if (!target.alive || chainedVisited.has(target.id)) return;
    chainedVisited.add(target.id);
    const shouldPropagate = nature !== "normal" && target.chained === true;
    const linkedTargets = !shouldPropagate
      ? []
      : this.players.filter((player) => player.alive && player.chained && player.id !== target.id);
    const payload: SkillEventPayload = {
      source,
      target,
      damage: amount,
      reason,
      damageNature: nature,
      damageCards,
    };
    await this.emitSkillTrigger("before_damage", payload, logs);
    let finalDamage = Math.max(0, payload.damage ?? 0);
    if (!ignoreArmor && nature === "fire" && target.armor === CardType.VineArmor) {
      finalDamage += 1;
      logs.push(`${target.name} 的藤甲受到火焰克制，伤害+1`);
    }
    if (!ignoreArmor && target.armor === CardType.SilverLion && finalDamage > 1) {
      finalDamage = 1;
      logs.push(`${target.name} 的白银狮子生效，本次伤害改为 1`);
    }
    if (finalDamage === 0) {
      logs.push(`${target.name} 未受到伤害`);
      return;
    }
    if (shouldPropagate) target.chained = false;
    this.lastDamageSourceByPlayer.set(target.id, source?.id ?? null);
    target.hp -= finalDamage;
    payload.damage = finalDamage;
    logs.push(`${target.name} 受到 ${finalDamage} 点伤害，当前体力 ${Math.max(target.hp, 0)}`);
    await this.emitSkillTrigger("after_damage", payload, logs);
    for (const linked of linkedTargets) {
      if (!linked.alive || chainedVisited.has(linked.id)) continue;
      logs.push(`${nature === "fire" ? "火焰" : "雷电"}伤害通过铁索传导至 ${linked.name}`);
      await this.applyDamage(source, linked, finalDamage, `${reason}（铁索连环）`, logs, nature, false, damageCards, chainedVisited);
    }
  }

  private getLastDamageSource(playerId: string): Player | null {
    const sourceId = this.lastDamageSourceByPlayer.get(playerId);
    return sourceId ? this.players.find((player) => player.id === sourceId) ?? null : null;
  }

  private clearLastDamageSource(playerId: string): void {
    this.lastDamageSourceByPlayer.delete(playerId);
  }

  private isKongChengProtected(target: Player, cardType: CardType): boolean {
    if (!this.hasSkill(target, SkillName.KongCheng)) {
      return false;
    }
    if (target.hand.length > 0) {
      return false;
    }
    return this.isSlashCard(cardType) || cardType === CardType.Duel;
  }

  // ===== 以下为从本类拆出到独立模块的方法的薄封装（行为不变） =====

  private buildRoleList(playerCount: number): PlayerRole[] {
    return buildRoleList(playerCount);
  }

  private getRoleDistribution(roles: PlayerRole[]): { rebel: number; loyalist: number; traitor: number } {
    return getRoleDistribution(roles);
  }

  private resolveGeneralByName(generalName: string): GeneralDefinition {
    return resolveGeneralByName(generalName);
  }

  private pickRandomUnusedGeneral(usedGeneralNames: Set<string>): GeneralDefinition {
    return pickRandomUnusedGeneral(usedGeneralNames, this.rng);
  }

  private getAiName(index: number): string {
    return getAiName(index);
  }

  private hasSkill(player: Player, skill: SkillName): boolean {
    return playerHasSkill(player, skill);
  }

  private shouldActivateOptionalEffect(player: Player, effect: SkillName | CardType): Promise<boolean> {
    return playerShouldActivateOptionalEffect(this as unknown as SkillUseContext, player, effect);
  }

  private resetTurnSkillState(playerId: string): void {
    playerResetTurnSkillState(this as unknown as SkillUseContext, playerId);
  }

  private markSkillUsed(playerId: string, skill: SkillName): void {
    playerMarkSkillUsed(this as unknown as SkillUseContext, playerId, skill);
  }

  private isSkillUsed(playerId: string, skill: SkillName): boolean {
    return playerIsSkillUsed(this as unknown as SkillUseContext, playerId, skill);
  }

  private canPlaySlashInTurn(player: Player): boolean {
    return canPlaySlashInTurnImpl(this as unknown as SkillUseContext, player);
  }

  private canUseAssault(player: Player): boolean {
    return canUseAssaultImpl(this as unknown as SkillUseContext, player);
  }

  private getLordWithZhiBa(): Player | null {
    return getLordWithZhiBaImpl(this as unknown as SkillUseContext);
  }

  private canUseZhiBa(player: Player): boolean {
    return canUseZhiBaImpl(this as unknown as SkillUseContext, player);
  }

  private canUseFanJian(player: Player): boolean {
    return canUseFanJianImpl(this as unknown as SkillUseContext, player);
  }

  private canUseZhiHeng(player: Player): boolean {
    return canUseZhiHengImpl(this as unknown as SkillUseContext, player);
  }

  private canUseQingNang(player: Player): boolean {
    return canUseQingNangImpl(this as unknown as SkillUseContext, player);
  }

  private canUseKuRou(player: Player): boolean {
    return canUseKuRouImpl(this as unknown as SkillUseContext, player);
  }

  private canUseRenDe(player: Player): boolean {
    return canUseRenDeImpl(this as unknown as SkillUseContext, player);
  }

  private canUseLiJian(player: Player): boolean {
    return canUseLiJianImpl(this as unknown as SkillUseContext, player);
  }

  private canUseJieYin(player: Player): boolean {
    return canUseJieYinImpl(this as unknown as SkillUseContext, player);
  }

  private async useSkillAction(
    playerId: string,
    action: Extract<GameAction, { type: "skill" }>,
    targetId?: string,
  ): Promise<string[]> {
    return useSkillActionImpl(this as unknown as SkillUseContext, playerId, action, targetId);
  }

  private isSlashCard(cardType: CardType): boolean {
    return isSlashCardImpl(cardType);
  }

  private isEquipCard(cardType: CardType): cardType is EquipCardType {
    return isEquipCardImpl(cardType);
  }

  private isDelayedTrickCard(cardType: CardType): boolean {
    return isDelayedTrickCardImpl(cardType);
  }

  private isNonDelayedTrickCard(cardType: CardType): boolean {
    return isNonDelayedTrickCardImpl(cardType);
  }

  private cardNeedsTarget(cardType: CardType): boolean {
    return cardNeedsTargetImpl(cardType);
  }

  private hasRemovableCard(player: Player): boolean {
    return hasRemovableCard(player);
  }

  private canReachForSlash(attacker: Player, target: Player): boolean {
    return canReachForSlashImpl(this as unknown as ResolveContext, attacker, target);
  }

  private computeDistance(from: Player, to: Player): number {
    return computeDistanceImpl(this as unknown as ResolveContext, from, to);
  }

  private createCard(type: CardType, seed: string): Card {
    return createCardImpl(this as unknown as ResolveContext, type, seed);
  }

  private async removeRandomCardFromPlayer(player: Player, mode: "弃置" | "获得", receiver?: Player): Promise<string[]> {
    return removeRandomCardFromPlayerImpl(this as unknown as ResolveContext, player, mode, receiver);
  }

  private async choosePlayerCard(
    chooser: Player,
    target: Player,
    mode: "弃置" | "获得",
    reason: string,
    allowedZones: RemovableCardOption["zone"][],
    allowPass = true,
  ): Promise<string[]> {
    const options = this.getRemovableCardOptions(target.id).filter((option) => allowedZones.includes(option.zone));
    if (options.length === 0) return [];
    const sources: CardSource[] = options.map((option, index) => ({
      sourceId: option.id,
      origin: "hand",
      card: {
        id: `hidden-choice-${target.id}-${index}`,
        type: option.cardType ?? CardType.Slash,
        color: "colorless",
        suit: "none",
        rank: 0,
      },
      label: option.label,
    }));
    const decision = await this.decide({
      kind: "choose-card",
      requestId: this.nextInteractionId(),
      playerId: chooser.id,
      reason,
      sources,
      count: 1,
      allowPass,
      ...(allowPass ? { passLabel: "不发动" } : {}),
    });
    if (decision.choice !== "card" || !options.some((option) => option.id === decision.sourceId)) return [];
    return removeSelectedCardFromPlayerImpl(
      this as unknown as ResolveContext,
      target,
      mode,
      decision.sourceId,
      mode === "获得" ? chooser : undefined,
    );
  }

  private async moveFieldCardForJieWei(actor: Player): Promise<string[]> {
    const handSources = this.buildUsableSources(actor).filter((source) => source.origin === "hand");
    if (handSources.length === 0) return [];

    const legalDestinations = (holder: Player, option: RemovableCardOption): Player[] => this.players.filter((candidate) => {
      if (!candidate.alive || candidate.id === holder.id) return false;
      if (option.zone === "judgment") {
        return option.cardType !== null && !candidate.delayedTricks.some((trick) => trick.cardType === option.cardType);
      }
      if (option.zone === "hand") return false;
      return this.getEquipmentType(candidate, option.zone) === null;
    });
    const movableOptions = (holder: Player): RemovableCardOption[] => this.getRemovableCardOptions(holder.id)
      .filter((option) => option.zone !== "hand" && legalDestinations(holder, option).length > 0);
    const holders = this.players.filter((candidate) => candidate.alive && movableOptions(candidate).length > 0);
    if (holders.length === 0) return [];

    const holderDecision = await this.decide({
      kind: "collateral",
      requestId: this.nextInteractionId(),
      targetId: actor.id,
      actorId: actor.id,
      victims: holders.map((holder) => holder.id),
      sources: [],
      allowHandOverWeapon: false,
      reason: `${SkillName.JieWei}：选择场上牌的原区域角色`,
    });
    if (holderDecision.choice !== "target") return [];
    const holder = holders.find((candidate) => candidate.id === holderDecision.targetId);
    if (!holder) return [];

    const options = movableOptions(holder);
    const sources: CardSource[] = options.map((option, index) => ({
      sourceId: option.id,
      origin: "hand",
      card: {
        id: `jiewei-field-${holder.id}-${index}`,
        type: option.cardType ?? CardType.Slash,
        color: "colorless",
        suit: "none",
        rank: 0,
      },
      label: option.label,
    }));
    const cardDecision = await this.decide({
      kind: "choose-card",
      requestId: this.nextInteractionId(),
      playerId: actor.id,
      reason: `${SkillName.JieWei}：选择要移动的场上牌`,
      sources,
      count: 1,
      allowPass: true,
      passLabel: "不发动",
    });
    if (cardDecision.choice !== "card") return [];
    const option = options.find((candidate) => candidate.id === cardDecision.sourceId);
    if (!option) return [];

    const destinations = legalDestinations(holder, option);
    const destinationDecision = await this.decide({
      kind: "collateral",
      requestId: this.nextInteractionId(),
      targetId: actor.id,
      actorId: holder.id,
      victims: destinations.map((candidate) => candidate.id),
      sources: [],
      allowHandOverWeapon: false,
      reason: `${SkillName.JieWei}：选择场上牌的新区域角色`,
    });
    if (destinationDecision.choice !== "target") return [];
    const destination = destinations.find((candidate) => candidate.id === destinationDecision.targetId);
    if (!destination) return [];

    const logs: string[] = [];
    const [cost] = await this.requestDiscardSelection(actor, 1, `${SkillName.JieWei}：弃置1张手牌`, handSources, logs);
    if (!cost) return logs;
    this.discardPile.push(cost);
    logs.push(`${actor.name} 发动${SkillName.JieWei}，弃置了${formatCard(cost)}`);

    if (option.zone === "judgment") {
      const delayedId = option.id.slice("delayed:".length);
      const index = holder.delayedTricks.findIndex((trick) => (trick.card?.id ?? trick.cardType) === delayedId);
      const [trick] = index < 0 ? [] : holder.delayedTricks.splice(index, 1);
      if (!trick) return logs;
      destination.delayedTricks.push(trick);
      logs.push(`${actor.name} 将 ${holder.name} 判定区的${trick.cardType}移动至 ${destination.name} 的判定区`);
      return logs;
    }

    if (option.zone === "hand") return logs;
    const zone: EquipmentZone = option.zone;
    const equipType = this.getEquipmentType(holder, zone);
    if (equipType === null) return logs;
    const equipCard = holder.equippedCards?.[zone] ?? this.createCard(equipType, `jiewei-${holder.id}-${zone}`);
    if (holder.equippedCards) delete holder.equippedCards[zone];
    this.clearEquipmentZone(holder, zone);
    const oxCargo = zone === "treasure" ? holder.treasureCards.splice(0) : [];
    logs.push(...(await onLoseEquipImpl(this as unknown as ResolveContext, holder, equipType)));
    logs.push(...(await resolveEquipImpl(this as unknown as ResolveContext, destination, equipCard)));
    if (equipType === CardType.WoodenOx) destination.treasureCards.push(...oxCargo);
    logs.push(`${actor.name} 将 ${holder.name} 的${equipType}移动至 ${destination.name} 的装备区`);
    return logs;
  }

  private obtainDamageCards(player: Player, cards: Card[], logs: string[]): number {
    let obtained = 0;
    for (const card of cards) {
      const index = this.discardPile.findIndex((item) => item.id === card.id);
      if (index < 0) continue;
      const [moved] = this.discardPile.splice(index, 1);
      if (!moved) continue;
      player.hand.push(moved);
      obtained += 1;
      logs.push(`${player.name} 获得造成伤害的 ${formatCard(moved)}`);
    }
    return obtained;
  }

  private async expandSlashTargets(player: Player, primary: Player, isLastHandSlash: boolean): Promise<Player[]> {
    return expandSlashTargetsImpl(this as unknown as ResolveContext, player, primary, isLastHandSlash);
  }

  private resolveSlash(
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
    return resolveSlashImpl(
      this as unknown as ResolveContext,
      attacker,
      target,
      fromSerpent,
      fire,
      slashColor,
      thunder,
      damageBonus,
      damageCards,
      triggerAttackerSkill,
    );
  }

  private resolveProvidedSlash(attacker: Player, target: Player, cards: Card[]): Promise<string[]> {
    const card = cards[0];
    const color = cards.length > 0 && cards.every((candidate) => candidate.color === card?.color)
      ? card?.color ?? "colorless"
      : "colorless";
    return resolveSlashImpl(
      this as unknown as ResolveContext,
      attacker,
      target,
      false,
      cards.length === 1 && card?.type === CardType.FireSlash,
      color,
      cards.length === 1 && card?.type === CardType.ThunderSlash,
      this.consumeWineSlashBonus(attacker.id),
      cards,
    );
  }

  private consumeSlashResponse(
    player: Player,
    trigger: { cardName: string; actorId: string },
    logs: string[],
  ): Promise<boolean> {
    return consumeSlashResponseImpl(this as unknown as ResolveContext, player, trigger, logs);
  }

  private resolveDismantle(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    return resolveDismantleImpl(this as unknown as ResolveContext, user, target, selectedCardId);
  }

  private resolveSnatch(user: Player, target: Player, selectedCardId?: string): Promise<string[]> {
    return resolveSnatchImpl(this as unknown as ResolveContext, user, target, selectedCardId);
  }

  private resolveDuel(
    user: Player,
    target: Player,
    options: { skipNegate?: boolean; damageCards?: Card[] } = {},
  ): Promise<string[]> {
    return resolveDuelImpl(this as unknown as ResolveContext, user, target, options);
  }

  private resolveBarbarian(user: Player, damageCards: Card[] = []): Promise<string[]> {
    return resolveBarbarianImpl(this as unknown as ResolveContext, user, damageCards);
  }

  private resolveArrowRain(user: Player, damageCards: Card[] = []): Promise<string[]> {
    return resolveArrowRainImpl(this as unknown as ResolveContext, user, damageCards);
  }

  private resolveCollateral(user: Player, target: Player): Promise<string[]> {
    return resolveCollateralImpl(this as unknown as ResolveContext, user, target);
  }

  private resolveDelayedTrick(user: Player, usedCard: Card, targetId: string): Promise<string[]> {
    return resolveDelayedTrickImpl(this as unknown as ResolveContext, user, usedCard, targetId);
  }

  private resolveDelayedJudgments(player: Player): Promise<string[]> {
    return resolveDelayedJudgmentsImpl(this as unknown as ResolveContext, player);
  }

  private resolveSingleDelayedJudgment(player: Player, index: number): Promise<string[]> {
    return resolveSingleDelayedJudgmentImpl(this as unknown as ResolveContext, player, index);
  }

  private resolvePeachGarden(user: Player): Promise<string[]> {
    return resolvePeachGardenImpl(this as unknown as ResolveContext, user);
  }

  private resolveHarvest(user: Player): Promise<string[]> {
    return resolveHarvestImpl(this as unknown as ResolveContext, user);
  }

  private resolveEquip(user: Player, equipCard: Card): Promise<string[]> {
    return resolveEquipImpl(this as unknown as ResolveContext, user, equipCard);
  }

  private resolveDeaths(): Promise<string[]> {
    return resolveDeathsImpl(this as unknown as ResolveContext);
  }

  private resolveWinner(): string[] {
    return resolveWinnerImpl(this as unknown as ResolveContext);
  }

  private get currentPlayer(): Player {
    const player = this.players[this.currentPlayerIndex];
    if (!player) {
      throw new Error("current player missing");
    }
    return player;
  }
}
