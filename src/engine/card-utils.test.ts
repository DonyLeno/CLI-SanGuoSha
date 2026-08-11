import assert from "node:assert/strict";
import { test } from "node:test";
import { CardType } from "./cards.js";
import { actionRequiresTargetCardSelection } from "./card-utils.js";
import { GameAction, SkillName } from "./types.js";

const targetedPlay = (label: string): GameAction => ({
  type: "play",
  cardIndex: 0,
  label,
  requiresTarget: true,
  targets: ["target"],
});

void test("只有过河拆桥和顺手牵羊类动作需要预先选择目标区域的牌", () => {
  assert.equal(actionRequiresTargetCardSelection(targetedPlay(`使用 ${CardType.Dismantle}`)), true);
  assert.equal(actionRequiresTargetCardSelection(targetedPlay(`使用 ${CardType.Snatch}`)), true);
  assert.equal(
    actionRequiresTargetCardSelection(targetedPlay(`使用 ${SkillName.QiXi}（将♣10 ${CardType.IronChain}当${CardType.Dismantle}）`)),
    true,
  );
  assert.equal(actionRequiresTargetCardSelection(targetedPlay(`使用 ${CardType.IronChain}`)), false);
  assert.equal(actionRequiresTargetCardSelection(targetedPlay(`使用 ${CardType.Duel}`)), false);
  assert.equal(
    actionRequiresTargetCardSelection(targetedPlay(`使用 ${SkillName.GuoSe}（将♦3 ${CardType.Snatch}当${CardType.Indulgence}）`)),
    false,
  );
  assert.equal(
    actionRequiresTargetCardSelection(targetedPlay(`使用 ${SkillName.WuSheng}（将♥Q ${CardType.Dismantle}当${CardType.Slash}）`)),
    false,
  );
});
