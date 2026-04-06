import {calculate_hp_dv, calculate_monster_stats, int_divide, Type, Weather, NO_MOVE, Generation} from "../util.js"

let moves_json = null

let crystal_parties_json = null
let goldsilver_parties_json = null

let crystal_pokemon_json = null
let goldsilver_pokemon_json = null

let items_json = null
let item_groups = null

export async function load_gen2(base_url) {
    const moves = await (await fetch(`${base_url}/gen2/data/moves.json`)).text()
    const moves_json_parsed = JSON.parse(moves)
    for(const [k,v] of Object.entries(moves_json_parsed)) {
        v.accuracy_out_of_256 = int_divide(v.accuracy * 255, 100)
        v.effect_chance_out_of_256 = int_divide(v.effect_chance * 255, 100)
        moves_json_parsed[k] = Object.freeze(v)
    }

    crystal_pokemon_json = await get_pokemon(`${base_url}/gen2/data/pokemon_crystal.json`)
    goldsilver_pokemon_json = await get_pokemon(`${base_url}/gen2/data/pokemon_goldsilver.json`)

    crystal_parties_json = await get_parties(`${base_url}/gen2/data/parties_crystal.json`, crystal_pokemon_json)
    goldsilver_parties_json = await get_parties(`${base_url}/gen2/data/parties_goldsilver.json`, goldsilver_pokemon_json)

    moves_json = Object.freeze(moves_json_parsed)

    const items = await (await fetch(`${base_url}/gen2/data/items.json`)).text()
    items_json = Object.freeze(JSON.parse(items))

    item_groups = {}

    for(const k of Object.keys(items_json).sort()) {
        for(const [ki, vi] of Object.entries(ITEM_GROUPS_DEFINITION)) {
            if(item_groups[ki] == null) {
                item_groups[ki] = []
            }

            if(vi.includes(items_json[k].effect) || vi.includes(k)) {
                item_groups[ki].push(k)
            }
        }
    }
}

export function calculate_max_damage(move_data, attacker, stats, is_crit, move_type, defender, weather) {
    if(move_data.effect === "EFFECT_OHKO") {
        // OHKO moves just check type effectiveness without doing any other damage calculation
        if(apply_defensive_type_effectiveness(move_data, 1, defender) > 0) {
            return 65535
        }
        else {
            return 0
        }
    }

    let total_damage = calculate_damage_subtotal(move_data, attacker, stats, is_crit)
    if(total_damage === 0) {
        return 0
    }

    return apply_type_effectiveness(move_type, total_damage, move_data, attacker, defender, weather)
}

export const EFFECT_TO_TYPE_BOOST = Object.freeze({
    "HELD_NORMAL_BOOST": Type.NORMAL,
    "HELD_FIGHTING_BOOST": Type.FIGHTING,
    "HELD_FLYING_BOOST": Type.FLYING,
    "HELD_POISON_BOOST": Type.POISON,
    "HELD_GROUND_BOOST": Type.GROUND,
    "HELD_ROCK_BOOST": Type.ROCK,
    "HELD_BUG_BOOST": Type.BUG,
    "HELD_GHOST_BOOST": Type.GHOST,
    "HELD_FIRE_BOOST": Type.FIRE,
    "HELD_WATER_BOOST": Type.WATER,
    "HELD_GRASS_BOOST": Type.GRASS,
    "HELD_ELECTRIC_BOOST": Type.ELECTRIC,
    "HELD_PSYCHIC_BOOST": Type.PSYCHIC,
    "HELD_ICE_BOOST": Type.ICE,
    "HELD_DRAGON_BOOST": Type.DRAGON,
    "HELD_DARK_BOOST": Type.DARK,
    "HELD_STEEL_BOOST": Type.STEEL,
})

const ITEM_GROUPS_DEFINITION = Object.freeze({
    "Type-Based Boosts": Object.freeze(Object.keys(EFFECT_TO_TYPE_BOOST)),
    "Broken Items": [
        "Dragon Fang"
    ]
})

export function calculate_damage_subtotal(move_data, attacker, stats, is_crit) {
    let level = attacker.data.level & 255

    if(move_data.base_power === 0 && move_data.effect !== "EFFECT_MULTI_HIT" && move_data.effect !== "EFFECT_CONVERSION") {
        return 0
    }

    const attack = stats.attack & 65535
    let defense = stats.defense & 65535

    if(move_data.effect === "EFFECT_SELFDESTRUCT") {
        defense = int_divide(defense, 2) // (effectively doubles base power)
    }

    defense = Math.max(defense, 1) // prevent division by 0

    const total_power = (int_divide(2 * (level & 255), 5) + 2) * move_data.base_power * attack
    let total_damage = int_divide(int_divide(total_power, defense), 50)

    const item = items_json[attacker.data.item]
    if(item != null && EFFECT_TO_TYPE_BOOST[item.effect] === move_data.type) {
        total_damage = int_divide(total_damage * (100 + item.parameter), 100)
    }

    // prevent dealing more than 999 damage
    if(total_damage > 997) {
        total_damage = 997
    }

    if(is_crit) {
        total_damage *= 2
    }

    // Yes, the game caps crit damage at 65535.
    // Yes, the maximum it could *actually* reach at this point is 1998.
    // Yes, it's Gen 2.
    // ...
    // Okay, carry on.
    if(total_damage > 65535) {
        return 65535
    }

    return total_damage + 2
}

export function get_moves() {
    if(moves_json == null) {
        throw new Error("Not loaded!")
    }
    return moves_json
}

export function get_crystal_pokemon() {
    if(crystal_pokemon_json == null) {
        throw new Error("Not loaded!")
    }
    return crystal_pokemon_json
}

export function get_gold_pokemon() {
    if(goldsilver_pokemon_json == null) {
        throw new Error("Not loaded!")
    }
    return goldsilver_pokemon_json
}

export function get_crystal_parties() {
    if(crystal_parties_json == null) {
        throw new Error("Not loaded!")
    }
    return crystal_parties_json
}

export function get_supported_items() {
    if(item_groups == null) {
        throw new Error("Not loaded!")
    }
    return item_groups
}

export function get_gold_parties() {
    if(goldsilver_parties_json == null) {
        throw new Error("Not loaded!")
    }
    return goldsilver_parties_json
}

export function get_items() {
    if(items_json == null) {
        throw new Error("Not loaded!")
    }
    return items_json
}

async function get_pokemon(url) {
    const pokemon_data = JSON.parse(await (await fetch(url)).text())

    for(const [k,v] of Object.entries(pokemon_data)) {
        if(v.types[1] === v.types[0]) {
            v.types = Object.freeze([v.types[0]])
        }
        else {
            v.types = Object.freeze(v.types)
        }

        const [hp, atk, def, spe, spa, spd] = v.base_stats

        v.base_stats = Object.freeze({
            "hp": hp,
            "attack": atk,
            "defense": def,
            "special_attack": spa,
            "special_defense": spd,
            "speed": spe
        })

        for(const [mi, m] of Object.entries(v.level_up_moves)) {
            v.level_up_moves[mi] = Object.freeze(m)
        }

        v.level_up_moves = Object.freeze(v.level_up_moves)

        pokemon_data[k] = Object.freeze(v)
    }

    return Object.freeze(pokemon_data)
}

export const MODIFIER_FOR_ACCURACY = Object.freeze({
    [-6]: [33, 100],
    [-5]: [36, 100],
    [-4]: [43, 100],
    [-3]: [50, 100],
    [-2]: [60, 100],
    [-1]: [75, 100],
    [0]: [1, 1],
    [1]: [133, 100],
    [2]: [166, 100],
    [3]: [2, 1],
    [4]: [233, 100],
    [5]: [133, 50],
    [6]: [3, 1]
})

async function get_parties(url, pokemon) {
    const parties_data = JSON.parse(await (await fetch(url)).text())

    for(const [k,v] of Object.entries(parties_data)) {
        if(v.trainers.length === 0) {
            delete parties_data[k]
        }
    }

    for(const [k,v] of Object.entries(parties_data)) {
        const [atk_dv, def_dev, spd_dv, spc_dv] = v.dvs

        v.dvs = {
            attack: atk_dv,
            defense: def_dev,
            special: spc_dv,
            speed: spd_dv
        }

        v.dvs.hp = calculate_hp_dv(v.dvs)
        v.dvs = Object.freeze(v.dvs)

        for(const [tk,trainer] of Object.entries(v.trainers)) {
            for(const [pk,monster] of Object.entries(trainer.party)) {
                const matched_monster = pokemon[monster.species]
                if(matched_monster == null) {
                    throw new Error(`No species ${monster.species} found!`)
                }

                if(monster.moves == null) {
                    const current_moveset = []

                    for(const l of matched_monster.level_up_moves) {
                        if(current_moveset.includes(l.move)) {
                            continue
                        }
                        if(l.level <= monster.level) {
                            current_moveset.push(l.move)
                        }
                    }

                    while(current_moveset.length < 4) {
                        current_moveset.push(NO_MOVE)
                    }

                    if(current_moveset.length > 4) {
                        current_moveset.splice(0, current_moveset.length - 4)
                    }

                    if(current_moveset[0] === NO_MOVE) {
                        throw new Error(`Trainer ${trainer.name} is missing a move for #${pk}!`)
                    }

                    monster.moves = Object.freeze(current_moveset)
                }
                else {
                    monster.moves = Object.freeze(monster.moves)
                }

                monster.stats = calculate_monster_stats(monster.level, matched_monster.base_stats, v.dvs, null)

                trainer.party[pk] = Object.freeze(monster)
            }

            v.trainers[tk] = Object.freeze(trainer)
        }

        parties_data[k] = Object.freeze(v)
    }

    return Object.freeze(parties_data)
}

export function apply_type_effectiveness(move_type, total_damage, move_data, attacker, defender, weather) {
    if(move_type === "STRUGGLE") {
        // struggle skips this whole function (this is not part of its move effect; the game's just hardcoded)
        return total_damage
    }

    // Some effects also simply don't call this
    switch(move_data.effect) {
        case "EFFECT_FUTURE_SIGHT": return total_damage
        case "EFFECT_BEAT_UP": return total_damage
    }

    switch(move_data.type) {
        case "Fire": {
            switch(weather) {
                case Weather.SUN: total_damage += int_divide(total_damage, 2); break
                case Weather.RAIN: total_damage = Math.max(int_divide(total_damage, 2), 1); break
            }
            break
        }
        case "Water": {
            switch(weather) {
                case Weather.RAIN: total_damage += int_divide(total_damage, 2); break
                case Weather.SUN: total_damage = Math.max(int_divide(total_damage, 2), 1); break
            }
            break
        }
    }

    // Solarbeam's damage is also halved in the rain; this is applied after type-based modifiers
    if(move_data.effect === "EFFECT_SOLARBEAM" && weather === Weather.RAIN) {
        total_damage = Math.max(int_divide(total_damage, 2), 1)
    }

    total_damage = total_damage & 65535

    const badge_boost_index = TypeBadgeBoostIndex[move_data.type]
    if(badge_boost_index != null && attacker.badges?.[badge_boost_index]) {
        total_damage = Math.min(total_damage + int_divide(total_damage, 8), 65535)
    }

    if(attacker.data.types.includes(move_data.type)) {
        total_damage = (total_damage + int_divide(total_damage, 2)) & 65535
    }

    total_damage = apply_defensive_type_effectiveness(move_data, total_damage, defender)

    return total_damage
}

function apply_defensive_type_effectiveness(move_data, total_damage, defender) {
    for(const t of defender.data.types) {
        const type_effectiveness = TYPE_EFFECTIVENESS[t]
        if(type_effectiveness == null) {
            continue
        }
        if(type_effectiveness.immunities?.includes(move_data.type)) {
            return 0
        }
        if(type_effectiveness.weaknesses?.includes(move_data.type)) {
            total_damage = Math.max(int_divide(total_damage * 20, 10), 1) & 65535
        }
        if(type_effectiveness.resistances?.includes(move_data.type)) {
            total_damage = Math.max(int_divide(total_damage * 5, 10), 1) & 65535
        }
    }
    return total_damage
}

export const TYPE_EFFECTIVENESS = {
    [Type.NORMAL]: {
        "weaknesses": [Type.FIGHTING],
        "resistances": [],
        "immunities": [Type.GHOST]
    },
    [Type.FIGHTING]: {
        "weaknesses": [Type.FLYING, Type.PSYCHIC],
        "resistances": [Type.DARK, Type.BUG, Type.ROCK],
        "immunities": []
    },
    [Type.FLYING]: {
        "weaknesses": [Type.ICE, Type.ROCK, Type.ELECTRIC],
        "resistances": [Type.FIGHTING, Type.BUG, Type.GRASS],
        "immunities": [Type.GROUND]
    },
    [Type.POISON]: {
        "weaknesses": [Type.GROUND, Type.PSYCHIC],
        "resistances": [Type.POISON, Type.BUG, Type.GRASS, Type.FIGHTING],
        "immunities": []
    },
    [Type.GROUND]: {
        "weaknesses": [Type.ICE, Type.WATER, Type.GRASS],
        "resistances": [Type.ROCK, Type.POISON],
        "immunities": [Type.ELECTRIC]
    },
    [Type.ROCK]: {
        "weaknesses": [Type.GROUND, Type.FIGHTING, Type.WATER, Type.GRASS, Type.STEEL],
        "resistances": [Type.NORMAL, Type.FLYING, Type.POISON, Type.FIRE],
        "immunities": []
    },
    [Type.BIRD]: {
        "weaknesses": [],
        "resistances": [],
        "immunities": []
    },
    [Type.BUG]: {
        "weaknesses": [Type.FIRE, Type.FLYING, Type.ROCK],
        "resistances": [Type.GRASS, Type.FIGHTING, Type.GROUND],
        "immunities": []
    },
    [Type.GHOST]: {
        "weaknesses": [Type.GHOST, Type.DARK],
        "resistances": [Type.POISON, Type.BUG],
        "immunities": [Type.NORMAL, Type.PSYCHIC]
    },
    [Type.STEEL]: {
        "weaknesses": [Type.FIGHTING, Type.GROUND, Type.FIRE],
        "resistances": [Type.NORMAL, Type.FLYING, Type.ROCK, Type.BUG, Type.STEEL, Type.GRASS, Type.PSYCHIC, Type.ICE, Type.DRAGON, Type.DARK, Type.GHOST],
        "immunities": [Type.POISON]
    },
    [Type.CURSE]: {
        "weaknesses": [],
        "resistances": [],
        "immunities": []
    },
    [Type.FIRE]: {
        "weaknesses": [Type.WATER, Type.GROUND, Type.ROCK],
        "resistances": [Type.GRASS, Type.FIRE, Type.BUG, Type.STEEL, Type.ICE],
        "immunities": []
    },
    [Type.WATER]: {
        "weaknesses": [Type.ELECTRIC, Type.GRASS],
        "resistances": [Type.WATER, Type.FIRE, Type.STEEL, Type.ICE],
        "immunities": []
    },
    [Type.GRASS]: {
        "weaknesses": [Type.FIRE, Type.POISON, Type.BUG, Type.ICE, Type.FLYING],
        "resistances": [Type.GRASS, Type.WATER, Type.GROUND, Type.ELECTRIC],
        "immunities": []
    },
    [Type.ELECTRIC]: {
        "weaknesses": [Type.GROUND],
        "resistances": [Type.STEEL, Type.ELECTRIC, Type.FLYING],
        "immunities": []
    },
    [Type.PSYCHIC]: {
        "weaknesses": [Type.DARK, Type.GHOST, Type.BUG],
        "resistances": [Type.PSYCHIC, Type.FIGHTING],
        "immunities": []
    },
    [Type.ICE]: {
        "weaknesses": [Type.FIRE, Type.ROCK, Type.FIGHTING, Type.STEEL],
        "resistances": [Type.ICE],
        "immunities": []
    },
    [Type.DRAGON]: {
        "weaknesses": [Type.ICE, Type.DRAGON],
        "resistances": [Type.ELECTRIC, Type.FIRE, Type.WATER, Type.GRASS],
        "immunities": []
    },
    [Type.DARK]: {
        "weaknesses": [Type.FIGHTING, Type.BUG],
        "resistances": [Type.DARK, Type.GHOST],
        "immunities": [Type.PSYCHIC]
    },
}

export const TypeBadgeBoostIndex = Object.freeze({
    [Type.FLYING]: 0,
    [Type.BUG]: 1,
    [Type.NORMAL]: 2,
    [Type.GHOST]: 3,
    [Type.FIGHTING]: 4,
    [Type.STEEL]: 5,
    [Type.ICE]: 6,
    [Type.DRAGON]: 7,
    [Type.ROCK]: 8,
    [Type.WATER]: 9,
    [Type.ELECTRIC]: 10,
    [Type.GRASS]: 11,
    [Type.POISON]: 12,
    [Type.PSYCHIC]: 13,
    [Type.FIRE]: 14,
    [Type.GROUND]: 15
})

export const StatBadgeBoostIndex = Object.freeze({
    Attack: 0,
    Defense: 5,
    // bug: does not always apply special defense
    Special: 6,
    Speed: 2
})

const BADGES = Object.freeze({
    "Johto": Object.freeze([
        "Falkner",
        "Bugsy",
        "Whitney",
        "Morty",
        "Chuck",
        "Jasmine",
        "Pryce",
        "Clair"
    ]),
    "Kanto": Object.freeze([
        "Brock",
        "Misty",
        "Lt. Surge",
        "Erika",
        "Janine",
        "Sabrina",
        "Blaine",
        "Blue"
    ])
})
export function get_badge_list() {
    return BADGES
}
