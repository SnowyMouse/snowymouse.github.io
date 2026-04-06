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

export function calculate_monster_stats(level, base_stats, dvs, statexp = null) {
    const hp_dv = calculate_hp_dv(dvs)
    return Object.freeze({
        "hp": calculate_hp_stat(level, base_stats["hp"], hp_dv, statexp?.hp ?? 0),
        "attack": calculate_non_hp_stat(level, base_stats["attack"], dvs.attack, statexp?.attack ?? 0),
        "defense": calculate_non_hp_stat(level, base_stats["defense"], dvs.defense, statexp?.defense ?? 0),
        "special_attack": calculate_non_hp_stat(level, base_stats["special_attack"], dvs.special, statexp?.special ?? 0),
        "special_defense": calculate_non_hp_stat(level, base_stats["special_defense"], dvs.special, statexp?.special ?? 0),
        "speed": calculate_non_hp_stat(level, base_stats["speed"], dvs.speed, statexp?.speed ?? 0)
    })
}

function calculate_hp_stat(level, base, dv, statexp) {
    return int_divide(((base + dv) * 2 + calculate_statexp_part(statexp)) * level, 100) + 10 + level
}

function calculate_non_hp_stat(level, base, dv, statexp) {
    return int_divide(((base + dv) * 2 + calculate_statexp_part(statexp)) * level, 100) + 5
}

function calculate_statexp_part(statexp) {
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

export async function wait_loaded() {
    if(loaded == null) {
        throw new Error("loading not triggered!")
    }
    await loaded
}

export const StatBadgeBoostIndexCrystal = Object.freeze({
    Attack: 0,
    Defense: 5,
    Special: 6,
    Speed: 2
})

export function receives_special_defense_boost(unboosted_special_attack) {
    return (unboosted_special_attack >= 206 && unboosted_special_attack <= 432) || (unboosted_special_attack >= 661) // gen 2 is great
}

export function calculate_battle_stats(out_of_battle_stats, badges, stages, status) {
    let { hp, attack, defense, special_attack, special_defense, speed } = out_of_battle_stats
    
    switch(status) {
        case "burned": attack = int_divide(attack, 2); break;
        case "paralyzed": speed = int_divide(speed, 4); break;
    }

    const attack_boost = badges?.[StatBadgeBoostIndexCrystal.Attack] ?? false
    const defense_boost = badges?.[StatBadgeBoostIndexCrystal.Defense] ?? false
    const special_attack_boost = badges?.[StatBadgeBoostIndexCrystal.Special] ?? false
    const special_defense_boost = special_attack_boost && receives_special_defense_boost(special_attack)
    const speed_boost = badges?.[StatBadgeBoostIndexCrystal.Speed] ?? false

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

function calculate_damage_for_move(move_type, move_data_original, attacker, defender, warnings, properties) {
    let { per_hit, weather, max_rolls, max_turns, cutoff } = properties
    const move_data = { ...move_data_original }
    apply_move_modifications(move_data, attacker)

    if(move_data.base_power === 0 && move_data.effect !== "EFFECT_OHKO") {
        return null
    }

    const [noncrit_stats, crit_stats] = get_attack_and_defense_stat(move_data, attacker, defender)

    const noncrit_damage = calculate_max_damage_for_move_with_stats(move_type, move_data, attacker, defender, noncrit_stats, false, weather)

    if(noncrit_damage === 0) {
        return null
    }

    const return_value = {
        turn_chances: [],
        is_physical: noncrit_stats.is_physical,
        move_data,
        properties,
        rolls: null
    }

    const crit_damage = calculate_max_damage_for_move_with_stats(move_type, move_data, attacker, defender, crit_stats, true, weather)
    const crit_rate = get_crit_chance({move_data, move_type, attacker})

    const roll_generator = (multiplier) => generate_rolls_for_move({
        move_type,
        move_data,
        noncrit_damage: Math.max(Math.floor(noncrit_damage * multiplier), 1),
        crit_damage: Math.max(Math.floor(crit_damage * multiplier), 1),
        attacker,
        defender,
        per_hit,
        warnings,
        weather,
        crit_rate
    })

    return_value.rolls = roll_generator(1.0)

    if(return_value.rolls.error) {
        return return_value.rolls.error
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
    else if(move_data.effect === "EFFECT_THUNDER") {
        switch(weather) {
            // accuracy is set to 100% (note: this is redundant as it'll bypass accuracy anyway, but the game does this)
            case Weather.RAIN: accuracy_over_256 = 255; break;

            // accuracy is set to 50%
            case Weather.SUN: accuracy_over_256 = 128; break;
        }
    }
    accuracy_over_256 = calculate_final_accuracy_over_256(accuracy_over_256, attacker.data.stages.accuracy, defender.data.stages.evasion)

    let accuracy = accuracy_over_256 / 256

    const bypasses_accuracy = (() => {
        if(move_data.effect === "EFFECT_ALWAYS_HIT") {
            return true
        }

        if(accuracy_over_256 >= 255) {
            return true
        }

        if(weather === Weather.RAIN && move_data.effect === "EFFECT_THUNDER") {
            return true
        }

        return false
    })()

    // Apply accuracy
    if(bypasses_accuracy) {
        accuracy = 1.0
    }

    return_value.rolls.average *= accuracy

    calculate_damage_rolls_against_hp(
        move_data,
        defender.data.stats.hp,
        return_value,
        cutoff,
        max_turns,
        max_rolls,
        per_hit,
        accuracy
    )

    return_value.rolls.accuracy = accuracy

    if(!per_hit) {
        adjust_turn_chances_for_move({move_data, return_value, weather})
    }

    return return_value
}

function adjust_turn_chances_for_move({move_data, weather, return_value}) {
    const turns_calculated = return_value.turn_chances.length
    if(turns_calculated === 0) {
        return
    }

    switch(move_data.effect) {
        case "EFFECT_SOLARBEAM":
            if(weather === Weather.SUN) {
                return
            }
        // fallthrough
        case "EFFECT_RAZOR_WIND":
        case "EFFECT_FLY":
        case "EFFECT_DIG":
        case "EFFECT_SKY_ATTACK": {
            for(let i = turns_calculated - 1; i >= 0; i--) {
                return_value.turn_chances.splice(i, 0, 0)
            }
            break
        }

        case "EFFECT_FUTURE_SIGHT":
            for(let i = turns_calculated - 1; i >= 0; i--) {
                return_value.turn_chances.splice(i, 0, 0, 0)
            }
            break

        case "EFFECT_ROLLOUT":
        case "EFFECT_FURY_CUTTER": {
            return_value.per_hit = true
        }
    }

}

const CRIT_RATIO = Object.freeze([
    17 / 256, // 1 / 15-ish
    1 / 8,
    1 / 4,
    85 / 256, // 1 / 3-ish
    1 / 2,
    1 / 2,
    1 / 2
])

function get_crit_chance({move_data, move_type}) {
    let crit_rate_modifier = 0
    if(move_data.effect === "EFFECT_FUTURE_SIGHT") {
        return 0
    }

    // TODO if the attacker's species is farfetch'd and they have a stick, return CRIT_RATIO[2]
    // TODO if the attacker's species is chansey and they have a lucky punch, return CRIT_RATIO[2]
    // TODO check focus energy (+1)
    // TODO check scope lens (+1)

    if(HIGH_CRIT_MOVES.includes(move_type)) {
        crit_rate_modifier += 2
    }

    return CRIT_RATIO[crit_rate_modifier]
}

function generate_rolls_for_move({
    move_data,
    crit_rate,
    noncrit_damage,
    crit_damage,
    attacker,
    defender,
    per_hit,
    warnings
}) {
    let rolls
    let base_low
    let base

    const level = attacker.data.level
    switch(move_data.effect) {
        case "EFFECT_REVERSAL": {
            base_low = noncrit_damage
            base = noncrit_damage
            rolls = [[noncrit_damage, 1.0]]
            break
        }
        case "EFFECT_STATIC_DAMAGE": {
            base = move_data.base_power
            base_low = move_data.base_power
            rolls = [[move_data.base_power, 1.0]]
            break
        }
        case "EFFECT_LEVEL_DAMAGE": {
            base = level
            base_low = level
            rolls = [[move_data.base_power, 1.0]]
            break
        }
        case "EFFECT_OHKO": {
            base = 65535
            base_low = 65535
            rolls = [[65535, 1.0]]
            break
        }
        case "EFFECT_PSYWAVE": {
            const max_damage = (level + int_divide(level, 2)) & 255
            if(max_damage === 0) {
                (warnings ?? {})["psywave_warning"] = "Psywave will softlock the game if your level is 0 or 171."
                return { error: "Game crash! (bad level)" }
            }

            rolls = []
            for(let i = 1; i <= max_damage; i++) {
                rolls.push([i, 1 / max_damage])
            }

            base = max_damage
            base_low = 1
            break
        }
        default: {
            const noncrit_chance = 1.0 - crit_rate
            base = noncrit_damage

            const roll_count = (MAX_ROLL - MIN_ROLL + 1)
            rolls = []
            for (let i = MIN_ROLL; i <= MAX_ROLL; i++) {
                let noncrit_damage_roll = Math.max(int_divide(noncrit_damage * i, MAX_ROLL), 1)
                if(i === MIN_ROLL) {
                    base_low = noncrit_damage_roll
                }

                let crit_damage_roll = Math.max(int_divide(crit_damage * i, MAX_ROLL), 1)
                rolls.push([noncrit_damage_roll, noncrit_chance / roll_count])
                rolls.push([crit_damage_roll, crit_rate / roll_count])
            }

            if (!per_hit) {
                rolls = calculate_per_turn_rolls(move_data, rolls)
            }
        }
        break
    }

    const rolls_damages = rolls.map((r) => r[0])
    const minimum = rolls_damages.reduce((a, b) => a < b ? a : b)
    const maximum = rolls_damages.reduce((a, b) => a > b ? a : b)
    const average = (rolls_damages.reduce((a, b) => a + b) ?? 0) / rolls_damages.length

    // Combine rolls
    rolls = combine_rolls(rolls, defender)

    return {
        minimum, maximum, average, rolls, base, base_low
    }
}

function calculate_final_accuracy_over_256(base_accuracy, attacker_accuracy_stage, defender_evasion_stage) {
    let accuracy = base_accuracy

    const [num_acc, den_acc] = MODIFIER_FOR_ACCURACY[attacker_accuracy_stage]
    const [num_eva, den_ev] = MODIFIER_FOR_ACCURACY[-defender_evasion_stage]

    accuracy = Math.min(Math.max(int_divide(accuracy * num_acc, den_acc), 0), 65535)
    accuracy = Math.min(Math.max(int_divide(accuracy * num_eva, den_ev), 0), 255)

    return accuracy
}

const MODIFIER_FOR_ACCURACY = {
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
}

function calculate_per_turn_rolls(move_data, rolls) {
    const cache = {
        completed: {}
    }

    function double_up(new_rolls, total_odds, total_damage, n) {
        if (n < 1) {
            throw new Error("bad state (double_up n < 1)")
        }

        const cached = cache[n]
        if (cached != null) {
            // re-use results from last roll (avoids having to do the same calculation billions of times)
            for (const [hit_dmg, hit_odds] of Object.entries(cached)) {
                const odds = hit_odds * total_odds
                const dmg = parseInt(hit_dmg) + total_damage
                new_rolls[dmg] = (new_rolls[dmg] ?? 0) + odds
            }
        } else {
            for (const [hit_dmg, hit_odds] of rolls) {
                const odds = hit_odds * total_odds
                const dmg = hit_dmg + total_damage

                if (n === 1) {
                    new_rolls[dmg] = (new_rolls[dmg] ?? 0) + odds
                } else {
                    double_up(new_rolls, odds, dmg, n - 1)
                }
            }
        }
    }

    switch (move_data.effect) {
        case "EFFECT_TWINEEDLE":
        case "EFFECT_DOUBLE_HIT": {
            const new_rolls = {}
            double_up(new_rolls, 1, 0, 2)

            rolls = []
            for (const [k, v] of Object.entries(new_rolls)) {
                rolls.push([parseInt(k), v])
            }

            break
        }
        case "EFFECT_MULTI_HIT": {
            // 3/8 chance to hit ONLY 2x
            // 3/8 chance to hit ONLY 3x
            // 1/8 chance to hit ONLY 4x
            // 1/8 chance to hit ONLY 5x

            const hit_odds = [[3 / 8, 2], [3 / 8, 3], [1 / 8, 4], [1 / 8, 5]]

            const new_rolls = {}
            for (const [odds, hits] of hit_odds) {
                const new_rolls_this = {}

                double_up(new_rolls_this, 1, 0, hits)
                cache[hits] = Object.freeze(new_rolls_this)

                for (const [k, v] of Object.entries(cache[hits])) {
                    new_rolls[k] = (new_rolls[k] ?? 0) + v * odds
                }
            }

            rolls = []
            for (const [k, v] of Object.entries(new_rolls)) {
                rolls.push([parseInt(k), v])
            }

            break
        }
    }

    return rolls
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

function calculate_damage_rolls_against_hp(move_data, starting_hp, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy) {
    const rolls = return_value.rolls.rolls

    if(move_data.effect === "EFFECT_HYPER_BEAM") {
        calculate_damage_rolls_against_hp_recursive(move_data, starting_hp, rolls, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy)
        return
    }

    // create buckets from 0 to HP-1
    const buckets = []
    for(let i = 0; i < starting_hp; i++) {
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

                const value_to_add = prob_from[0] * dmg_probability * accuracy
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

function calculate_damage_rolls_against_hp_recursive(move_data, starting_hp, rolls, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy) {
    // A slower, recursive approach for move effects difficult to figure out linearly

    const must_recharge = !per_hit && move_data.effect === "EFFECT_HYPER_BEAM"
    const total_turns = Math.floor(Math.min(Math.log2(max_rolls) / Math.log2(rolls.length), max_turns))

    const chances = []
    for(let i = 0; i < total_turns; i++) {
        chances.push(0)
    }

    const success_increment = must_recharge ? 2 : 1

    function inner(remaining_hp, turn_index, current_universe_chance) {
        if(chances[turn_index] == null) {
            return
        }

        for(const [damage, chance] of rolls) {
            const remaining_hp_after_damage = remaining_hp - damage
            const total_probability = current_universe_chance * chance * accuracy

            if(remaining_hp_after_damage < 1) {
                for(let i = turn_index; i < chances.length; i++) {
                    chances[i] = Math.min(chances[i] + total_probability, 1.0)
                }
                continue
            }

            inner(remaining_hp_after_damage, turn_index + success_increment, total_probability)
        }

        // But what if we miss?
        if(accuracy < 1.0) {
            inner(remaining_hp, turn_index + 1, current_universe_chance * (1.0 - accuracy))
        }
    }

    inner(starting_hp, 0, 1)

    for(let v of chances) {
        if(v < 0.000001) {
            v = 0.0
        }
        else if(v > 0.999999) {
            v = 1.0
        }

        if(accuracy < 1.0 && v >= 0.9999) {
            return_value.turn_chances.push(0.9999)
            return
        }

        return_value.turn_chances.push(v)

        if(v >= cutoff) {
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

    const badge_boost_index = TypeBadgeBoosts[move_data.type]
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

export const TypeBadgeBoosts = {
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

    let is_physical = damage_category_of_type(move_data.type) === DamageCategory.PHYSICAL
    let is_special = !is_physical

    let stats
    if(is_physical) {
        stats = { attack: attacker.stats.attack, defense: defender.stats.defense, attack_crit: crit_physical_reuse_stat ? attacker.stats.attack : attacker.data.stats.attack, defense_crit: crit_physical_reuse_stat ? defender.stats.defense : defender.data.stats.defense }
    }
    else {
        stats = { attack: attacker.stats.special_attack, defense: defender.stats.special_defense, attack_crit: crit_special_reuse_stat ? attacker.stats.special_attack : attacker.data.stats.special_attack, defense_crit: crit_special_reuse_stat ? defender.stats.special_defense : defender.data.stats.special_defense }
    }

    while(stats.attack > 255 && stats.defense > 255) {
        stats.attack = Math.max(int_divide(stats.attack, 4), 1)
        stats.defense = Math.max(int_divide(stats.defense, 4), 1)
    }

    while(stats.attack_crit > 255 && stats.defense_crit > 255) {
        stats.attack_crit = Math.max(int_divide(stats.attack_crit, 4), 1)
        stats.defense_crit = Math.max(int_divide(stats.defense_crit, 4), 1)
    }

    return [
        { attack: stats.attack, defense: stats.defense, is_physical, is_special },
        { attack: stats.attack_crit, defense: stats.defense_crit, is_physical, is_special }
    ]
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
