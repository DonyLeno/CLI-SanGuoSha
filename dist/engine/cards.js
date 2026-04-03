export var CardType;
(function (CardType) {
    CardType["Slash"] = "\u6740";
    CardType["Dodge"] = "\u95EA";
    CardType["Peach"] = "\u6843";
    CardType["Dismantle"] = "\u8FC7\u6CB3\u62C6\u6865";
})(CardType || (CardType = {}));
const deckPattern = [
    ...Array(18).fill(CardType.Slash),
    ...Array(12).fill(CardType.Dodge),
    ...Array(8).fill(CardType.Peach),
    ...Array(6).fill(CardType.Dismantle),
];
export const createDeck = () => deckPattern.map((type, index) => ({
    id: `${type}-${index + 1}`,
    type,
}));
export const shuffle = (items, rng) => {
    const copied = [...items];
    for (let i = copied.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const current = copied[i];
        const target = copied[j];
        if (current === undefined || target === undefined) {
            continue;
        }
        copied[i] = target;
        copied[j] = current;
    }
    return copied;
};
