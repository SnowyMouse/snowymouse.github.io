"use strict"

import * as furretcalc from "./furretcalc/furretcalc.js"

furretcalc.load_furretcalc("./js/furretcalc")
    .then(() => set_up_widgets())

let is_calculating = false

let debounce_timer = null
function recalculate() {
    if(is_calculating) {
        return
    }

    if(debounce_timer != null) {
        clearTimeout(debounce_timer)
    }

    debounce_timer = setTimeout(actually_recalculate, 500)
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

        const player_stats = recalculate_stats(true)
        const opponent_stats = recalculate_stats(false)

        let max_rolls = parseInt(document.getElementById("settings_max_damage_rolls").value)
        if(!isFinite(max_rolls) || max_rolls < 1) { max_rolls = 100 }
        let max_turns = parseInt(document.getElementById("settings_max_turns").value)
        if(!isFinite(max_turns) || max_turns < 1) { max_turns = 100 }
        let target_ko_chance = parseFloat(document.getElementById("settings_ko_chance").value)
        if(!isFinite(target_ko_chance) || target_ko_chance < 0.0) { max_turns = 0.0 }
        if(target_ko_chance > 100.0) { target_ko_chance = 100.0 }

        const properties = {
            per_hit: document.getElementById("settings_per_turn").value === "per_hit",
            weather: document.getElementById("weather").value,
            max_rolls,
            max_turns,
            cutoff: target_ko_chance / 100.0
        }

        const warnings = {}

        const start_time = performance.now()

        const player_moves = furretcalc.calculate_damage_for_all_moves(player_stats, opponent_stats, warnings, properties)
        const opponent_moves = furretcalc.calculate_damage_for_all_moves(opponent_stats, player_stats, warnings, properties)

        const end_time = performance.now()

        console.debug(`Calculation time: ${end_time - start_time} ms`)

        for(const data of document.getElementsByClassName("stats_move_name")) {
            data.innerHTML = ""
        }

        for(const data of [...document.getElementsByClassName("ohko_move")]) {
            data.classList.remove("ohko_move")
        }

        for(const data of [...document.getElementsByClassName("best_move")]) {
            data.classList.remove("best_move")
        }

        for(const data of document.getElementsByClassName("stats_move_data")) {
            data.innerHTML = ""
        }

        const suggestions = {}

        for(const [warning_key, warning_text] of Object.entries(warnings)) {
            suggestions[`warning_${warning_key}`] = warning_text
        }

        format_move_data("#player_damage", player_stats, opponent_stats, player_moves, true, suggestions, properties.per_hit)
        format_move_data("#enemy_damage", opponent_stats, player_stats, opponent_moves, false, suggestions, properties.per_hit)

        const notes = document.getElementById("suggestions_and_notes_list")
        let html = ""

        for(const v of Object.values(suggestions)) {
            html += `<li>${v}</li>`
        }

        notes.innerHTML = html
    }
    finally {
        is_calculating = false
    }
}

const QUASI_TYPELESS_NOTE = "This move does not receive STAB, type-based badge boosts, weather boosts (or nerfs), or type effectiveness (it does not interact with your opponent's types).\n\nHowever, its typing is still used for determining damage category and item boosts."
const DISPLAYED_TURN_COUNT = 4

function format_move_data(base_div, stats, stats_opposite, moves, is_player, suggestions, per_hit) {
    const turn_name = per_hit ? "hit" : "turn"

    const all_moves = furretcalc.get_moves()

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
        const move_name = stats.data.moves[index]
        if(move_name === "NO_MOVE") {
            continue
        }
        const move_data = all_moves[move_name]
        if(move_data == null) {
            continue
        }

        let move_display_name = move_data.name
        if(move_data.effect === "EFFECT_HIDDEN_POWER") {
            const { base_power, type } = furretcalc.get_hidden_power_stats(stats.data.dvs)
            const note = (stats.data.dvs.attack === 0 && stats.data.dvs.defense === 0 && stats.data.dvs.special === 0 && stats.data.dvs.speed === 0) ? "(all-zero IVs (DVs) set)" : ""
            suggestions[`hidden_power_${is_player ? "player": "opponent"}`] = `Calculated ${is_player ? "your" : "opponent's"} Hidden Power as a ${type}-type move with ${base_power} base power${note}.`

            move_display_name = `${move_display_name} ${type}`
        }

        document.querySelector(`${base_div} .stats_move_${parseInt(index) + 1} .stats_move_name`).innerHTML = move_display_name

        const div_selector = `${base_div} .stats_move_${parseInt(index) + 1}`
        const div_data = document.querySelector(`${div_selector} .stats_move_data`)

        if(typeof data === "string") {
            div_data.innerHTML = `<span class="range">${data}</span>`
            document.querySelector(div_selector).classList.add("error_move")
            continue
        }

        if(data == null) {
            continue
        }
        const {base_low, base, maximum, turn_chances, average} = data

        let data_text = "";

        const min_percent = base_low / stats_opposite.stats.hp
        const base_percent = base / stats_opposite.stats.hp

        const fixedAmount = base_percent >= 10.0 ? 0 : 1

        if(base_low === base) {
            data_text += `<span class="range">${(min_percent * 100.0).toFixed(fixedAmount)}% (${base_low})</span>`
        }
        else {
            data_text += `<span class="range">${(min_percent * 100.0).toFixed(fixedAmount)}% - ${(base_percent * 100.0).toFixed(fixedAmount)}% (${base_low} - ${base})</span>`
        }

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
                const prefix = `${parseInt(t) + 1} ${turn_name}${t === "0" ? "" : "s"}`

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
                    data_text += (chance * 100.0).toFixed(1)
                }
                data_text += `%</div><br />`
            }
        }
        else {
            data_text += `<div class=\"range_turns\">Out of range!</div><br /><br />`
            data_text += `<div class=\"range_turns\">Min ${turn_name}s</div>`
            data_text += `<div class=\"range_percentage\">${(stats_opposite.data.stats.hp / maximum).toFixed(1)}</div><br />`
            data_text += `<div class=\"range_turns\">Avg ${turn_name}s</div>`
            data_text += `<div class=\"range_percentage\">${(stats_opposite.data.stats.hp / average).toFixed(1)}</div><br />`
        }

        div_data.innerHTML = data_text

        if(turn_chances[0] >= 0.996) {
            document.querySelector(div_selector).classList.add("ohko_move")
        }
        else if(best_ttk_rating != null && cmp_ttk(best_ttk_rating, data) === 0) {
            document.querySelector(div_selector).classList.add("best_move")
        }
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

        if(furretcalc.HIGH_CRIT_MOVES.includes(move_name)) {
            suggestions["crit_note"] = "High-crit moves aren't implemented yet."
        }

        const move_data = all_moves[move_name]
        switch(move_data.effect) {
            case "EFFECT_FUTURE_SIGHT":
                suggestions["future_sight_note"] = `Future Sight is <u title="${QUASI_TYPELESS_NOTE}">Quasi-Typeless</u>.`
                if(!per_hit) {
                    suggestions["future_sight_ttk_note"] = `Future Sight's delay until damage is dealt is not yet implemented.`
                }
                break
            case "EFFECT_BEAT_UP":
                suggestions["beat_up_note"] = `Beat Up is <u title="${QUASI_TYPELESS_NOTE}">Quasi-Typeless</u>.`
                suggestions["beat_up_ttk_note"] = `Beat Up damage does not account for any party members.`
                break
            case "EFFECT_ROLLOUT":
                suggestions["rollout_wip"] = `Rollout is not yet implemented. Damage displayed is only for the first hit.`
                break
            case "EFFECT_FURY_CUTTER":
                suggestions["fury_cutter_wip"] = `Fury Cutter is not yet implemented. Damage displayed is only for the first hit.`
                break
            case "EFFECT_SOLARBEAM":
            case "EFFECT_FLY":
            case "EFFECT_DIG":
                if(!per_hit) {
                    suggestions["charge_wip"] = `Moves with charging periods are not yet implemented. Damage displayed is per hit.`
                }
                break
            case "EFFECT_HYPER_BEAM":
                if(!per_hit) {
                    suggestions["hyper_beam_wip"] = `Hyper Beam's recharge period is not factored in. Damage displayed is per hit.`
                }
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
    const recalculated = furretcalc.calculate_battle_stats(stats.stats, badges, stats.stages, stats.status)

    for(const stat of document.querySelectorAll(`${get_stats_box(is_player)} table.stat_input td`)) {
        for(const c of stat.classList) {
            switch(c) {
                case "hp_final":  stat.innerText = recalculated["hp"]; break;
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

function cleanup_number_value(value, min, max) {
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

function get_badges(is_player) {
    if(!is_player || document.getElementById("battle_type").value !== "ai") {
        return null
    }
    const badges = []
    for(let i = 1; i <= 8; i++) {
        badges.push(document.getElementById(`johto_badge_${i}`).checked)
    }
    for(let i = 1; i <= 8; i++) {
        badges.push(document.getElementById(`kanto_badge_${i}`).checked)
    }
    return badges
}

function get_stats(is_player) {
    const stats = {
        stats: {},
        dvs: {},
        stages: {},
        types: [null, null],
        moves: ["NO_MOVE", "NO_MOVE", "NO_MOVE", "NO_MOVE"],
        species: null,
        item: null,
        status: null,
        level: null
    }
    for(const stat of document.querySelectorAll(`${get_stats_box(is_player)} input, ${get_stats_box(is_player)} select`)) {
        for(const c of stat.classList) {
            switch(c) {
                case "hp_stat": stats.stats["hp"] = cleanup_number_value(stat.value, 1, 999); break;
                case "atk_stat": stats.stats["attack"] = cleanup_number_value(stat.value, 1, 999); break;
                case "def_stat": stats.stats["defense"] = cleanup_number_value(stat.value, 1, 999); break;
                case "spa_stat": stats.stats["special_attack"] = cleanup_number_value(stat.value, 1, 999); break;
                case "spd_stat": stats.stats["special_defense"] = cleanup_number_value(stat.value, 1, 999); break;
                case "spe_stat": stats.stats["speed"] = cleanup_number_value(stat.value, 1, 999); break;
                
                case "atk_dv": stats.dvs["attack"] = cleanup_number_value(stat.value, 0, 15); break;
                case "def_dv": stats.dvs["defense"] = cleanup_number_value(stat.value, 0, 15); break;
                case "spc_dv": stats.dvs["special"] = cleanup_number_value(stat.value, 0, 15); break;
                case "spe_dv": stats.dvs["speed"] = cleanup_number_value(stat.value, 0, 15); break;

                case "atk_stage": stats.stages["attack"] = cleanup_number_value(stat.value, -6, 6); break;
                case "def_stage": stats.stages["defense"] = cleanup_number_value(stat.value, -6, 6); break;
                case "spa_stage": stats.stages["special_attack"] = cleanup_number_value(stat.value, -6, 6); break;
                case "spd_stage": stats.stages["special_defense"] = cleanup_number_value(stat.value, -6, 6); break;
                case "spe_stage": stats.stages["speed"] = cleanup_number_value(stat.value, -6, 6); break;

                case "move_1": stats.moves[0] = stat.value; break;
                case "move_2": stats.moves[1] = stat.value; break;
                case "move_3": stats.moves[2] = stat.value; break;
                case "move_4": stats.moves[3] = stat.value; break;

                case "item": stats.item = stat.value; break;
                case "species": stats.species = stat.value; break;
                case "status": stats.status = stat.value; break;
                case "friendship": stats.friendship = stat.value; break;
                case "level": stats.level = parseInt(stat.value); break;

                case "type_primary": stats.types[0] = furretcalc.Type[stat.value]; break;
                case "type_secondary": stats.types[1] = furretcalc.Type[stat.value]; break;
            }
        }
    }

    if(!isFinite(stats.level)) {
        stats.level = 1
    }

    return stats
}

function set_up_widgets() {
    let tabindex = 1

    // Add in stat placeholder stuff
    for(const placeholder of document.getElementsByClassName("pokemon_stats_placeholder")) {
        // smooth flowing from DVs to stats and then
        let dv_tabs = tabindex
        let stat_tabs = dv_tabs + 1
        let stage_tabs = stat_tabs + 1
        let misc_tabs = stage_tabs + 1


        placeholder.innerHTML = `
    <table class="stat_input">
    <tr>
        <th></th>
        <th>IVs</th>
        <th>Stat</th>
        <th>Stage</th>
        <th>Final</th>
    </tr>
    <tr>
        <td title="Hitpoints">HP</td>
        <td>--</td>
        <td><input type="text" class="hp_stat" value="0" tabindex="${stat_tabs}"></td>
        <td>--</td>
        <td class="hp_final">--</td>
    </tr>
    <tr>
        <td title="Attack">ATK</td>
        <td><input type="text" class="atk_dv" value="0" tabindex="${dv_tabs}"></td>
        <td><input type="text" class="atk_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="atk_stage stat_stage" tabindex="${stage_tabs}"></select></td>
        <td class="atk_final">--</td>
    </tr>
    <tr>
        <td title="Defense">DEF</td>
        <td><input type="text" class="def_dv" value="0" tabindex="${dv_tabs}"></td>
        <td><input type="text" class="def_stat" value="0" tabindex="${stat_tabs}"</td>
        <td><select class="def_stage stat_stage" tabindex="${stage_tabs}"></select></td>
        <td class="def_final">--</td>
    </tr>
    <tr>
        <td title="Special Attack">SPA</td>
        <td><input type="text" class="spc_dv" value="0" tabindex="${dv_tabs}"></td>
        <td><input type="text" class="spa_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spa_stage stat_stage" tabindex="${stage_tabs}"></select></td>
        <td class="spa_final">--</td>
    </tr>
    <tr>
        <td title="Special Defense">SPD</td>
        <td>--</td>
        <td><input type="text" class="spd_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spd_stage stat_stage" tabindex="${stage_tabs}"></select></td>
        <td class="spd_final">--</td>
    </tr>
    <tr>
        <td title="Speed">SPE</td>
        <td><input type="text" class="spe_dv" value="0" tabindex="${dv_tabs}"></td>
        <td><input type="text" class="spe_stat" value="0" tabindex="${stat_tabs}"></td>
        <td><select class="spe_stage stat_stage" tabindex="${stage_tabs}"></select></td>
        <td class="spe_final">--</td>
    </tr>
    </table>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Species</span><select class="species" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Item</span><select class="item" tabindex="${misc_tabs}"></select></div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Type 1</span><select class="type_primary typing" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Type 2</span><select class="type_secondary typing" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Status</span><select class="status" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner">&nbsp;</div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Move #1</span><select class="move_1 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #2</span><select class="move_2 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #3</span><select class="move_3 move" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Move #4</span><select class="move_4 move" tabindex="${misc_tabs}"></select></div>
    </div>
    <div class="other_stats">
        <div class="other_stat_inner"><span class="label">Level</span><input type="text" class="level" value="0" tabindex="${misc_tabs}" /></div>
        <div class="other_stat_inner"><span class="label">Friendship</span><input type="text" class="friendship" value="0" tabindex="${misc_tabs}" /></div>
        <div class="other_stat_inner"><span class="label">Accuracy</span><select class="acc_stage stat_stage" tabindex="${misc_tabs}"></select></div>
        <div class="other_stat_inner"><span class="label">Evasion</span><select class="eva_stage stat_stage" tabindex="${misc_tabs}"></select></div>
    </div>
        `

        tabindex += 1000
    }

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
        <option value="ok">OK / Other</option>
        <option value="burned">Burn</option>
        <option value="paralyzed">Paralysis</option>
        `
    }

    let typing_html = "<option selected>None</option>"
    for(const [key, value] of Object.entries(furretcalc.Type)) {
        typing_html += `<option value="${key}">${value}</option>`
    }
    for(const typing of document.getElementsByClassName("typing")) {
        typing.innerHTML = typing_html
    }

    // Fill out the species!!! (should be the same for both crystal and gold)
    let species_html = ""
    for(const [name, entry] of Object.entries(furretcalc.get_crystal_pokemon()).sort((a, b) => a[1].name.localeCompare(b[1].name))) {
        const is_default = name === "FURRET" ? " selected" : ""
        species_html += `<option value="${name}"${is_default}>${entry.name}</option>`
    }
    for(const species of document.getElementsByClassName("species")) {
        species.innerHTML = species_html
    }

    // Fill out all moves
    const all_moves = furretcalc.get_moves()
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

    for(const input of document.querySelectorAll("input")) {
        input.addEventListener("input", recalculate)
    }

    for(const input of document.querySelectorAll("select")) {
        if(input.id === "ai_preset_trainer" || input.id === "ai_preset_monster" || input.id === "ai_preset_game" || input.classList.contains("species")) {
            continue
        }
        input.addEventListener("input", recalculate)
    }

    document.getElementById("ai_preset_trainer").addEventListener("input", () => refresh_trainer_pokemon_selection())
    document.getElementById("ai_preset_trainer_class").addEventListener("input", () => refresh_trainer_list())
    document.getElementById("ai_preset_monster").addEventListener("input", () => refresh_trainer_pokemon_data())
    document.getElementById("ai_preset_game").addEventListener("input", () => refresh_trainer_class_list())

    for(const species of document.querySelectorAll(`${get_stats_box(true)} .species`)) {
        species.addEventListener("input", () => { update_typings(true); recalculate() })
    }

    for(const species of document.querySelectorAll(`${get_stats_box(false)} .species`)) {
        species.addEventListener("input", () => { update_typings(false); recalculate() })
    }

    // FIXME: REMOVE THIS ONCE DONE
    // dummy data
    document.querySelector(`${get_stats_box(true)} .hp_stat`).value = 249
    document.querySelector(`${get_stats_box(true)} .atk_stat`).value = 190
    document.querySelector(`${get_stats_box(true)} .def_stat`).value = 167
    document.querySelector(`${get_stats_box(true)} .spa_stat`).value = 139
    document.querySelector(`${get_stats_box(true)} .spd_stat`).value = 139
    document.querySelector(`${get_stats_box(true)} .spe_stat`).value = 202
    document.querySelector(`${get_stats_box(true)} .level`).value = 71
    document.querySelector(`${get_stats_box(true)} .friendship`).value = 255
    document.querySelector(`${get_stats_box(true)} .move_1`).value = "RETURN"
    document.querySelector(`${get_stats_box(true)} .move_2`).value = "SHADOW_BALL"
    document.querySelector(`${get_stats_box(true)} .move_3`).value = "HEADBUTT"
    document.querySelector(`${get_stats_box(true)} .move_4`).value = "FIRE_PUNCH"

    update_typings(true)
    update_typings(false)

    refresh_trainer_class_list()
}

function teams_to_use() {
    const game = document.getElementById("ai_preset_game").value
    switch(game) {
        case "crystal": return furretcalc.get_crystal_parties();
        case "gold": return furretcalc.get_gold_parties();
        default: throw new Error(`Unknown game ${game}`)
    }
}

function refresh_trainer_class_list() {
    let options = ""

    const t = teams_to_use()
    const trainer_types = []

    for(const { name } of Object.values(t)) {
        if(!trainer_types.includes(name)) {
            trainer_types.push(name)
        }
    }
    
    for(const k of trainer_types.toSorted()) {
        options += `<option value=\"${k}\">${k}</option>`
    }

    document.getElementById("ai_preset_trainer_class").innerHTML = options
    refresh_trainer_list()
}

function refresh_trainer_list() {
    const search = document.getElementById("ai_preset_trainer_class").value
    
    let options = ""

    const t = teams_to_use()
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
            for(const [number,entry] of Object.entries(v)) {
                options += `<option value=${entry}>${k} #${parseInt(number)+1}</option>`
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
    const teams = teams_to_use()
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
    
    const pokemon = furretcalc.get_crystal_pokemon()
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

            case "species": element.value = selection.species; break;
            case "item": element.value = selection.item; break;
            case "level": element.value = selection.level; break;
            case "friendship": element.value = 0; break;
            case "status": element.value = "ok"; break;

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
    for(let i = 1; i <= 8; i++) {
        document.getElementById(`johto_badge_${i}`).checked = false
        document.getElementById(`kanto_badge_${i}`).checked = false
    }
    recalculate()
}

function select_johto_badges() {
    for(let i = 1; i <= 8; i++) {
        document.getElementById(`johto_badge_${i}`).checked = true
    }
    recalculate()
}

function select_all_badges() {
    select_johto_badges()

    for(let i = 1; i <= 8; i++) {
        document.getElementById(`kanto_badge_${i}`).checked = true
    }
    recalculate()
}

function update_typings(is_player) {
    const species = document.querySelector(`${get_stats_box(is_player)} .species`).value
    const entry = furretcalc.get_crystal_pokemon()[species]

    document.querySelector(`${get_stats_box(is_player)} .type_primary`).value = entry.types[0]
    document.querySelector(`${get_stats_box(is_player)} .type_secondary`).value = entry.types[1] ?? "None"
}

window.clear_all_badges = clear_all_badges
window.select_all_badges = select_all_badges
window.select_johto_badges = select_johto_badges
window.show_instructions = () => {
    document.getElementById("instructions").style.display = "block"
    document.getElementById("instructions_show").style.display = "none"
}
