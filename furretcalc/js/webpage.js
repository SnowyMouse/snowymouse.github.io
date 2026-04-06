"use strict"

import * as furretcalc from "./furretcalc/furretcalc.js"
import {Generation, generation_of_game, StatusCondition} from "./furretcalc/util.js";

furretcalc.load_furretcalc("./js/furretcalc")
    .then(() => set_up_widgets_initial())

let is_calculating = false
let game = null
let generation = null
let manual_stat_input = false
let auto_sync = false

let debounce_timer = null
function recalculate() {
    if(is_calculating || auto_sync) {
        return
    }

    quickly_update_stats()

    if(debounce_timer != null) {
        clearTimeout(debounce_timer)
    }

    document.getElementById("generated_time").innerHTML = "..."
    debounce_timer = setTimeout(actually_recalculate, 200)
}

async function actually_recalculate() {
    if(is_calculating) {
        recalculate()
        return
    }

    debounce_timer = null
    try {
        is_calculating = true
        await furretcalc.wait_loaded()

        document.getElementById("range_details").style.display = "none"
        document.getElementById("notes_buffer_outer").style.display = "none"

        move_data_infos = {}

        const player_stats = recalculate_stats(true)
        const opponent_stats = recalculate_stats(false)

        let max_rolls = parse_int_clamped(document.getElementById("settings_max_damage_rolls").value, 0, Number.MAX_SAFE_INTEGER)
        if(!isFinite(max_rolls) || max_rolls < 1) { max_rolls = 100 }
        let max_turns = parse_int_clamped(document.getElementById("settings_max_turns").value, 0, Number.MAX_SAFE_INTEGER)
        if(!isFinite(max_turns) || max_turns < 1) { max_turns = 100 }
        let target_ko_chance = parse_float_clamped(document.getElementById("settings_ko_chance").value, 0, 100)
        if(!isFinite(target_ko_chance) || target_ko_chance < 0.0) { max_turns = 0.0 }
        if(target_ko_chance > 100.0) { target_ko_chance = 100.0 }

        const properties = {
            per_hit: document.getElementById("settings_per_turn").value === "per_hit",
            weather: document.getElementById("weather").value,
            max_rolls,
            max_turns,
            cutoff: target_ko_chance / 100.0,
            game
        }

        const warnings = {}

        const start_time = performance.now()

        const player_moves = furretcalc.calculate_damage_for_all_moves(player_stats, opponent_stats, warnings, properties)
        const opponent_moves = furretcalc.calculate_damage_for_all_moves(opponent_stats, player_stats, warnings, properties)

        const end_time = performance.now()

        document.getElementById("generated_time").innerHTML = `${(end_time - start_time).toFixed(0)} ms`

        for(const data of document.getElementsByClassName("stats_move_name")) {
            data.innerHTML = ""
        }

        for(const data of [...document.getElementsByClassName("ohko_move")]) {
            data.classList.remove("ohko_move")
        }

        for(const data of [...document.getElementsByClassName("best_move")]) {
            data.classList.remove("best_move")
        }

        for(const data of [...document.getElementsByClassName("error_move")]) {
            data.classList.remove("error_move")
        }

        for(const data of document.getElementsByClassName("stats_move_data")) {
            data.innerHTML = ""
        }

        const suggestions = {}

        for(const [warning_key, warning_text] of Object.entries(warnings)) {
            suggestions[`warning_${warning_key}`] = warning_text
        }

        format_move_data("#player_damage", player_stats, opponent_stats, player_moves, true, suggestions)
        format_move_data("#enemy_damage", opponent_stats, player_stats, opponent_moves, false, suggestions)

        const notes = document.getElementById("suggestions_and_notes_list")
        let html = ""

        for(const v of Object.values(suggestions)) {
            html += `<li>${v}</li>`
        }

        notes.innerHTML = html

        if(html !== "") {
            document.getElementById("notes_buffer_outer").style.display = "block"
        }

        reshow_range()
    }
    finally {
        is_calculating = false
    }
}

const QUASI_TYPELESS_NOTE = "This move does not receive STAB, type-based badge boosts, weather boosts (or nerfs), or type effectiveness (it does not interact with your opponent's types).\n\nHowever, its typing is still used for determining damage category and item boosts."
const DISPLAYED_TURN_COUNT = 4

let move_data_infos = {}

function format_move_data(base_div, stats, stats_opposite, moves, is_player, suggestions) {
    const all_moves = furretcalc.get_moves(game)

    // Returns <0 if b > a; >0 if a > b; 0 if a == b
    function cmp_ttk(a, b) {
        const a_turn_chances = a?.turn_chances
        const b_turn_chances = b?.turn_chances

        if(a_turn_chances == null) {
            if(b_turn_chances == null) {
                return 0
            }
            return -1
        }

        if(b_turn_chances == null) {
            return 1
        }

        let last_a = a_turn_chances[0]
        let last_b = b_turn_chances[0]

        if(last_a == null) {
            if(last_b == null) {
                return 0
            }
            return -1
        }

        if(last_b == null) {
            return 1
        }

        for(let i = 0; i < Math.max(a_turn_chances.length, b_turn_chances.length); i++) {
            const a_val = a_turn_chances[i] ?? last_a
            const b_val = b_turn_chances[i] ?? last_b

            if((a_val > 0.5 || b_val > 0.5) && a_val !== b_val) {
                return a_val - b_val
            }

            last_a = a_val
            last_b = b_val
        }

        return 0
    }

    const best_ttk_rating = moves.toSorted((a, b) => -cmp_ttk(a, b))[0]

    for(const [index, data] of Object.entries(moves)) {
        const info_index = `${is_player ? "PLAYER" : "OPPONENT"}_${index}`
        move_data_infos[info_index] = null

        const move_name = stats.data.moves[index]
        if(move_name === "NO_MOVE") {
            continue
        }
        const move_data = all_moves[move_name]
        if(move_data == null) {
            continue
        }

        const index_int = parseInt(index)
        let move_display_name = move_data.name
        if(move_data.effect === "EFFECT_HIDDEN_POWER") {
            const { base_power, type } = furretcalc.util.get_hidden_power_stats(stats.data.dvs)
            const note = (stats.data.dvs.attack === 0 && stats.data.dvs.defense === 0 && stats.data.dvs.special === 0 && stats.data.dvs.speed === 0) ? "(all-zero IVs (DVs) set)" : ""
            suggestions[`hidden_power_${is_player ? "player": "opponent"}`] = `Calculated ${is_player ? "your" : "opponent's"} Hidden Power as a ${type}-type move with ${base_power} base power${note}.`

            move_display_name = `${move_display_name} ${type}`
        }

        document.querySelector(`${base_div} .stats_move_${index_int + 1} .stats_move_name`).innerHTML = move_display_name

        const div_selector = `${base_div} .stats_move_${index_int + 1}`
        const div_data = document.querySelector(`${div_selector} .stats_move_data`)

        if(typeof data === "string") {
            div_data.innerHTML = `<span class="range range_nonclickable" title="This is broken. Please fix your input.">${data}</span>`
            document.querySelector(div_selector).classList.add("error_move")
            continue
        }

        if(data == null) {
            continue
        }
        const {rolls: { base_low, base, minimum, maximum, average }, turn_chances, properties} = data

        const turn_name = properties.per_hit ? "hit" : "turn"

        let data_text = "";

        let displayed_min = base_low
        let displayed_max = base

        if(document.getElementById("settings_range_display").value === "full_range") {
            displayed_min = minimum
            displayed_max = maximum
        }

        const min_percent = displayed_min / stats_opposite.data.stats.max_hp
        const max_percent = displayed_max / stats_opposite.data.stats.max_hp

        const fixer = max_percent >= 10.0 ? no_decimal : single_decimal

        let displayed_range = base_low === base ?
            `${displayed_min} (${fixer(min_percent * 100.0)}%)`
            : `${displayed_min} - ${displayed_max} (${fixer(min_percent * 100.0)}% - ${fixer(max_percent * 100.0)}%)`

        data_text += `<a href="#" class="range range_clickable" onclick="show_range('${info_index}')">${displayed_range}</a>`

        if(turn_chances.some((chance) => chance > 0.0)) {
            let chances = Object.entries(turn_chances)
                .filter(([_, b]) => b > 0.0)

            if(move_data.effect === "EFFECT_OHKO" && chances.length > DISPLAYED_TURN_COUNT) {
                chances = chances.slice(0, DISPLAYED_TURN_COUNT)
                suggestions["ohko_max_turn"] = `Only the first ${DISPLAYED_TURN_COUNT} iterations are displayed for OHKO moves.`
            }
            else {
                chances = chances.slice(-DISPLAYED_TURN_COUNT)
            }

            for(const [t, chance] of chances) {
                const ti = parseInt(t)
                const prefix = `${ti + 1} ${turn_name}${ti === 0 ? "" : "s"}`

                data_text += `<div class="range_row">`
                data_text += `<div class="range_turns">${prefix}</div>`

                data_text += `<div class="range_percentage">`
                if(chance < 0.001) {
                    data_text += "&lt;0.1"
                }
                else if(chance >= 1.0) {
                    data_text += "100.0"
                }
                else if(chance > 0.999) {
                    data_text += "&gt;99.9"
                }
                else {
                    data_text += single_decimal(chance * 100.0)
                }
                data_text += `%</div></div>`
            }
        }
        else {
            data_text += `<div class="range_row">`
            data_text += `<div class=\"range_turns\">Out of range!</div>`
            data_text += `</div><br />`
            data_text += `<div class="range_row">`
            data_text += `<div class=\"range_turns\">Min ${turn_name}s</div>`
            data_text += `<div class=\"range_percentage\">${single_decimal(Math.max(stats_opposite.data.stats.hp / maximum, 1))}</div>`
            data_text += `</div>`
            data_text += `<div class="range_row">`
            data_text += `<div class=\"range_turns\">Avg ${turn_name}s</div>`
            data_text += `<div class=\"range_percentage\">${single_decimal(Math.max(stats_opposite.data.stats.hp / average, 1))}</div>`
            data_text += `</div>`
        }

        div_data.innerHTML = data_text

        // Highlight guaranteed or near-guaranteed OHKOs.
        // We do 0.99 instead of 1.0 to account for Gen 1 misses and moves with -1 accuracy with -1 evasion (254/256 = ~99.2%)
        if(turn_chances[0] > 0.99) {
            document.querySelector(div_selector).classList.add("ohko_move")
        }
        else if(best_ttk_rating != null && cmp_ttk(best_ttk_rating, data) === 0) {
            document.querySelector(div_selector).classList.add("best_move")
        }

        move_data_infos[info_index] = {
            data, move_name, move_data, is_player, stats, stats_opposite, displayed_range, properties, move_display_name
        }
    }

    if(stats.data.item === "Dragon Fang") {
        suggestions["dragon_fang_bug_note"] = "The Dragon Fang has no effect in Generation 2. Its effect was mistakenly given to the Dragon Scale."
    }

    for(const index of Object.keys(moves)) {
        const move_name = stats.data.moves[index]
        if(move_name === "NO_MOVE") {
            continue
        }
        switch(move_name) {
            case "STRUGGLE":
                suggestions["struggle_note"] = `Struggle is <u title="${QUASI_TYPELESS_NOTE}">Quasi-Typeless</u>.`
                break
        }

        const move_data = all_moves[move_name]
        switch(move_data.effect) {
            case "EFFECT_FUTURE_SIGHT":
                suggestions["future_sight_note"] = `Future Sight is <u title="${QUASI_TYPELESS_NOTE}">Quasi-Typeless</u>.`
                break
            case "EFFECT_BEAT_UP":
                suggestions["beat_up_note"] = `Beat Up is <u title="${QUASI_TYPELESS_NOTE}">Quasi-Typeless</u>.`
                suggestions["beat_up_ttk_note"] = `Beat Up damage does not account for any party members.`
                break
            case "EFFECT_PRESENT":
                suggestions["present_wip"] = `Present is not yet implemented.`
                break
        }
    }
}

function get_stats_box(is_player) {
    return is_player ? "#player_pokemon" : "#opponent_pokemon"
}

function recalculate_stats(is_player) {
    const stats = get_stats(is_player)
    const badges = get_badges(is_player)
    const recalculated = furretcalc.calculate_battle_stats(game, stats.stats, badges, stats.stages, stats.status)

    for(const stat of document.querySelectorAll(`${get_stats_box(is_player)} table.stat_input td`)) {
        for(const c of stat.classList) {
            switch(c) {
                case "hp_final":  stat.innerText = `${recalculated["hp"]} / ${stats.stats["max_hp"]}`; break;
                case "atk_final": stat.innerText = recalculated["attack"]; break;
                case "def_final": stat.innerText = recalculated["defense"]; break;
                case "spa_final": stat.innerText = recalculated["special_attack"]; break;
                case "spd_final": stat.innerText = recalculated["special_defense"]; break;
                case "spe_final": stat.innerText = recalculated["speed"]; break;
            }
        }
    }

    return {
        stats: recalculated,
        badges,
        data: stats
    }
}

function get_badges(is_player) {
    if(!is_player || document.getElementById("battle_type").value !== "ai") {
        return null
    }
    const badges = []
    for(const badge of document.getElementsByClassName("badge_checkbox")) {
        badges.push(badge.checked)
    }
    return badges
}

function get_stats(is_player) {
    const stats = {
        stats: {},
        dvs: {},
        statexp: {},
        stages: {},
        types: [null, null],
        screens: {
            reflect: false,
            light_screen: false
        },
        moves: ["NO_MOVE", "NO_MOVE", "NO_MOVE", "NO_MOVE"],
        species: null,
        item: null,
        status: null,
        level: null
    }
    let current_hp = ""
    for(const stat of document.querySelectorAll(`${get_stats_box(is_player)} input, ${get_stats_box(is_player)} select`)) {
        for(const c of stat.classList) {
            switch(c) {
                case "hp_stat": stats.stats["hp"] = parse_int_clamped(stat.value, 1, 999); break;
                case "atk_stat": stats.stats["attack"] = parse_int_clamped(stat.value, 1, 999); break;
                case "def_stat": stats.stats["defense"] = parse_int_clamped(stat.value, 1, 999); break;
                case "spa_stat": stats.stats["special_attack"] = parse_int_clamped(stat.value, 1, 999); break;
                case "spd_stat": stats.stats["special_defense"] = parse_int_clamped(stat.value, 1, 999); break;
                case "spe_stat": stats.stats["speed"] = parse_int_clamped(stat.value, 1, 999); break;

                case "atk_dv": stats.dvs["attack"] = parse_int_clamped(stat.value, 0, 15); break;
                case "def_dv": stats.dvs["defense"] = parse_int_clamped(stat.value, 0, 15); break;
                case "spc_dv": stats.dvs["special"] = parse_int_clamped(stat.value, 0, 15); break;
                case "spe_dv": stats.dvs["speed"] = parse_int_clamped(stat.value, 0, 15); break;

                case "hp_statexp": stats.statexp["hp"] = parse_int_clamped(stat.value, 0, 65535); break;
                case "atk_statexp": stats.statexp["attack"] = parse_int_clamped(stat.value, 0, 65535); break;
                case "def_statexp": stats.statexp["defense"] = parse_int_clamped(stat.value, 0, 65535); break;
                case "spc_statexp": stats.statexp["special"] = parse_int_clamped(stat.value, 0, 65535); break;
                case "spe_statexp": stats.statexp["speed"] = parse_int_clamped(stat.value, 0, 65535); break;

                case "atk_stage": stats.stages["attack"] = parse_int_clamped(stat.value, -6, 6); break;
                case "def_stage": stats.stages["defense"] = parse_int_clamped(stat.value, -6, 6); break;
                case "spa_stage": stats.stages["special_attack"] = parse_int_clamped(stat.value, -6, 6); break;
                case "spd_stage": stats.stages["special_defense"] = parse_int_clamped(stat.value, -6, 6); break;
                case "spe_stage": stats.stages["speed"] = parse_int_clamped(stat.value, -6, 6); break;
                case "acc_stage": stats.stages["accuracy"] = parse_int_clamped(stat.value, -6, 6); break;
                case "eva_stage": stats.stages["evasion"] = parse_int_clamped(stat.value, -6, 6); break;

                case "move_1": stats.moves[0] = stat.value; break;
                case "move_2": stats.moves[1] = stat.value; break;
                case "move_3": stats.moves[2] = stat.value; break;
                case "move_4": stats.moves[3] = stat.value; break;

                case "held_item": stats.item = stat.value; break;
                case "species": stats.species = stat.value; break;
                case "status": stats.status = stat.value; break;
                case "friendship": stats.friendship = stat.value; break;
                case "level": stats.level = parse_int_clamped(stat.value, 0, 255); break;
                case "current_hp": current_hp = stat.value; break;

                case "reflect": stats.screens.reflect = stat.checked; break;
                case "light_screen": stats.screens.light_screen = stat.checked; break;

                case "type_primary": stats.types[0] = furretcalc.util.Type[stat.value]; break;
                case "type_secondary": stats.types[1] = furretcalc.util.Type[stat.value]; break;
            }
        }
    }

    if(!manual_stat_input) {
        const base_stats = furretcalc.get_pokemon(game)[stats.species].base_stats
        stats.stats = furretcalc.util.calculate_monster_stats(stats.level, base_stats, stats.dvs, stats.statexp)
    }

    if(current_hp === "") {
        current_hp = "100%"
    }

    stats.stats.max_hp = stats.stats.hp
    stats.stats.hp = evaluate(stats.stats.max_hp, current_hp)

    return stats
}

function quickly_update_stats(is_player) {
    if(is_player === undefined) {
        quickly_update_stats(true)
        quickly_update_stats(false)
        return
    }

    const stats = get_stats(is_player)

    // TODO: make updating these faster
    document.querySelector(`${get_stats_box(is_player)} .spd_dv`).value = stats.dvs["special"]
    document.querySelector(`${get_stats_box(is_player)} .spd_statexp`).value = stats.statexp["special"]
    document.querySelector(`${get_stats_box(is_player)} .hp_dv`).value = furretcalc.util.calculate_hp_dv(stats.dvs)

    if(!manual_stat_input) {
        document.querySelector(`${get_stats_box(is_player)} .hp_stat`).value = stats.stats.max_hp
        document.querySelector(`${get_stats_box(is_player)} .atk_stat`).value = stats.stats.attack
        document.querySelector(`${get_stats_box(is_player)} .def_stat`).value = stats.stats.defense
        document.querySelector(`${get_stats_box(is_player)} .spa_stat`).value = stats.stats.special_attack
        document.querySelector(`${get_stats_box(is_player)} .spd_stat`).value = stats.stats.special_defense
        document.querySelector(`${get_stats_box(is_player)} .spe_stat`).value = stats.stats.speed
    }
}

async function set_up_widgets_initial() {
    document.getElementById("game").innerHTML = `
<optgroup label="Generation 1">
<option value="${furretcalc.util.Game.RedBlue}" disabled>Pokémon Red & Blue</option>
<option value="${furretcalc.util.Game.Yellow}" disabled>Pokémon Yellow Version: Special Pikachu Edition</option>
</optgroup>
<optgroup label="Generation 2">
<option value="${furretcalc.util.Game.GoldSilver}">Pokémon Gold & Silver</option>
<option value="${furretcalc.util.Game.Crystal}" selected>Pokémon Crystal Version</option>
</optgroup>
`
    document.getElementById("game").addEventListener("input", () => set_up_widgets())

    let stat_input_type_html = ``
    for(const v of Object.values(StatInputType)) {
        if(v === StatInputType.AutoSync) {
            try {
                await start_auto_sync_loop()
            } catch(e) {
                console.warn(`Failed to start auto-sync loop: ${e.message}`, e)
                stat_input_type_html += `<option disabled>${v} (Not connected: ${e.message})</option>`
                continue
            }
        }
        stat_input_type_html += `<option value="${v}">${v}</option>`
    }
    document.getElementById("stat_input_type").innerHTML = stat_input_type_html

    set_up_widgets()

}

function set_up_widgets() {
    game = get_current_game()
    generation = generation_of_game(game)

    const supported_items = Object.entries(furretcalc.get_supported_items(game))
    const items_are_supported = supported_items.length > 0

    let tabindex = 1

    // Add in stat placeholder stuff
    for(const placeholder of document.getElementsByClassName("pokemon_stats_placeholder")) {
        // smooth flowing from DVs to stats and then
        let stat_tabs = tabindex
        let misc_tabs = stat_tabs + 1

        placeholder.innerHTML = `
    <table class="stat_input">
    <tr>
        <th></th>
        <th>IVs</th>
        <th class="statexp_column">Stat EXP</th>
        <th>Stat</th>
        <th>Stage</th>
        <th>Final</th>
    </tr>
    <tr>
        <td title="Hitpoints">HP</td>
        <td><input type="text" class="hp_dv" value="0" tabindex="${stat_tabs}" readonly disabled></td>
        <td class="statexp_column"><input type="text" class="hp_statexp" value="0" tabindex="${stat_tabs}"></td>
        <td><input type="text" class="hp_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td>--</td>
        <td class="hp_final final_stat">--</td>
    </tr>
    <tr>
        <td title="Attack">ATK</td>
        <td><input type="text" class="atk_dv" value="0" tabindex="${stat_tabs}"></td>
        <td class="statexp_column"><input type="text" class="atk_statexp" value="0" tabindex="${stat_tabs}"></td>
        <td><input type="text" class="atk_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="atk_stage stat_stage" tabindex="${stat_tabs}"></select></td>
        <td class="atk_final final_stat">--</td>
    </tr>
    <tr>
        <td title="Defense">DEF</td>
        <td><input type="text" class="def_dv" value="0" tabindex="${stat_tabs}"></td>
        <td class="statexp_column"><input type="text" class="def_statexp" value="0" tabindex="${stat_tabs}"></td>
        <td><input type="text" class="def_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="def_stage stat_stage" tabindex="${stat_tabs}"></select></td>
        <td class="def_final final_stat">--</td>
    </tr>
    <tr>
        ${generation === Generation.Gen1 ? `<td title="Special (Special Attack and Special Defense)">SPC</td>` : `<td title="Special Attack">SPA</td>`}
        <td><input type="text" class="spc_dv" value="0" tabindex="${stat_tabs}"></td>
        <td class="statexp_column"><input type="text" class="spc_statexp" value="0" tabindex="${stat_tabs}"></td>
        <td><input type="text" class="spa_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spa_stage stat_stage" tabindex="${stat_tabs}"></select></td>
        <td class="spa_final final_stat">--</td>
    </tr>
    ${generation === Generation.Gen1 ? `` : `
    <tr>
        <td title="Special Defense">SPD</td>
        <td><input type="text" class="spd_dv" value="0" tabindex="${stat_tabs}" readonly disabled></td>
        <td class="statexp_column"><input type="text" class="spd_statexp" value="0" tabindex="${stat_tabs}" readonly disabled></td>
        <td><input type="text" class="spd_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spd_stage stat_stage" tabindex="${stat_tabs}"></select></td>
        <td class="spd_final final_stat">--</td>
    </tr>
    `}
    <tr>
        <td title="Speed">SPE</td>
        <td><input type="text" class="spe_dv" value="0" tabindex="${stat_tabs}"></td>
        <td class="statexp_column"><input type="text" class="spe_statexp" value="0" tabindex="${stat_tabs}"></td>
        <td><input type="text" class="spe_stat premultiplied_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spe_stage stat_stage" tabindex="${stat_tabs}"></select></td>
        <td class="spe_final final_stat">--</td>
    </tr>
    </table>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Species</span><select class="species" tabindex="${misc_tabs}"></select></div>
        ${items_are_supported ? `<div class="other_stat_inner"><span class="label">Held Item</span><select class="held_item" tabindex="${misc_tabs}"></select></div>` : ``}
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Level</span><input type="text" class="level" value="0" tabindex="${misc_tabs}" /></div>
        <div class="other_stat_inner"><span class="label">Friendship</span><input type="text" class="friendship" value="0" tabindex="${misc_tabs}" /></div>
        <div class="other_stat_inner"><span class="label">Status</span><select class="status" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Current HP</span><input type="text" class="current_hp" title="This can be a percentage (e.g. 100%), pixels (e.g. 48px), or a raw HP amount (e.g. 123).\n\nYou can also type a simple addition/subtraction expression (e.g. '100%-5' or '-5' or '-3-2' for max HP minus 5)." placeholder="100%" /></div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Type 1</span><select class="type_primary typing" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Type 2</span><select class="type_secondary typing" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Accuracy</span><select class="acc_stage stat_stage" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Evasion</span><select class="eva_stage stat_stage" tabindex="${misc_tabs}"></select></div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Move #1</span><select class="move_1 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #2</span><select class="move_2 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #3</span><select class="move_3 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #4</span><select class="move_4 move" tabindex="${misc_tabs}"></select></div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Reflect</span><div class="checkbox_filler"><input type="checkbox" class="reflect" /></div></div>
        <div class="other_stat_inner"><span class="label">Light Screen</span><div class="checkbox_filler"><input type="checkbox" class="light_screen" /></div></div>
    </div>
        `

        tabindex += 1000
    }

    let badge_html = ``
    let badge_count = 0
    let select_all_buttons = ``
    let list_index = 0
    const badge_lists = Object.entries(furretcalc.get_badge_list(game))
    for(const [badge_group, badges] of badge_lists) {
        badge_html += `<ul id="${badge_group}_badges" class="badge_box">`
        for(const badge of badges) {
            badge_html += `<li><input type="checkbox" id="badge_${badge_count}" class="badge_checkbox" tabindex="100" /><label for="badge_${badge_count}">${badge}</label></li>`
            badge_count++
        }
        list_index++
        if(list_index < badge_lists.length) {
            if(select_all_buttons === "") {
                select_all_buttons = `<li>&nbsp;</li>`
            }
            select_all_buttons += `<li><button onclick="select_all_badges('${badge_group}_badges')" tabindex="100">Select ${badge_group}</button></li>`
        }
        badge_html += "</ul>"
    }

    document.getElementById("badges_box_inner").innerHTML = `
${badge_html}
<div class="control_box">
<ul>
<li><button onclick="select_all_badges()" tabindex="100">Select all</button></li>
<li><button onclick="clear_all_badges()" tabindex="100">Clear all</button></li>
${select_all_buttons}
</ul>
</div>`

    // Fill out all stat stages
    let stat_stage_html = ""
    for(let i = 6; i >= -6; i--) {
        let text = `${i > 0 ? "+" : ""}${i}`
        stat_stage_html += `<option value="${i}"${i === 0 ? " selected" : ""}>${text}</option>`
    }
    for(const stat_stage of document.getElementsByClassName("stat_stage")) {
        stat_stage.innerHTML = stat_stage_html
    }

    // Fill out all statuses
    for(const status of document.getElementsByClassName("status")) {
        status.innerHTML = `
        <option value="OK">OK</option>
        <option value="${StatusCondition.BURN}">Burn</option>
        <option value="${StatusCondition.PARALYZE}">Paralysis</option>
        <option value="${StatusCondition.SLEEP}">Asleep</option>
        <option value="${StatusCondition.FREEZE}">Frozen</option>
        <option value="${StatusCondition.POISON}">Poison</option>
        `
    }

    if(items_are_supported) {
        let item_html = `<option value="None" selected>None / Other</option>`
        for(const [k,v] of Object.entries(furretcalc.get_supported_items(game))) {
            item_html += `<optgroup label="${k}">`

            for (const item of v) {
                item_html += `<option value="${item}">${item}</option>`
            }

            item_html += "</optgroup>"
        }

        for(const status of document.getElementsByClassName("held_item")) {
            status.innerHTML = item_html
        }
    }

    let typing_html = "<option selected>None</option>"
    for(const [key, value] of Object.entries(furretcalc.util.Type)) {
        typing_html += `<option value="${key}">${value}</option>`
    }
    for(const typing of document.getElementsByClassName("typing")) {
        typing.innerHTML = typing_html
    }

    // Fill out the species!!! (should be the same for both crystal and gold)
    let species_html = ""
    for(const [name, entry] of Object.entries(furretcalc.get_pokemon(game)).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const is_default = name === "FURRET" ? " selected" : ""
        species_html += `<option value="${name}"${is_default}>${entry.name}</option>`
    }
    for(const species of document.getElementsByClassName("species")) {
        species.innerHTML = species_html
    }

    // Fill out all moves
    const all_moves = furretcalc.get_moves(game)
    let all_move_html = ""
    for(const [k,v] of Object.entries(all_moves).toSorted()) {
        if(k === "NO_MOVE") {
            all_move_html = `<option value="${k}" selected>${v.name}</option>` + all_move_html
        }
        else {
            all_move_html += `<option value="${k}">${v.name}</option>`
        }
    }

    for(const c of document.getElementsByClassName("move")) {
        c.innerHTML = all_move_html
    }

    for(const c of document.getElementsByClassName("damage_outer")) {
        c.innerHTML = `
            <div class="stats_move_1 stats_move">
                <div class="stats_move_name"></div>
                <div class="stats_move_data"></div>
            </div>
            <div class="stats_move_2 stats_move">
                <div class="stats_move_name"></div>
                <div class="stats_move_data"></div>
            </div>
            <div class="stats_move_3 stats_move">
                <div class="stats_move_name"></div>
                <div class="stats_move_data"></div>
            </div>
            <div class="stats_move_4 stats_move">
                <div class="stats_move_name"></div>
                <div class="stats_move_data"></div>
            </div>
`
    }

    document.getElementById("stat_input_type").addEventListener("input", () => update_stat_input_type())

    for(const input of document.querySelectorAll("input")) {
        input.addEventListener("input", recalculate)
    }

    for(const input of document.querySelectorAll("select")) {
        if(input.id === "ai_preset_trainer" || input.id === "ai_preset_monster" || input.id === "game" || input.classList.contains("species")) {
            continue
        }
        input.addEventListener("input", recalculate)
    }

    document.getElementById("ai_preset_trainer").addEventListener("input", () => refresh_trainer_pokemon_selection())
    document.getElementById("ai_preset_trainer_class").addEventListener("input", () => refresh_trainer_list())
    document.getElementById("ai_preset_monster").addEventListener("input", () => refresh_trainer_pokemon_data())

    for(const species of document.querySelectorAll(`${get_stats_box(true)} .species`)) {
        species.addEventListener("input", () => { update_typings(true); recalculate() })
    }

    for(const species of document.querySelectorAll(`${get_stats_box(false)} .species`)) {
        species.addEventListener("input", () => { update_typings(false); recalculate() })
    }

    document.querySelector(`${get_stats_box(true)} .atk_dv`).value = 15
    document.querySelector(`${get_stats_box(true)} .def_dv`).value = 15
    document.querySelector(`${get_stats_box(true)} .spc_dv`).value = 15
    document.querySelector(`${get_stats_box(true)} .spe_dv`).value = 15

    // FIXME: REMOVE THIS ONCE DONE
    // dummy data
    document.querySelector(`${get_stats_box(true)} .level`).value = 5
    document.querySelector(`${get_stats_box(true)} .friendship`).value = 255
    document.querySelector(`${get_stats_box(true)} .move_1`).value = "SCRATCH"
    document.querySelector(`${get_stats_box(true)} .move_2`).value = "DEFENSE_CURL"
    document.querySelector(`${get_stats_box(true)} .move_3`).value = "QUICK_ATTACK"

    update_typings(true)
    update_typings(false)

    refresh_trainer_class_list(game)
    update_stat_input_type()
}

function update_stat_input_type() {
    const stat_input_type = document.getElementById(`stat_input_type`).value
    manual_stat_input = stat_input_type !== StatInputType.Calculate
    auto_sync = stat_input_type === StatInputType.AutoSync

    for(const c of document.querySelectorAll(`.statexp_column`)) {
        c.style.display = manual_stat_input ? "none" : ""
    }
    for(const c of document.querySelectorAll(`.premultiplied_stat`)) {
        c.readOnly = !manual_stat_input
        c.disabled = !manual_stat_input
    }
}



function refresh_trainer_class_list() {
    let options = ""

    const t = furretcalc.get_parties(game)
    const trainer_types = []

    for(const { name } of Object.values(t)) {
        if(!trainer_types.includes(name)) {
            trainer_types.push(name)
        }
    }

    const notable_npcs = ["Rival", "Leader", "Elite Four", "Champion", "Pokémon Trainer", "Lake of Rage Gyarados"]

    let inside_notable_npcs = true
    options += `<optgroup label="Notable NPCs">`
    
    for(const k of trainer_types.toSorted((a, b) => {
        let a_index = notable_npcs.indexOf(a)
        let b_index = notable_npcs.indexOf(b)

        if(a_index >= 0) {
            if(b_index >= 0) {
                return a_index - b_index
            }
            return -1
        }
        if(b_index >= 0) {
            return 1
        }
        return a.localeCompare(b)
    })) {
        if(inside_notable_npcs && !notable_npcs.includes(k)) {
            inside_notable_npcs = false
            options += "</optgroup>"
            options += `<optgroup label="Other NPCs">`
        }
        options += `<option value=\"${k}\">${k}</option>`
    }

    options += "</option>"

    document.getElementById("ai_preset_trainer_class").innerHTML = options
    refresh_trainer_list()
}

const RIVAL_LOCATIONS = Object.freeze({
    [1]: "Cherrygrove City",
    [2]: "Azalea Town",
    [3]: "Burned Tower",
    [4]: "Underground",
    [5]: "Victory Road",
    [6]: "Mt. Moon",
    [7]: "Indigo Plateau"
})
const CHIKORITA_LINE = Object.freeze(["CHIKORITA", "BAYLEEF", "MEGANIUM"])
const CYNDAQUIL_LINE = Object.freeze(["CYNDAQUIL", "QUILAVA", "TYPHLOSION"])
const TOTODILE_LINE = Object.freeze(["TOTODILE", "CROCONAW", "FERALIGATR"])

function refresh_trainer_list() {
    const search = document.getElementById("ai_preset_trainer_class").value
    const pokemon = furretcalc.get_pokemon(game)
    
    let options = ""

    const t = furretcalc.get_parties(game)
    const all = {}

    for(const [trainer_group, trainer_class] of Object.entries(t)) {
        // will is the juggler
        const jugger_will = search === "Juggler" && trainer_group === "WillGroup"

        // memes aside, this might actually be useful
        const e4_lance = search === "Elite Four" && trainer_group === "ChampionGroup"

        // could be nice to do this too
        const champion_red = search === "Champion" && trainer_group === "RedGroup"

        if(trainer_class.name !== search && !jugger_will && !e4_lance && !champion_red) {
            continue
        }

        for(const [trainer_index, {name}] of Object.entries(trainer_class.trainers)) {
            const search = `${trainer_group}-${trainer_index}`

            if(all[name] != null) {
                all[name].push(search)
            }
            else {
                all[name] = [search]
            }
        }
    }

    let sortedKeys = Object.keys(all)

    // Keep the Elite Four and Juggler in order
    if(search === "Elite Four") {
        let new_all = [null, null, null, null, null]
        for(const k of sortedKeys) {
            if(k === "Will") {
                new_all[0] = k
            }
            if(k === "Koga") {
                new_all[1] = k
            }
            if(k === "Bruno") {
                new_all[2] = k
            }
            if(k === "Karen") {
                new_all[3] = k
            }
            if(k === "Lance") {
                new_all[4] = k
            }
        }
        sortedKeys = new_all
    }
    else if(search === "Champion") {
        let new_all = [null, null]
        for(const k of sortedKeys) {
            if(k === "Lance") {
                new_all[0] = k
            }
            if(k === "Red") {
                new_all[1] = k
            }
        }
        sortedKeys = new_all
    }
    else {
        sortedKeys.sort()
    }

    // Put Red at the top of the list for Pokémon trainers
    if(search === "Pokémon Trainer") {
        const i = sortedKeys.findIndex((i) => i === "Red")
        if(i !== -1) {
            const taken = sortedKeys.splice(i, 1)
            sortedKeys.splice(0, 0, taken)
        }
    }
    
    for(const k of sortedKeys) {
        const v = all[k]
        if(v.length > 1) {
            if(search === "Rival") {
                let chikorita_count = 0;

                let split_rival = () => {
                    chikorita_count++
                    if(chikorita_count !== 1) {
                        options += "</optgroup>"
                    }
                    options += `<optgroup label="Rival #${chikorita_count} @ ${RIVAL_LOCATIONS[chikorita_count] ?? "Mystery Zone"}">`
                }

                for(const entry of Object.values(v)) {
                    const [group, index] = entry.split("-")
                    const { party } = t[group].trainers[parseInt(index)]
                    let trainer_type = "Unknown"

                    const starter = party.find(({species}) => CHIKORITA_LINE.includes(species) || TOTODILE_LINE.includes(species) || CYNDAQUIL_LINE.includes(species))

                    if(starter != null) {
                        if(CHIKORITA_LINE.includes(starter.species)) {
                            split_rival()
                        }
                        trainer_type = pokemon[starter.species].name
                    }

                    options += `<option value=${entry}>${k} #${chikorita_count} (${trainer_type})</option>`
                }
                options += "</optgroup>"
            }
            else {
                for(const [number,entry] of Object.entries(v)) {
                    options += `<option value=${entry}>${k} #${parseInt(number)+1}</option>`
                }
            }
        }
        else {
            options += `<option value=${v[0]}>${k}</option>`
        }
    }

    document.getElementById("ai_preset_trainer").innerHTML = options
    refresh_trainer_pokemon_selection()
}

function get_selected_team() {
    const value = document.getElementById("ai_preset_trainer").value
    const [group_name, index_str] = value.split("-")
    const teams = furretcalc.get_parties(game)
    const group = teams[group_name]
    if(group == null) {
        throw new Error(`Can't find group ${group_name}`)
    }
    let index = parseInt(index_str)
    const team = group.trainers[index]
    if(team == null) {
        throw new Error(`Can't find team ${index_str} of group ${group_name}`)
    }
    return {group, team}
}

function refresh_trainer_pokemon_selection() {
    const {team} = get_selected_team()
    if(team == null) {
        throw new Error("No team selected!")
    }
    
    const pokemon = furretcalc.get_pokemon(game)
    let options = ""
    for(const [index, member] of Object.entries(team.party)) {
        options += `<option value=\"${index}\">${parseInt(index) + 1}. ${pokemon[member.species].name} (Lv.${member.level})`
    }

    document.getElementById("ai_preset_monster").innerHTML = options

    refresh_trainer_pokemon_data()
}

function refresh_trainer_pokemon_data() {
    const {team, group} = get_selected_team()
    const selection = team.party[parseInt(document.getElementById("ai_preset_monster").value)]
    if(selection == null) {
        throw new Error("No monster selected!")
    }

    for(const element of document.querySelectorAll(`${get_stats_box(false)} input, ${get_stats_box(false)} select`)) {
        switch(element.classList[0]) {
            case "atk_stage": element.value = "0"; break;
            case "def_stage": element.value = "0"; break;
            case "spa_stage": element.value = "0"; break;
            case "spd_stage": element.value = "0"; break;
            case "spe_stage": element.value = "0"; break;
            case "acc_stage": element.value = "0"; break;
            case "eva_stage": element.value = "0"; break;

            case "hp_stat":  element.value = selection.stats["hp"]; break;
            case "atk_stat": element.value = selection.stats["attack"]; break;
            case "def_stat": element.value = selection.stats["defense"]; break;
            case "spa_stat": element.value = selection.stats["special_attack"]; break;
            case "spd_stat": element.value = selection.stats["special_defense"]; break;
            case "spe_stat": element.value = selection.stats["speed"]; break;

            case "atk_dv": element.value = group.dvs["attack"]; break;
            case "def_dv": element.value = group.dvs["defense"]; break;
            case "spc_dv": element.value = group.dvs["special"]; break;
            case "spe_dv": element.value = group.dvs["speed"]; break;

            case "hp_statexp": element.value = 0; break;
            case "atk_statexp": element.value = 0; break;
            case "def_statexp": element.value = 0; break;
            case "spc_statexp": element.value = 0; break;
            case "spd_statexp": element.value = 0; break;
            case "spe_statexp": element.value = 0; break;

            case "species": element.value = selection.species; break;
            case "item": element.value = selection.item; break;
            case "level": element.value = selection.level; break;
            case "friendship": element.value = 70; break;
            case "status": element.value = "OK"; break;

            case "move_1": element.value = selection.moves[0]; break;
            case "move_2": element.value = selection.moves[1]; break;
            case "move_3": element.value = selection.moves[2]; break;
            case "move_4": element.value = selection.moves[3]; break;
        }
    }
    update_typings(false)

    recalculate()
}

function clear_all_badges() {
    for(const c of document.getElementsByClassName("badge_checkbox")) {
        c.checked = false
    }
    recalculate()
}

function select_all_badges(of) {
    if(of == null) {
        for(const c of document.getElementsByClassName("badge_checkbox")) {
            c.checked = true
        }
    } else {
        for(const c of document.querySelectorAll(`#${of} .badge_checkbox`)) {
            c.checked = true
        }
    }
    recalculate()
}

function update_typings(is_player) {
    const species = document.querySelector(`${get_stats_box(is_player)} .species`).value
    const entry = furretcalc.get_pokemon(game)[species]

    document.querySelector(`${get_stats_box(is_player)} .type_primary`).value = entry.types[0]
    document.querySelector(`${get_stats_box(is_player)} .type_secondary`).value = entry.types[1] ?? "None"
}

function parse_int_clamped(value, min, max) {
    const int_value = parseInt(value)

    if(!isFinite(int_value)) {
        return min ?? 0
    }

    if(min != null && int_value < min) {
        return min
    }

    if(max != null && int_value > max) {
        return max
    }

    return int_value
}

function parse_float_clamped(value, min, max) {
    const float_value = parseFloat(value)

    if(!isFinite(float_value)) {
        return min ?? 0
    }

    if(min != null && float_value < min) {
        return min
    }

    if(max != null && float_value > max) {
        return max
    }

    return float_value
}

let currently_displayed_range = null

function show_range(info_index) {
    const range_details = document.getElementById("range_details")
    if(info_index == null || info_index === currently_displayed_range) {
        range_details.style.display = "none"
        currently_displayed_range = null
        return
    }

    currently_displayed_range = info_index
    reshow_range()
}

function reshow_range() {
    function stat_stage_to_string(stage, stat_name) {
        if(stage < 0) {
            return `${stage} ${stat_name}` // the minus is already there
        }
        if(stage > 0) {
            return `+${stage} ${stat_name}`
        }
        return ""
    }

    const range_details = document.getElementById("range_details")
    const infos = move_data_infos[currently_displayed_range]
    if(infos == null) {
        return
    }

    const all_pokemon = furretcalc.get_pokemon(game)

    const species_from_name = all_pokemon[infos.stats.data.species].name
    const species_to_name = all_pokemon[infos.stats_opposite.data.species].name

    let html = `<div id='range_header'><a href='#' onclick='show_range(null)'>(Close)</a></div>`
    const move_name = infos.move_display_name

    let attack_name
    let defense_name
    let attack
    let defense

    let attack_boost_info = []
    let defense_boost_info = []

    const badge_boosts = furretcalc.get_stat_badge_boost_badges(game)

    let attack_boost
    let defense_boost

    if(infos.data.is_physical) {
        attack_name = "ATK"
        defense_name = "DEF"
        attack = infos.stats.data.stats.attack
        defense = infos.stats_opposite.data.stats.defense
        attack_boost_info.push(stat_stage_to_string(infos.stats.data.stages.attack, attack_name))
        defense_boost_info.push(stat_stage_to_string(infos.stats_opposite.data.stages.defense, defense_name))

        attack_boost = infos.stats.badges?.[badge_boosts.Attack] ?? false
        defense_boost = infos.stats_opposite.badges?.[badge_boosts.Defense] ?? false
    }
    else {
        attack_name = generation === Generation.Gen1 ? "SPC" : "SPA"
        defense_name = generation === Generation.Gen1 ? "SPD" : "SPA"
        attack = infos.stats.data.stats.special_attack
        defense = infos.stats_opposite.data.stats.special_defense
        attack_boost_info.push(stat_stage_to_string(infos.stats.data.stages.special_attack, attack_name))
        defense_boost_info.push(stat_stage_to_string(infos.stats_opposite.data.stages.special_defense, defense_name))

        attack_boost = infos.stats.badges?.[badge_boosts.Special] ?? false
        defense_boost = (infos.stats_opposite.badges?.[badge_boosts.Special] ?? false) && furretcalc.receives_special_defense_boost(game, infos.stats_opposite.data.stats.special_attack)
    }

    if(attack_boost) {
        attack_boost_info.push(`+${attack_name}`)
    }
    if(defense_boost) {
        defense_boost_info.push(`+${defense_name}`)
    }

    attack_boost_info.push(stat_stage_to_string(infos.stats.data.stages.accuracy, "ACC"))
    defense_boost_info.push(stat_stage_to_string(infos.stats_opposite.data.stages.evasion, "EVA"))

    const badge_boost_index = furretcalc.get_type_badge_boost_badges(game)[infos.data.move_data.type]
    if(badge_boost_index != null && infos.stats.badges?.[badge_boost_index]) {
        attack_boost_info.push(`+${infos.data.move_data.type}-Badge`)
    }

    const item_data = furretcalc.get_items(game)[infos.stats.data.item]
    if(item_data != null && furretcalc.get_type_boost_items(game)[item_data.effect] === infos.data.move_data.type) {
        attack_boost_info.push(`+${infos.data.move_data.type}-Item`)
    }

    attack_boost_info = attack_boost_info.filter((a) => a != null && a !== "")
    defense_boost_info = defense_boost_info.filter((a) => a != null && a !== "")

    let attack_boost_text = ""
    let defense_boost_text = ""

    if(attack_boost_info.length > 0) {
        attack_boost_text = `[${attack_boost_info.join(", ")}]`
    }

    if(defense_boost_info.length > 0) {
        defense_boost_text = `[${defense_boost_info.join(", ")}]`
    }

    function format_chance_text(cutoff) {
        let chance_text = " -- "
        if(infos.data.turn_chances[0] >= 1.0) {
            chance_text += `Guaranteed OHKO`
        }
        else {
            let found = false
            for(const [k,v] of Object.entries(infos.data.turn_chances)) {
                if(v >= cutoff) {
                    if(v < 1.0) {
                        chance_text += `${single_decimal(v * 100)}% chance to `
                    }
                    else {
                        chance_text += `Guaranteed `
                    }

                    const iteration_index = parseInt(k) + 1
                    if(iteration_index === 1) {
                        chance_text += "OHKO"
                    }
                    else if(infos.properties.per_hit) {
                        // can't call it a XHKO because we factor in accuracy, and missing is not hitting
                        chance_text += `KO in ${iteration_index} attacks`
                    }
                    else {
                        chance_text += `KO in ${iteration_index} turns`
                    }

                    found = true
                    break
                }
            }

            if(!found) {
                chance_text += `KO in ${single_decimal(infos.stats_opposite.stats.hp / infos.data.rolls.average)} turns on average`
            }
        }

        const hp_display = (infos.stats_opposite.data.stats.max_hp === infos.stats_opposite.data.stats.hp) ? infos.stats_opposite.data.stats.max_hp : `${infos.stats_opposite.data.stats.hp} / ${infos.stats_opposite.data.stats.max_hp}`

        return `Lvl. ${infos.stats.data.level} • ${attack} ${attack_name} ${attack_boost_text} ${species_from_name} ${move_name} vs. ${hp_display} HP • ${defense} ${defense_name} ${defense_boost_text} ${species_to_name}: ${infos.displayed_range}${chance_text}`
    }

    const fifty_fifty = format_chance_text(0.5)
    const better = format_chance_text(infos.properties.cutoff)

    html += `<h2>Ranges For ${infos.is_player ? "" : "Opponent's"} ${move_name}</h2>`
    if(fifty_fifty !== better) {
        html += `<div class="copypasta">${fifty_fifty}</div>`
    }
    html += `<div class="copypasta">${better}</div>`
    html += "<table><tr><th>Damage</th><th>Probability</th></tr>"
    if(infos.data.rolls.accuracy < 1.0) {
        html += `<tr><td>Miss</td><td>${single_decimal(100 - 100 * infos.data.rolls.accuracy)}%</td>`
    }
    for(const [damage, probability] of infos.data.rolls.rolls) {
        html += `<tr><td>${damage}</td><td>${single_decimal(probability * 100 * infos.data.rolls.accuracy)}%</td>`
    }
    html += "</table>"

    range_details.innerHTML = html

    range_details.style.display = "block"
}

window.clear_all_badges = clear_all_badges
window.select_all_badges = select_all_badges
window.show_range = show_range
window.show_instructions = () => {
    document.getElementById("instructions").style.display = "block"
    document.getElementById("instructions_show").style.display = "none"
}

function single_decimal(number) {
    return (Math.floor(Math.abs(number) * 10) / 10 * (number < 0 ? -1 : 1)).toFixed(1)
}

function no_decimal(number) {
    return (Math.floor(Math.abs(number)) * (number < 0 ? -1 : 1)).toFixed(0)
}

function get_current_game() {
    return document.getElementById("game").value
}

function evaluate(starting_value, expression) {
    const expression_cleaned = expression.replace(/\s/g,'')
    if(!expression_cleaned) {
        return starting_value
    }

    const values = expression_cleaned.split(/(\-|\+)/g)
    if(values.length === 0) {
        return starting_value
    }

    if(values[0] === "") {
        values[0] = "" + starting_value
    }

    let current_value = null
    let current_operator = null
    for(const i in values) {
        const string_value = values[i]
        if(!string_value) {
            return starting_value
        }

        if(current_operator == null && current_value != null) {
            current_operator = string_value
            continue
        }

        let actual_value = null
        if(string_value.endsWith("%")) {
            actual_value = starting_value * parseFloat(string_value.split("%")[0]) / 100.0
        }
        else if(string_value.endsWith("px")) {
            actual_value = starting_value * parseInt(string_value.split("px")[0]) / 48
        }
        else {
            actual_value = parseInt(string_value)
        }

        if(!isFinite(actual_value)) {
            console.log(`failed to parse expression (error on #${i}):`, values)
            return starting_value
        }
        
        switch(current_operator) {
            case "+": current_value += actual_value; break;
            case "-": current_value -= actual_value; break;
            case null: current_value = actual_value; break;
            default: console.log(`unknown operator ${current_operator}`)
        }

        current_operator = null
    } 

    return Math.max(Math.min(Math.round(current_value), starting_value), 1)
}

const StatInputType = {
    Calculate: "Calculate",
    Manual: "Manual",
    AutoSync: "Auto-Sync",
}

let client = null
let stat_getter = null

async function start_auto_sync_loop() {
    try {
        client = new GameHookMapperClient();
        await client.connect()
    } catch(e) {
        throw new Error("Failed to instantiate client")
    }

    window.gamehook = client

    const generation = client.properties.meta.generation
    if(generation == null) {
        throw new Error("Mapper is missing properties (unsupported mapper)")
    }

    const mapper_type = client.properties.meta.mapperType
    if(mapper_type != null && mapper_type.value === "Deprecated") {
        switch(generation.value) {
            case "1": throw new Error("Gen 1 is not supported yet")
            case "2": {
                stat_getter = new StatGetterDeprecated(client)
                break
            }
            default: throw new Error(`Unsupported generation ${generation.value}`)
        }
    }
    else {
        switch(generation.value) {
            case "1": throw new Error("Gen 1 is not supported yet")
            case "2": {
                stat_getter = new StatGetter(client)
                break
            }
            default: throw new Error(`Unsupported generation ${generation.value}`)
        }
    }

    setInterval(stat_loop, 1000)
}

function stat_loop() {
    if(!auto_sync) {
        return
    }

    const all_moves = Object.keys(furretcalc.get_moves(game))
    const all_species = Object.keys(furretcalc.get_pokemon(game))

    const badges = stat_getter.get_badges()
    for(const b in badges) {
        document.getElementById(`badge_${b}`).checked = badges[b]
    }

    const field = stat_getter.get_weather()
    document.getElementById("weather").value = field || "Clear"

    function update_stats(is_player) {
        const stats = stat_getter.get_stats(is_player)
        const box = get_stats_box(is_player)

        for(const c of document.querySelectorAll(`${box} *`)) {
            for(const cl of c.classList) {
                switch(cl) {
                    case "hp_stat": {
                        c.value = stats.max_hp
                        break
                    }
                    case "current_hp": {
                        c.value = stats.hp
                        break
                    }
                    case "atk_dv": {
                        c.value = stats.attack_dv
                        break
                    }
                    case "def_dv": {
                        c.value = stats.defense_dv
                        break
                    }
                    case "spd_dv":
                    case "spa_dv": {
                        c.value = stats.special_dv
                        break
                    }
                    case "spe_dv": {
                        c.value = stats.speed_dv
                        break
                    }
                    case "atk_stat": {
                        c.value = stats.attack
                        break
                    }
                    case "def_stat": {
                        c.value = stats.defense
                        break
                    }
                    case "spa_stat": {
                        c.value = stats.special_attack
                        break
                    }
                    case "spd_stat": {
                        c.value = stats.special_defense
                        break
                    }
                    case "spe_stat": {
                        c.value = stats.speed
                        break
                    }
                    case "level": {
                        c.value = stats.level
                        break
                    }
                    case "atk_stage": {
                        c.value = stats.attack_stage
                        break
                    }
                    case "def_stage": {
                        c.value = stats.defense_stage
                        break
                    }
                    case "spa_stage": {
                        c.value = stats.special_attack_stage
                        break
                    }
                    case "spd_stage": {
                        c.value = stats.special_defense_stage
                        break
                    }
                    case "spe_stage": {
                        c.value = stats.speed_stage
                        break
                    }
                    case "acc_stage": {
                        c.value = stats.accuracy_stage
                        break
                    }
                    case "eva_stage": {
                        c.value = stats.evasion_stage
                        break
                    }
                    case "type_primary": {
                        c.value = stats.types[0]
                        break
                    }
                    case "type_secondary": {
                        c.value = stats.types[1]
                        break
                    }
                    case "friendship": {
                        c.value = stats.friendship
                        break
                    }
                    case "move_1": {
                        c.value = all_moves[stats.moves[0]]
                        break
                    }
                    case "move_2": {
                        c.value = all_moves[stats.moves[1]]
                        break
                    }
                    case "move_3": {
                        c.value = all_moves[stats.moves[2]]
                        break
                    }
                    case "move_4": {
                        c.value = all_moves[stats.moves[3]]
                        break
                    }
                    case "species": {
                        c.value = all_species[stats.species]
                        break
                    }
                    case "status": {
                        c.value = stats.status || "OK"
                        break
                    }
                    case "reflect": {
                        c.checked = stats.reflect
                        break
                    }
                    case "light_screen": {
                        c.checked = stats.light_screen
                        break
                    }
                    case "held_item": {
                        c.value = Object.entries(furretcalc.get_items(game)).find(([_,v]) => v.index === stats.item + 1)?.[0] || "None"
                        break
                    }
                }
            }
        }
    }

    update_stats(false)
    update_stats(true)

    actually_recalculate()
}

class StatGetter {
    get_weather() {
        return client.properties.battle.field.weather.value
    }

    get_badges() {
        return client.properties.player.badges.map((badge) => badge.value)
    }

    get_stats(player) {
        const [party_member, active_member, field] = this._get_stats_for_side(player)
        const types = [
            active_member.type_1.value.toUpperCase(),
            active_member.type_2.value.toUpperCase(),
        ]

        if(types[1] === types[0]) {
            types[1] = "None"
        }

        return {
            species: party_member.species.bytes[0] - 1,
            item: (active_member.held_item || party_member.held_item).bytes[0] - 1,

            moves: [
                active_member.moves[0].move.bytes[0],
                active_member.moves[1].move.bytes[0],
                active_member.moves[2].move.bytes[0],
                active_member.moves[3].move.bytes[0]
            ],
            level: party_member.level.value,
            hp: active_member.stats.hp.value,
            max_hp: party_member.stats.hp_max.value,
            status: party_member.status_condition.value,

            attack: party_member.stats.attack.value,
            defense: party_member.stats.defense.value,
            special_attack: party_member.stats.special_attack.value,
            special_defense: party_member.stats.special_defense.value,
            speed: party_member.stats.speed.value,

            attack_dv: party_member.ivs.attack.value,
            defense_dv: party_member.ivs.defense.value,
            special_dv: party_member.ivs.special.value,
            speed_dv: party_member.ivs.speed.value,

            friendship: party_member.friendship.value,

            attack_stage: active_member.modifiers.attack.value,
            defense_stage: active_member.modifiers.defense.value,
            special_attack_stage: active_member.modifiers.special_attack.value,
            special_defense_stage: active_member.modifiers.special_defense.value,
            speed_stage: active_member.modifiers.speed.value,
            accuracy_stage: active_member.modifiers.accuracy.value,
            evasion_stage: active_member.modifiers.evasion.value,

            reflect: field.reflect.value,
            light_screen: field.lightscreen.value,

            types
        }
    }

    _get_stats_for_side(player) {
        if(player) {
            return [
                client.properties.player.team[client.properties.player.party_position.value],
                client.properties.player.active_pokemon,
                client.properties.battle.field.player
            ]
        }
        else {
            return [
                client.properties.battle.opponent.team[client.properties.battle.opponent.party_position.value],
                client.properties.battle.opponent.active_pokemon,
                client.properties.battle.field.opponent
            ]
        }
    }
}

class StatGetterDeprecated {
    get_weather() {
        return client.properties.battle.weather.weatherType.value
    }

    get_badges() {
        return Object.values(client.properties.player.badges).map((badge) => badge.value)
    }

    get_stats(player) {
        const [party_member, active_member, field] = this._get_stats_for_side(player)
        const types = [
            active_member.type1.value.toUpperCase(),
            active_member.type2.value.toUpperCase(),
        ]

        if(types[1] === types[0]) {
            types[1] = "None"
        }

        return {
            species: party_member.species.bytes[0] - 1,
            item: (active_member.heldItem || party_member.heldItem).bytes[0] - 1,

            moves: [
                active_member.move1.bytes[0],
                active_member.move2.bytes[0],
                active_member.move3.bytes[0],
                active_member.move4.bytes[0]
            ],
            level: party_member.level.value,
            hp: active_member.hp.value,
            max_hp: party_member.maxHp.value,
            status: party_member.statusCondition.value,

            attack: party_member.attack.value,
            defense: party_member.defense.value,
            special_attack: party_member.specialAttack.value,
            special_defense: party_member.specialDefense.value,
            speed: party_member.speed.value,

            attack_dv: party_member.dvAttack.value,
            defense_dv: party_member.dvDefense.value,
            special_dv: party_member.dvSpecial.value,
            speed_dv: party_member.dvSpeed.value,

            friendship: party_member.friendship.value,

            attack_stage: active_member.modStageAttack.value,
            defense_stage: active_member.modStageDefense.value,
            special_attack_stage: active_member.modStageSpecialAttack.value,
            special_defense_stage: active_member.modStageSpecialDefense.value,
            speed_stage: active_member.modStageSpeed.value,
            accuracy_stage: active_member.modStageAccuracy.value,
            evasion_stage: active_member.modStageEvasion.value,

            reflect: field.statusReflect.value,
            light_screen: field.statusLightScreen.value,

            types
        }
    }

    _get_stats_for_side(player) {
        if(player) {
            return [
                client.properties.player.team[client.properties.battle.yourPokemon.partyPos.value],
                client.properties.battle.yourPokemon,
                client.properties.battle.field.player
            ]
        }
        else {
            return [
                client.properties.battle.trainer.team[client.properties.battle.enemyPokemon.partyPos.value],
                client.properties.battle.enemyPokemon,
                client.properties.battle.field.enemy
            ]
        }
    }
}
