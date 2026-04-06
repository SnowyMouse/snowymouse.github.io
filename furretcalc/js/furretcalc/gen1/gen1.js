import { Type } from "../util.js";


export const TYPE_EFFECTIVENESS = {
    [Type.NORMAL]: {
        "weaknesses": [Type.FIGHTING],
        "resistances": [],
        "immunities": [Type.GHOST]
    },
    [Type.FIGHTING]: {
        "weaknesses": [Type.FLYING, Type.PSYCHIC],
        "resistances": [Type.BUG, Type.ROCK],
        "immunities": []
    },
    [Type.FLYING]: {
        "weaknesses": [Type.ICE, Type.ROCK, Type.ELECTRIC],
        "resistances": [Type.FIGHTING, Type.BUG, Type.GRASS],
        "immunities": [Type.GROUND]
    },
    [Type.POISON]: {
        "weaknesses": [Type.GROUND, Type.PSYCHIC, Type.BUG],
        "resistances": [Type.POISON, Type.GRASS, Type.FIGHTING],
        "immunities": []
    },
    [Type.GROUND]: {
        "weaknesses": [Type.ICE, Type.WATER, Type.GRASS],
        "resistances": [Type.ROCK, Type.POISON],
        "immunities": [Type.ELECTRIC]
    },
    [Type.ROCK]: {
        "weaknesses": [Type.GROUND, Type.FIGHTING, Type.WATER, Type.GRASS],
        "resistances": [Type.NORMAL, Type.FLYING, Type.POISON, Type.FIRE],
        "immunities": []
    },
    [Type.BIRD]: {
        "weaknesses": [],
        "resistances": [],
        "immunities": []
    },
    [Type.BUG]: {
        "weaknesses": [Type.FIRE, Type.FLYING, Type.ROCK, Type.POISON],
        "resistances": [Type.GRASS, Type.FIGHTING, Type.GROUND],
        "immunities": []
    },
    [Type.GHOST]: {
        "weaknesses": [Type.GHOST],
        "resistances": [Type.POISON, Type.BUG],
        "immunities": [Type.NORMAL, Type.PSYCHIC /* this is a bug in the original game */ ]
    },
    [Type.FIRE]: {
        "weaknesses": [Type.WATER, Type.GROUND, Type.ROCK],
        "resistances": [Type.GRASS, Type.FIRE, Type.BUG],
        "immunities": []
    },
    [Type.WATER]: {
        "weaknesses": [Type.ELECTRIC, Type.GRASS],
        "resistances": [Type.WATER, Type.FIRE, Type.ICE],
        "immunities": []
    },
    [Type.GRASS]: {
        "weaknesses": [Type.FIRE, Type.POISON, Type.BUG, Type.ICE, Type.FLYING],
        "resistances": [Type.GRASS, Type.WATER, Type.GROUND, Type.ELECTRIC],
        "immunities": []
    },
    [Type.ELECTRIC]: {
        "weaknesses": [Type.GROUND],
        "resistances": [Type.ELECTRIC, Type.FLYING],
        "immunities": []
    },
    [Type.PSYCHIC]: {
        "weaknesses": [Type.BUG],
        "resistances": [Type.PSYCHIC, Type.FIGHTING],
        "immunities": [Type.GHOST]
    },
    [Type.ICE]: {
        "weaknesses": [Type.FIRE, Type.ROCK, Type.FIGHTING],
        "resistances": [Type.ICE],
        "immunities": []
    },
    [Type.DRAGON]: {
        "weaknesses": [Type.ICE, Type.DRAGON],
        "resistances": [Type.ELECTRIC, Type.FIRE, Type.WATER, Type.GRASS],
        "immunities": []
    }
}

export const StatBadgeBoostIndex = Object.freeze({
    Attack: 0,
    // bug: surge's badge should be speed, not defense
    Defense: 2,
    Special: 6,
    // bug: koga's badge should be defense, not speed
    Speed: 4
})

const BADGES = Object.freeze({
    "Kanto": Object.freeze([
        "Brock",
        "Misty",
        "Lt. Surge",
        "Erika",
        "Janine",
        "Sabrina",
        "Blaine",
        "Giovanni"
    ])
})
export function get_badge_list() {
    return BADGES
}