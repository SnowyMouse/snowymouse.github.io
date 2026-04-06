"use strict"

import * as gen1 from "./gen1/gen1.js"
import * as gen2 from "./gen2/gen2.js"

export * as util from "./util.js"

import {
    calculate_stat,
    damage_category_of_type,
    DamageCategory, Game,
    Generation,
    generation_of_game,
    int_divide,
    unreachable,
    NO_MOVE,
    Weather,
    get_hidden_power_stats,
    MODIFIER_FOR_STAT, StatusCondition
} from "./util.js";

let loaded = null

export function get_moves(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            throw new Error("TODO: gen1 moves")
        case Generation.Gen2:
            return gen2.get_moves()
        default:
            unreachable()
    }
}

export function get_pokemon(game) {
    switch(game) {
        case Game.GoldSilver:
            return gen2.get_gold_pokemon()
        case Game.Crystal:
            return gen2.get_crystal_pokemon()
        default:
            throw new Error(`get_pokemon - unknown game ${game}`)
    }
}

export function get_items(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return Object.freeze({})
        case Generation.Gen2:
            return gen2.get_items()
        default:
            unreachable()
    }
}

export function get_supported_items(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return Object.freeze({})
        case Generation.Gen2:
            return gen2.get_supported_items()
        default:
            unreachable()
    }
}

export function get_parties(game) {
    switch(game) {
        case Game.GoldSilver:
            return gen2.get_gold_parties()
        case Game.Crystal:
            return gen2.get_crystal_parties()
        default:
            throw new Error(`get_parties - unknown game ${game}`)
    }
}

export function get_stat_badge_boost_badges(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return gen1.StatBadgeBoostIndex
        case Generation.Gen2:
            return gen2.StatBadgeBoostIndex
        default:
            unreachable()
    }
}

export function get_type_badge_boost_badges(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return {}
        case Generation.Gen2:
            return gen2.TypeBadgeBoostIndex
        default:
            unreachable()
    }
}

export function get_type_boost_items(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return {}
        case Generation.Gen2:
            return gen2.EFFECT_TO_TYPE_BOOST
        default:
            unreachable()
    }
}

export function get_badge_list(game) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return gen1.get_badge_list(game)
        case Generation.Gen2:
            return gen2.get_badge_list(game)
        default:
            unreachable()
    }
}

export async function load_furretcalc(base_url) {
    if(loaded) {
        return loaded
    }

    loaded = gen2.load_gen2(base_url)

    return loaded
}

export async function wait_loaded() {
    if(loaded == null) {
        throw new Error("loading not triggered!")
    }
    await loaded
}

export function receives_special_defense_boost(game, unboosted_special_attack) {
    switch(generation_of_game(game)) {
        case Generation.Gen1:
            return true
        case Generation.Gen2:
            return (unboosted_special_attack >= 206 && unboosted_special_attack <= 432) || (unboosted_special_attack >= 661) // gen 2 is great
        default:
            unreachable()
    }
}

export function calculate_battle_stats(game, out_of_battle_stats, badges, stages, status) {
    const badge_boosts = get_stat_badge_boost_badges(game)
    let { hp, attack, defense, special_attack, special_defense, speed } = out_of_battle_stats
    
    switch(status) {
        case StatusCondition.BURN: attack = int_divide(attack, 2); break;
        case StatusCondition.PARALYZE: speed = int_divide(speed, 4); break;
    }

    const attack_boost = badges?.[badge_boosts.Attack] ?? false
    const defense_boost = badges?.[badge_boosts.Defense] ?? false
    const special_attack_boost = badges?.[badge_boosts.Special] ?? false
    const special_defense_boost = special_attack_boost && receives_special_defense_boost(game, special_attack)
    const speed_boost = badges?.[badge_boosts.Speed] ?? false

    // TODO: do crits in Gen 2 bypass reflect/light screen? if so, those boosts should go here

    return {
        hp: Math.max(hp, 1),
        attack: calculate_stat(attack, attack_boost, stages.attack),
        defense: calculate_stat(defense, defense_boost, stages.defense),
        special_attack: calculate_stat(special_attack, special_attack_boost, stages.special_attack),
        special_defense: calculate_stat(special_defense, special_defense_boost, stages.special_defense),
        speed: calculate_stat(speed, speed_boost, stages.speed),
    }
}

export function calculate_damage_for_all_moves(attacker, defender, warnings, properties) {
    const results = []

    for(const c of attacker.data.moves) {
        if(c === NO_MOVE) {
            results.push(null)
        }
        else {
            results.push(calculate_damage_for_move(c, attacker, defender, warnings, properties))
        }
    }

    return results
}

const MIN_ROLL = 217
const MAX_ROLL = 255

function calculate_damage_for_move(move_type, attacker, defender, warnings, properties) {
    const game = properties.game
    const generation = generation_of_game(game)

    const moves = get_moves(game)
    const move_data_original = moves[move_type]

    let { per_hit, weather, max_rolls, max_turns, cutoff } = properties
    const move_data = { ...move_data_original }
    apply_move_modifications(move_data, attacker)

    const [noncrit_stats, crit_stats] = get_attack_and_defense_stat(game, generation, move_data, attacker, defender)
    const noncrit_damage = calculate_max_damage_for_move_with_stats(generation, move_type, move_data, attacker, defender, noncrit_stats, false, weather)

    if(noncrit_damage === 0) {
        return null
    }

    if(typeof noncrit_damage === "string") {
        return noncrit_damage
    }

    if(!isFinite(noncrit_damage)) {
        return "Error (invalid damage returned - please report this)"
    }

    const return_value = {
        turn_chances: [],
        is_physical: noncrit_stats.is_physical,
        move_data,
        properties,
        rolls: null
    }

    const crit_damage = calculate_max_damage_for_move_with_stats(generation, move_type, move_data, attacker, defender, crit_stats, true, weather)
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

    if(generation === Generation.Gen1) {
        if(move_data.effect === "EFFECT_OHKO") {
            if(defender.stats.speed > attacker.stats.speed) {
                return null
            }
        }
    }
    if(generation === Generation.Gen2) {
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
    }

    accuracy_over_256 = calculate_final_accuracy_over_256(game, accuracy_over_256, attacker.data.stages.accuracy, defender.data.stages.evasion)

    let accuracy = accuracy_over_256 / 256

    const bypasses_accuracy = (() => {
        if(move_data.effect === "EFFECT_ALWAYS_HIT") {
            return true
        }

        if(generation === Generation.Gen1) {
            return false
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
        accuracy,
        0
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

function calculate_final_accuracy_over_256(game, base_accuracy, attacker_accuracy_stage, defender_evasion_stage) {
    let accuracy = base_accuracy
    let accuracy_ratio
    let evasion_ratio

    switch(generation_of_game(game)) {
        case Generation.Gen1:
            accuracy_ratio = MODIFIER_FOR_STAT[attacker_accuracy_stage]
            evasion_ratio = MODIFIER_FOR_STAT[-defender_evasion_stage]
            return accuracy

        case Generation.Gen2:
            accuracy_ratio = gen2.MODIFIER_FOR_ACCURACY[attacker_accuracy_stage]
            evasion_ratio = gen2.MODIFIER_FOR_ACCURACY[-defender_evasion_stage]
            break
    }

    const [num_acc, den_acc] = accuracy_ratio
    const [num_eva, den_ev] = evasion_ratio

    accuracy = Math.min(Math.max(int_divide(accuracy * num_acc, den_acc), 0), 65535)
    accuracy = Math.min(Math.max(int_divide(accuracy * num_eva, den_ev), 0), 255)

    return accuracy
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

function calculate_damage_rolls_against_hp(move_data, starting_hp, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy, starting_successful_moves_in_a_row) {
    const rolls = return_value.rolls.rolls

    if(move_data.effect === "EFFECT_HYPER_BEAM" || move_data.effect === "EFFECT_FURY_CUTTER" || move_data.effect === "EFFECT_ROLLOUT") {
        calculate_damage_rolls_against_hp_recursive(move_data, starting_hp, rolls, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy, starting_successful_moves_in_a_row)
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

function calculate_damage_rolls_against_hp_recursive(move_data, starting_hp, rolls, return_value, cutoff, max_turns, max_rolls, per_hit, accuracy, starting_successful_moves_in_a_row) {
    // A slower, recursive approach for move effects difficult to figure out linearly

    const must_recharge = !per_hit && move_data.effect === "EFFECT_HYPER_BEAM"
    const total_turns = Math.floor(Math.min(Math.log2(max_rolls) / Math.log2(rolls.length), max_turns))

    const chances = []
    for(let i = 0; i < total_turns; i++) {
        chances.push(0)
    }

    const success_increment = must_recharge ? 2 : 1

    function inner(remaining_hp, turn_index, current_universe_chance, successful_moves_in_a_row) {
        if(chances[turn_index] == null) {
            return
        }

        let multiplier = 1
        if(successful_moves_in_a_row > 4) {
            if(move_data.effect === "EFFECT_FURY_CUTTER") {
                successful_moves_in_a_row = 4
            }
            else if(move_data.effect === "EFFECT_ROLLOUT") {
                successful_moves_in_a_row = 0
            }
        }

        if(move_data.effect === "EFFECT_FURY_CUTTER" || move_data.effect === "EFFECT_ROLLOUT") {
            multiplier = 1 << successful_moves_in_a_row
        }

        for(const [damage, chance] of rolls) {
            const remaining_hp_after_damage = remaining_hp - damage * multiplier
            const total_probability = current_universe_chance * chance * accuracy

            if(remaining_hp_after_damage < 1) {
                for(let i = turn_index; i < chances.length; i++) {
                    chances[i] = Math.min(chances[i] + total_probability, 1.0)
                }
                continue
            }

            inner(remaining_hp_after_damage, turn_index + success_increment, total_probability, successful_moves_in_a_row + 1)
        }

        // But what if we miss?
        if(accuracy < 1.0) {
            inner(remaining_hp, turn_index + 1, current_universe_chance * (1.0 - accuracy), 0)
        }
    }

    inner(starting_hp, 0, 1, 0)

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

function calculate_max_damage_for_move_with_stats(generation, move_type, move_data, attacker, defender, stats, is_crit, weather) {
    switch(generation) {
        case Generation.Gen1:
            throw new Error("TODO: gen1 damage")
        case Generation.Gen2:
            return gen2.calculate_max_damage(move_data, attacker, stats, is_crit, move_type, defender, weather)
        default:
            unreachable()

    }
}


function get_attack_and_defense_stat(game, generation, move_data, attacker, defender) {
    let is_physical = damage_category_of_type(move_data.type) === DamageCategory.PHYSICAL
    let is_special = !is_physical

    // TODO: In Gen 1, this can divide by 0 (if we have a defense stat less than 4 and an attack stat greater
    //  than 255), which is accurate to the Gen 1 games, but it means it will crash those games where we'll
    //  otherwise just get some weird infinity logic nonsense here... we should probably handle this
    //
    // TODO: Also check if Gen 2 can return 0 defense here (and if so, does it handle 0 defense?)

    const make_stats_u8 = (stats, attack_key, defense_key) => {
        let attack = stats[attack_key]
        let defense = stats[defense_key]

        if(attack > 255 || defense > 255) {
            attack = int_divide(attack, 4)
            defense = int_divide(defense, 4)

            if(generation !== Generation.Gen1) {
                attack = Math.max(attack, 1)
                defense = Math.max(defense, 1)
            }

            stats[attack_key] = attack
            stats[defense_key] = defense

            return true
        }
        else {
            return false
        }
    }

    const make_stats_u8_loop = (stats, attack_key, defense_key) => {
        while(make_stats_u8(stats, attack_key, defense_key)) {
            if(game !== Game.Crystal) {
                // TODO: Handle Crystal which lets it do this a second time in non link battles
                break
            }
        }
    }

    const make_stats_u8_all = (stats) => {
        make_stats_u8_loop(stats, "attack", "defense")
        make_stats_u8_loop(stats, "attack_crit", "defense_crit")
    }

    switch(generation) {
        case Generation.Gen1: {
            let stats
            if(is_physical) {
                stats = { attack: attacker.stats.attack, defense: defender.stats.defense, attack_crit: attacker.data.stats.attack, defense_crit: defender.data.stats.defense }
            }
            else {
                stats = { attack: attacker.stats.special_attack, defense: defender.stats.special_defense, attack_crit: attacker.data.stats.special_attack, defense_crit: defender.data.stats.special_defense }
            }

            // TODO: screens

            make_stats_u8_all(stats)

            return [
                { attack: stats.attack, defense: stats.defense, is_physical, is_special },
                { attack: stats.attack_crit, defense: stats.defense_crit, is_physical, is_special }
            ]
        }
        case Generation.Gen2: {
            const crit_physical_reuse_stat = attacker.data.stages.attack > attacker.data.stages.defense
            const crit_special_reuse_stat = attacker.data.stages.special_attack > attacker.data.stages.special_defense

            let stats
            if(is_physical) {
                stats = { attack: attacker.stats.attack, defense: defender.stats.defense, attack_crit: crit_physical_reuse_stat ? attacker.stats.attack : attacker.data.stats.attack, defense_crit: crit_physical_reuse_stat ? defender.stats.defense : defender.data.stats.defense }
            }
            else {
                stats = { attack: attacker.stats.special_attack, defense: defender.stats.special_defense, attack_crit: crit_special_reuse_stat ? attacker.stats.special_attack : attacker.data.stats.special_attack, defense_crit: crit_special_reuse_stat ? defender.stats.special_defense : defender.data.stats.special_defense }
            }

            if(defender.data.screens[is_physical ? "reflect" : "light_screen"]) {
                stats.defense = (stats.defense * 2) & 65535
                stats.defense_crit = (stats.defense_crit * 2) & 65535
            }

            make_stats_u8_all(stats)

            return [
                { attack: stats.attack, defense: stats.defense, is_physical, is_special },
                { attack: stats.attack_crit, defense: stats.defense_crit, is_physical, is_special }
            ]
        }
        default: unreachable()
    }
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
