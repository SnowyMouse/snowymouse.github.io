"use strict"

const NO_MOVE = "NO_MOVE"

let moves_json = null

let crystal_parties_json = null
let goldsilver_parties_json = null

let crystal_pokemon_json = null
let goldsilver_pokemon_json = null

let loaded = null

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

export function get_gold_parties() {
    if(goldsilver_parties_json == null) {
        throw new Error("Not loaded!")
    }
    return goldsilver_parties_json
}

export async function load_furretcalc(base_url) {
    if(loaded) {
        return loaded
    }

    loaded = new Promise((resolve, reject) => {
        async function load_moves() {
            try {
                const moves = await (await fetch(`${base_url}/data/moves.json`)).text()
                const moves_json_parsed = JSON.parse(moves)
                for(const [k,v] of Object.entries(moves_json_parsed)) {
                    v.accuracy_out_of_256 = int_divide(v.accuracy * 255, 100)
                    v.effect_chance_out_of_256 = int_divide(v.effect_chance * 255, 100)
                    moves_json_parsed[k] = Object.freeze(v)
                }

                crystal_pokemon_json = await get_pokemon(`${base_url}/data/pokemon_crystal.json`)
                goldsilver_pokemon_json = await get_pokemon(`${base_url}/data/pokemon_goldsilver.json`)

                crystal_parties_json = await get_parties(`${base_url}/data/parties_crystal.json`, crystal_pokemon_json)
                goldsilver_parties_json = await get_parties(`${base_url}/data/parties_goldsilver.json`, goldsilver_pokemon_json)

                moves_json = Object.freeze(moves_json_parsed)
                resolve()
            }
            catch (e) {
                reject(e)
            }
        }
        load_moves()
    })

    return loaded
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

async function get_parties(url, pokemon) {
    const parties_data = JSON.parse(await (await fetch(url)).text())

    for(const [k,v] of Object.entries(parties_data)) {
        if(v.trainers.length === 0) {
            delete parties_data[k]
        }
    }

    window.generate_hp_dv = generate_hp_dv

    for(const [k,v] of Object.entries(parties_data)) {
        const [atk_dv, def_dev, spd_dv, spc_dv] = v.dvs

        v.dvs = Object.freeze({
            attack: atk_dv,
            defense: def_dev,
            special: spc_dv,
            speed: spd_dv
        })

        const hp_dv = generate_hp_dv(v.dvs)

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

                    while(current_moveset.length > 4) {
                        current_moveset.splice(0)
                    }

                    if(current_moveset[0] === NO_MOVE) {
                        throw new Error(`Trainer ${trainer.name} is missing a move for #${pk}!`)
                    }

                    monster.moves = Object.freeze(current_moveset)
                }
                else {
                    monster.moves = Object.freeze(monster.moves)
                }

                monster.stats = Object.freeze({
                    "hp": calculate_hp_stat(monster.level, matched_monster.base_stats["hp"], hp_dv),
                    "attack": calculate_non_hp_stat(monster.level, matched_monster.base_stats["attack"], v.dvs.attack),
                    "defense": calculate_non_hp_stat(monster.level, matched_monster.base_stats["defense"], v.dvs.defense),
                    "special_attack": calculate_non_hp_stat(monster.level, matched_monster.base_stats["special_attack"], v.dvs.special),
                    "special_defense": calculate_non_hp_stat(monster.level, matched_monster.base_stats["special_defense"], v.dvs.special),
                    "speed": calculate_non_hp_stat(monster.level, matched_monster.base_stats["speed"], v.dvs.speed)
                })

                trainer.party[pk] = Object.freeze(monster)
            }

            v.trainers[tk] = Object.freeze(trainer)
        }

        parties_data[k] = Object.freeze(v)
    }

    return Object.freeze(parties_data)
}

function calculate_hp_stat(level, base, dv) {
    return int_divide(((base + dv) * 2) * level, 100) + 10 + level
}

function calculate_non_hp_stat(level, base, dv) {
    return int_divide(((base + dv) * 2) * level, 100) + 5
}

function generate_hp_dv(dvs) {
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

export async function wait_loaded() {
    if(loaded == null) {
        throw new Error("loading not triggered!")
    }
    await loaded
}

export function calculate_battle_stats(out_of_battle_stats, badges, stages, status) {
    let { hp, attack, defense, special_attack, special_defense, speed } = out_of_battle_stats
    
    switch(status) {
        case "burned": attack = int_divide(attack, 2); break;
        case "paralyzed": speed = int_divide(speed, 4); break;
    }

    const attack_boost = badges?.[0] ?? false
    const defense_boost = badges?.[5] ?? false
    const special_attack_boost = badges?.[6] ?? false
    const special_defense_boost = special_attack_boost && ((special_attack >= 206 && special_attack <= 432) || (special_attack >= 661)) // gen 2 is great
    const speed_boost = badges?.[2] ?? false

    return {
        hp: hp < 1 ? 1 : hp,
        attack: calculate_stat(attack, attack_boost, stages.attack),
        defense: calculate_stat(defense, defense_boost, stages.defense),
        special_attack: calculate_stat(special_attack, special_attack_boost, stages.special_attack),
        special_defense: calculate_stat(special_defense, special_defense_boost, stages.special_defense),
        speed: calculate_stat(speed, speed_boost, stages.speed),
    }
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
    SUN: "sun",
    RAIN: "rain"
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

function int_divide(numerator, denominator) {
    if(!isFinite(numerator) || !isFinite(denominator)) {
        throw new Error(`int_divide with non-finite numbers ${numerator} / ${denominator}`)
    }
    return Math.floor(numerator / denominator)
}

/**
 * Calculate the stat.
 * @param {number} stat 
 * @param {boolean} badge_boost 
 * @param {number} stage 
 * @returns 
 */
function calculate_stat(stat, badge_boost, stage) {
    switch(stage) {
        case -6: stat = int_divide(stat * 25, 100); break;
        case -5: stat = int_divide(stat * 28, 100); break;
        case -4: stat = int_divide(stat * 33, 100); break;
        case -3: stat = int_divide(stat * 40, 100); break;
        case -2: stat = int_divide(stat * 50, 100); break;
        case -1: stat = int_divide(stat * 66, 100); break;
        case 0:  break;
        case +1: stat = int_divide(stat * 150, 100); break;
        case +2: stat = int_divide(stat * 200, 100); break;
        case +3: stat = int_divide(stat * 250, 100); break;
        case +4: stat = int_divide(stat * 300, 100); break;
        case +5: stat = int_divide(stat * 350, 100); break;
        case +6: stat = int_divide(stat * 400, 100); break;
    }

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

export function calculate_damage_for_all_moves(attacker, defender, warnings, properties) {
    const results = []

    for(const c of attacker.data.moves) {
        if(c === NO_MOVE) {
            results.push(null)
        }
        else {
            results.push(calculate_damage_for_move(c, moves_json[c], attacker, defender, warnings, properties))
        }
    }

    return results
}

const MIN_ROLL = 217
const MAX_ROLL = 255

function calculate_damage_for_move(move_type, move_data_original, attacker, defender, warnings, { per_hit, weather, max_rolls, max_turns, cutoff }) {
    const move_data = { ...move_data_original }
    apply_move_modifications(move_data, attacker)

    if(move_data.base_power === 0) {
        return null
    }

    const [noncrit_stats, crit_stats] = get_attack_and_defense_stat(move_data, attacker, defender)

    const noncrit_damage = calculate_max_damage_for_move_with_stats(move_type, move_data, attacker, defender, noncrit_stats, false, weather)
    const crit_damage = calculate_max_damage_for_move_with_stats(move_type, move_data, attacker, defender, crit_stats, true, weather)

    if(noncrit_damage === 0) {
        return null
    }

    const return_value = {
        "turn_chances": []
    }

    let crit_chance = 17 / 256
    if(move_data.effect === "EFFECT_FUTURE_SIGHT") {
        crit_chance = 0
    }

    // calculate all rolls upfront
    let rolls = []

    if(move_data.effect === "EFFECT_REVERSAL") {
        rolls.push([noncrit_damage, 1.0])
        return_value.base_low = noncrit_damage
        return_value.base = noncrit_damage
        return_value.maximum = noncrit_damage
    }
    else if(move_data.effect === "EFFECT_STATIC_DAMAGE") {
        rolls.push([move_data.base_power, 1.0])
        return_value.base = move_data.base_power
        return_value.base_low = move_data.base_power
    }
    else if(move_data.effect === "EFFECT_OHKO") {
        rolls.push([65535, 1.0])
        return_value.base = 65535
        return_value.base_low = 65535
    }
    else if(move_data.effect === "EFFECT_PSYWAVE") {
        const level = attacker.data.level
        const max_damage = (level + int_divide(level, 2)) & 255
        if(max_damage === 0) {
            (warnings ?? {})["psywave_warning"] = "Psywave will softlock the game if your level is 0 or 171."
            return "Game crash :("
        }

        for(let i = 1; i <= max_damage; i++) {
            rolls.push([i, 1 / max_damage])
        }

        return_value.base = max_damage
        return_value.base_low = 1
    }
    else {
        const noncrit_chance = 1.0 - crit_chance
        return_value.base = noncrit_damage

        const roll_count = (MAX_ROLL - MIN_ROLL + 1)
        for(let i = MIN_ROLL; i <= MAX_ROLL; i++) {
            let noncrit_damage_roll = int_divide(noncrit_damage * i, MAX_ROLL)
            let crit_damage_roll = int_divide(crit_damage * i, MAX_ROLL)

            rolls.push([noncrit_damage_roll, noncrit_chance / roll_count])
            rolls.push([crit_damage_roll, crit_chance / roll_count])
        }

        return_value.base_low = rolls.map((r) => r[0]).reduce((a, b) => {
            return a < b ? a : b
        })

        if(!per_hit) {
            const cache = {
                completed: {}
            }

            function double_up(new_rolls, total_odds, total_damage, n) {
                if(n < 1) {
                    throw new Error("bad state (double_up n < 1)")
                }

                const cached = cache[n]
                if(cached != null) {
                    // re-use results from last roll (avoids having to do the same calculation billions of times)
                    for(const [hit_dmg, hit_odds] of Object.entries(cached)) {
                        const odds = hit_odds * total_odds
                        const dmg = parseInt(hit_dmg) + total_damage
                        new_rolls[dmg] = (new_rolls[dmg] ?? 0) + odds
                    }
                }
                else {
                    for(const [hit_dmg, hit_odds] of rolls) {
                        const odds = hit_odds * total_odds
                        const dmg = hit_dmg + total_damage

                        if(n === 1) {
                            new_rolls[dmg] = (new_rolls[dmg] ?? 0) + odds
                        }
                        else {
                            double_up(new_rolls, odds, dmg, n - 1)
                        }
                    }
                }
            }

            switch(move_data.effect) {
                case "EFFECT_TWINEEDLE":
                case "EFFECT_DOUBLE_HIT": {
                    const new_rolls = {}
                    double_up(new_rolls, 1, 0, 2)

                    rolls = []
                    for(const [k,v] of Object.entries(new_rolls)) {
                        rolls.push([parseInt(k), v])
                    }

                    break
                }
                case "EFFECT_MULTI_HIT": {
                    // 3/8 chance to hit ONLY 2x
                    // 3/8 chance to hit ONLY 3x
                    // 1/8 chance to hit ONLY 4x
                    // 1/8 chance to hit ONLY 5x

                    const hit_odds = [[3/8, 2], [3/8, 3], [1/8, 4], [1/8, 5]]

                    const new_rolls = {}
                    for(const [odds, hits] of hit_odds) {
                        const new_rolls_this = {}

                        double_up(new_rolls_this, 1, 0, hits)
                        cache[hits] = Object.freeze(new_rolls_this)

                        for(const [k, v] of Object.entries(cache[hits])) {
                            new_rolls[k] = (new_rolls[k] ?? 0) + v * odds
                        }
                    }

                    rolls = []
                    for(const [k,v] of Object.entries(new_rolls)) {
                        rolls.push([parseInt(k), v])
                    }

                    break
                }
            }
        }
    }

    let accuracy_over_256 = move_data.accuracy_out_of_256

    if(move_data.effect === "EFFECT_OHKO") {
        const attacker_level = attacker.data.level
        const defender_level = defender.data.level
        const difference = attacker_level - defender_level
        if(difference < 0) {
            return null
        }
        accuracy_over_256 = Math.min(accuracy_over_256 + difference * 2, 255)
    }

    const accuracy = accuracy_over_256 / 256

    const bypasses_accuracy = (() => {
        if(move_data.effect === "EFFECT_ALWAYS_HIT") {
            return true
        }

        if(accuracy_over_256 >= 255) {
            return true
        }

        if(weather === Weather.RAIN && move_type === "THUNDER") {
            return true
        }

        return false
    })()

    // Apply accuracy
    if(!bypasses_accuracy) {
        for(const c in rolls) {
            rolls[c][1] *= accuracy
        }
    }

    // For displaying stuff
    const best_damage = rolls.map((r) => r[0]).reduce((a, b) => {
        return a > b ? a : b
    })

    return_value.maximum = best_damage
    return_value.minimum = rolls.map((r) => r[0]).reduce((a, b) => {
        if (a === 0.0) {
            return b
        }
        if (b === 0.0) {
            return a
        }
        return a < b ? a : b
    })

    return_value.average = rolls.map((a) => a[0] * a[1]).reduce((a,b) => a + b)

    // Combine rolls again
    rolls = combine_rolls(rolls, defender)

    // we want the greater of rolls.length or 2 because log(1) = 0 and we don't want to divide by 0
    // const total_turns = Math.log2(max_rolls) / Math.log2(Math.max(rolls.length, 2))
    const remaining_hp = defender.data.stats.hp

    if(best_damage < 1) {
        return return_value
    }

    calculate_damage_rolls_against_hp(
        remaining_hp,
        rolls,
        return_value,
        cutoff,
        max_turns,
        max_rolls
    )

    return return_value
}

// For some reason, these aren't defined as high-crit moves via move effect by the game
export const HIGH_CRIT_MOVES = [
    "KARATE_CHOP",
    "RAZOR_WIND",
    "RAZOR_LEAF",
    "CRABHAMMER",
    "SLASH",
    "AEROBLAST",
    "CROSS_CHOP"
]

function combine_rolls(rolls, defender) {
    // Reduce complexity of rolls by deduping all damages and adding their probabilities together
    // and also combine anything that exceeds the target's HP
    const damages_by_amt = {}
    for(const [roll_dmg, roll_amt] of rolls) {
        const damage = parseInt(roll_dmg)
        if(damage < 1 || roll_amt <= 0.0) {
            // ignore anything that does nothing (we've premultiplied accuracy)
            continue
        }

        const effective_damage = Math.min(damage, defender.data.stats.hp)
        damages_by_amt[effective_damage] = (damages_by_amt[effective_damage] ?? 0) + roll_amt
    }

    const new_rolls = []
    for(const [k, v] of Object.entries(damages_by_amt)) {
        new_rolls.push([parseInt(k), v])
    }
    return new_rolls
}

function calculate_damage_rolls_against_hp(remaining_hp, rolls, return_value, cutoff, max_turns, max_rolls) {
    // create buckets from 0 to HP-1
    const buckets = []
    for(let i = 0; i < remaining_hp; i++) {
        buckets.push([0.0, 0.0])
    }

    // at full HP, we're at 100% HP
    buckets.push([1.0, 1.0])

    for(let turn_count = 0; turn_count < (max_turns ?? 256); turn_count++) {
        for(const [dmg, dmg_probability] of rolls) {
            if(dmg < 1) {
                continue
            }

            if(--max_rolls < 1) {
                return
            }

            for(const hp in buckets) {
                const hp_int = parseInt(hp)
                if(hp_int === 0) {
                    continue
                }

                const prob_from = buckets[hp_int]
                const prob_to = buckets[Math.max(hp_int - dmg, 0)]

                const value_to_add = prob_from[0] * dmg_probability
                prob_from[1] -= value_to_add
                prob_to[1] += value_to_add
            }
        }

        for(const probability of buckets) {
            // floating point precision
            if(probability[1] <= 0.0000001) {
                probability[1] = 0.0
            }
            if(probability[1] >= 0.9999999) {
                probability[1] = 1.0
            }
            probability[0] = probability[1]
        }

        // how many times are we at 0 HP?
        const defeat_chance = buckets[0][0]
        return_value.turn_chances.push(defeat_chance)

        if(defeat_chance >= (cutoff ?? 1.0)) {
            break
        }
    }
}

function calculate_damage_subtotal(move_data, attacker, stats, is_crit) {
    const total_power = (int_divide(2 * (attacker.data.level & 255), 5) + 2) * move_data.base_power * (stats.attack & 65535)
    let defense = stats.defense & 65535

    if(move_data.effect === "EFFECT_SELFDESTRUCT") {
        defense = Math.max(int_divide(defense, 2), 1)
    }

    let total_damage = int_divide(int_divide(total_power, defense), 50)

    // TODO: item boost (value / 100)

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

function calculate_max_damage_for_move_with_stats(move_type, move_data, attacker, defender, stats, is_crit, weather) {
    let total_damage = calculate_damage_subtotal(move_data, attacker, stats, is_crit)
    total_damage = apply_type_effectiveness(move_type, total_damage, move_data, attacker, defender, weather)

    if(total_damage === 0) {
        return 0
    }

    return total_damage
}

function apply_type_effectiveness(move_type, total_damage, move_data, attacker, defender, weather) {
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

    const badge_boost_index = BADGE_BOOSTS[move_data.type]
    if(badge_boost_index != null && attacker.badges?.[badge_boost_index]) {
        total_damage += int_divide(total_damage, 8)
    }

    if(attacker.data.types.includes(move_data.type)) {
        total_damage += int_divide(total_damage, 2)
    }

    for(const t of defender.data.types) {
        const type_effectiveness = TYPE_EFFECTIVENESS[t]
        if(type_effectiveness == null) {
            continue
        }
        if(type_effectiveness.immunities?.includes(move_data.type)) {
            return 0
        }
        if(type_effectiveness.weaknesses?.includes(move_data.type)) {
            total_damage = Math.max(int_divide(total_damage * 20, 10), 1)
        }
        if(type_effectiveness.resistances?.includes(move_data.type)) {
            total_damage = Math.max(int_divide(total_damage * 5, 10), 1)
        }
    }

    return total_damage
}

const BADGE_BOOSTS = {
    [Type.FLYING]: [0],
    [Type.BUG]: [1],
    [Type.NORMAL]: [2],
    [Type.GHOST]: [3],
    [Type.FIGHTING]: [4],
    [Type.STEEL]: [5],
    [Type.ICE]: [6],
    [Type.DRAGON]: [7],
    [Type.ROCK]: [8],
    [Type.WATER]: [9],
    [Type.ELECTRIC]: [10],
    [Type.GRASS]: [11],
    [Type.POISON]: [12],
    [Type.PSYCHIC]: [13],
    [Type.FIRE]: [14],
    [Type.GROUND]: [15]
}

const TYPE_EFFECTIVENESS = {
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

function get_attack_and_defense_stat(move_data, attacker, defender) {
    const crit_physical_reuse_stat = attacker.data.stages.attack > attacker.data.stages.defense
    const crit_special_reuse_stat = attacker.data.stages.special_attack > attacker.data.stages.special_defense

    let stats
    switch(damage_category_of_type(move_data.type)) {
        case DamageCategory.PHYSICAL: stats = { attack: attacker.stats.attack, defense: defender.stats.defense, attack_crit: crit_physical_reuse_stat ? attacker.stats.attack : attacker.data.stats.attack, defense_crit: crit_physical_reuse_stat ? defender.stats.defense : defender.data.stats.defense }; break;
        case DamageCategory.SPECIAL: stats = { attack: attacker.stats.special_attack, defense: defender.stats.special_defense, attack_crit: crit_special_reuse_stat ? attacker.stats.special_attack : attacker.data.stats.special_attack, defense_crit: crit_special_reuse_stat ? defender.stats.special_defense : defender.data.stats.special_defense }; break;
        default: throw new Error("Unknown attack/defense stat")
    }

    while(stats.attack > 255 && stats.defense > 255) {
        stats.attack = Math.max(int_divide(stats.attack, 4), 1)
        stats.defense = Math.max(int_divide(stats.defense, 4), 1)
    }

    while(stats.attack_crit > 255 && stats.defense_crit > 255) {
        stats.attack_crit = Math.max(int_divide(stats.attack_crit, 4), 1)
        stats.defense_crit = Math.max(int_divide(stats.defense_crit, 4), 1)
    }

    return [ { attack: stats.attack, defense: stats.defense }, { attack: stats.attack_crit, defense: stats.defense_crit } ]
}

function apply_move_modifications(move_data, attacker) {
    switch(move_data.effect) {
        case "EFFECT_RETURN": {
            move_data.base_power = int_divide(attacker.data.friendship, 5) * 2
            break
        }
        case "EFFECT_FRUSTRATION": {
            move_data.base_power = int_divide(255 - attacker.data.friendship, 5) * 2
            break
        }
        case "EFFECT_HIDDEN_POWER": {
            const { base_power, type } = get_hidden_power_stats(attacker.data.dvs)
            move_data.base_power = base_power
            move_data.type = type
            break
        }
    }
}

export function get_hidden_power_stats({attack, defense, special, speed}) {
    const mask = 0b1000

    const base_power = 31 + int_divide(
        (((attack & mask) * 40 + (defense & mask) * 20 + (speed & mask) * 10 + (special & mask) * 5) >> 3)
        + (special & 0b11), 2)

    const type = HIDDEN_POWER_TYPE_TABLE[((attack & 0b11) << 2) | (defense & 0b11)]

    return { base_power, type }
}

const HIDDEN_POWER_TYPE_TABLE = [
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
]
