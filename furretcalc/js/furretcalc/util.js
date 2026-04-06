export const NO_MOVE = "NO_MOVE"

export function int_divide(numerator, denominator) {
    if(!isFinite(numerator) || !isFinite(denominator)) {
        throw new Error(`int_divide with non-finite numbers ${numerator} / ${denominator}`)
    }
    return Math.floor(numerator / denominator)
}

export const DamageCategory = Object.freeze({
    PHYSICAL: "Physical",
    SPECIAL: "Special"
})

export const Type = Object.freeze({
    NORMAL: "Normal",
    FIGHTING: "Fighting",
    FLYING: "Flying",
    POISON: "Poison",
    GROUND: "Ground",
    ROCK: "Rock",
    BIRD: "Bird",
    BUG: "Bug",
    GHOST: "Ghost",
    STEEL: "Steel",
    CURSE: "???",
    FIRE: "Fire",
    WATER: "Water",
    GRASS: "Grass",
    ELECTRIC: "Electric",
    PSYCHIC: "Psychic",
    ICE: "Ice",
    DRAGON: "Dragon",
    DARK: "Dark",
})

export const Weather = Object.freeze({
    CLEAR: "Clear",
    SUN: "Sun",
    RAIN: "Rain",
    SANDSTORM: "Sandstorm",
    HAIL: "Hail"
})

export const StatusCondition = Object.freeze({
    PARALYZE: "PRZ",
    FREEZE: "FRZ",
    BURN: "BRN",
    SLEEP: "SLP",
    POISON: "PSN"
})

const ALL_TYPES = Object.values(Type);
const FIRST_SPECIAL_TYPE_INDEX = ALL_TYPES.indexOf(Type.FIRE)

/**
 * Get the damage category of the given type.
 * @param {Type} type
 * @returns {DamageCategory}
 */
export function damage_category_of_type(type) {
    return ALL_TYPES.indexOf(type) < FIRST_SPECIAL_TYPE_INDEX ? DamageCategory.PHYSICAL : DamageCategory.SPECIAL
}

export const MODIFIER_FOR_STAT = Object.freeze({
    [-6]: [25, 100],
    [-5]: [28, 100],
    [-4]: [33, 100],
    [-3]: [40, 100],
    [-2]: [50, 100],
    [-1]: [66, 100],
    [0]: [100, 100],
    [+1]: [150, 100],
    [+2]: [200, 100],
    [+3]: [250, 100],
    [+4]: [300, 100],
    [+5]: [350, 100],
    [+6]: [400, 100],
})

/**
 * Calculate the stat.
 * @param {number} stat
 * @param {boolean} badge_boost
 * @param {number} stage
 * @returns
 */
export function calculate_stat(stat, badge_boost, stage) {
    const [num, den] = MODIFIER_FOR_STAT[stage]
    stat = int_divide(stat * num, den)

    if(stat < 1) {
        stat = 1;
    }

    if(badge_boost) {
        stat += int_divide(stat, 8)
    }

    if(stat > 999) {
        stat = 999
    }

    return stat
}

export const Game = Object.freeze({
    RedBlue: "Red/Blue",
    Yellow: "Yellow",
    GoldSilver: "Gold/Silver",
    Crystal: "Crystal"
})

export const Generation = Object.freeze({
    Gen1: 1,
    Gen2: 2
})

export function generation_of_game(game) {
    switch(game) {
        case Game.RedBlue:
        case Game.Yellow:
            return Generation.Gen1
        case Game.Crystal:
        case Game.GoldSilver:
            return Generation.Gen2
        default:
            throw new Error(`generation_of_game - unknown game ${game}`)
    }
}

export function unreachable() {
    throw new Error("Unreachable error reached!")
}

export function calculate_monster_stats(level, base_stats, dvs, statexp = null) {
    const hp_dv = calculate_hp_dv(dvs)
    return {
        "hp": calculate_hp_stat(level, base_stats["hp"], hp_dv, statexp?.hp ?? 0),
        "attack": calculate_non_hp_stat(level, base_stats["attack"], dvs.attack, statexp?.attack ?? 0),
        "defense": calculate_non_hp_stat(level, base_stats["defense"], dvs.defense, statexp?.defense ?? 0),
        "special_attack": calculate_non_hp_stat(level, base_stats["special_attack"], dvs.special, statexp?.special ?? 0),
        "special_defense": calculate_non_hp_stat(level, base_stats["special_defense"], dvs.special, statexp?.special ?? 0),
        "speed": calculate_non_hp_stat(level, base_stats["speed"], dvs.speed, statexp?.speed ?? 0)
    }
}

export function calculate_hp_stat(level, base, dv, statexp) {
    return int_divide(((base + dv) * 2 + calculate_statexp_part(statexp)) * level, 100) + 10 + level
}

export function calculate_non_hp_stat(level, base, dv, statexp) {
    return int_divide(((base + dv) * 2 + calculate_statexp_part(statexp)) * level, 100) + 5
}

export function calculate_statexp_part(statexp) {
    const sqrt = Math.ceil(Math.sqrt(statexp))
    return Math.floor(Math.min(sqrt, 255) / 4)
}

export function calculate_hp_dv(dvs) {
    let hp = 0
    if((dvs.attack & 1) === 1) {
        hp += 8
    }
    if((dvs.defense & 1) === 1) {
        hp += 4
    }
    if((dvs.speed & 1) === 1) {
        hp += 2
    }
    if((dvs.special & 1) === 1) {
        hp += 1
    }
    return hp
}

export function get_hidden_power_stats({attack, defense, special, speed}) {
    const mask = 0b1000

    const base_power = 31 + int_divide(
        (((attack & mask) * 40 + (defense & mask) * 20 + (speed & mask) * 10 + (special & mask) * 5) >> 3)
        + (special & 0b11), 2)

    const type = HIDDEN_POWER_TYPE_TABLE[((attack & 0b11) << 2) | (defense & 0b11)]

    return { base_power, type }
}

const HIDDEN_POWER_TYPE_TABLE = Object.freeze([
    Type.FIGHTING,
    Type.FLYING,
    Type.POISON,
    Type.GROUND,
    Type.ROCK,
    Type.BUG,
    Type.GHOST,
    Type.STEEL,
    Type.FIRE,
    Type.WATER,
    Type.GRASS,
    Type.ELECTRIC,
    Type.PSYCHIC,
    Type.ICE,
    Type.DRAGON,
    Type.DARK
])
