# Extracts pokemon data from the pokegold/pokecrystal disassembly

import sys
import os
import json

args = sys.argv

if len(args) != 7:
    print("Usage: <py> <pokemon_constants.asm> <names.asm> <evos_attacks_pointers.asm> <evos_attacks.asm> <base_stats_dir> <output.json>")
    sys.exit(1)

with open(sys.argv[1], "r") as f:
    pokemon_constants_asm=f.readlines()

with open(sys.argv[2], "r") as f:
    names_asm=f.readlines()

with open(sys.argv[3], "r") as f:
    evos_attacks_pointers_asm=f.readlines()

with open(sys.argv[4], "r") as f:
    evos_attacks_asm=f.readlines()

files = []

for c in os.listdir(sys.argv[5]):
    with open(sys.argv[5] + "/" + c, "r") as f:
        files.append(f.readlines())

constants = []

for l in pokemon_constants_asm:
    line = l.strip()
    if line.find(";") != -1:
        line = line[:line.find(";")].strip()
    if not line.startswith("const "):
        continue
    constant = line[6:]
    if constant == "EGG":
        break
    constants.append(constant)

names = []

for l in names_asm:
    line = l.strip()
    if not line.startswith("db "):
        continue
    name = line[3:][1:-1]
    while name.endswith("@"):
        name = name[:-1]
    if name == "?????":
        break
    if name == "FARFETCH'D":
        names.append("Farfetch'd")
    elif name == "MR.MIME":
        names.append("Mr. Mime")
    else:
        names.append(name.lower().title())

if len(names) != len(constants):
    print("Number of constants does not match number of names (names = {}, constants = {})".format(len(names), len(constants)))
    sys.exit(1)

pokemon_count = len(constants)

pointers = []

for l in evos_attacks_pointers_asm:
    line = l.strip()
    if not line.startswith("dw "):
        continue
    pointers.append(line[3:])

if len(pointers) != pokemon_count:
    print("Number of move pointers does not match number of pokemon (pokemon = {}, pointers = {})".format(pokemon_count, len(pointers)))
    sys.exit(1)

pokemon = {}

for c in range(0, pokemon_count):
    pokemon[constants[c]] = {
        "name": names[c],
        "pointers": pointers[c]
    }

for c in files:
    name_line = c[0].strip()
    if not name_line.startswith("db "):
        continue
    name = name_line[3:]
    if ";" in name:
        name = name[:name.index(";")].strip()

    current_pokemon = pokemon[name]

    base = None
    types = None

    for l in c[1:]:
        line = l.strip()
        if not line.startswith("db "):
            continue
        if ";" in line:
            line = line[:line.index(";")].strip()
        if base is None:
            base = [int(d.strip()) for d in line[3:].split(",")]
            continue
        if types is None:
            types = [d.strip() for d in line[3:].split(",")]
            continue
        break
    
    current_pokemon["types"] = []
    for t in types:
        if t == "PSYCHIC_TYPE":
            current_pokemon["types"].append("PSYCHIC")
        else:
            current_pokemon["types"].append(t)

    current_pokemon["base_stats"] = base
    current_pokemon["level_up_moves"] = []

for pk in pokemon:
    p = pokemon[pk]
    found_it = False
    in_evos = True
    for l in evos_attacks_asm:
        line = l.strip()
        if not found_it:
            if line != p["pointers"] + ":":
                continue
            del p["pointers"]
            found_it = True
            continue
        if not line.startswith("db "):
            continue
        db = line[3:]

        if ";" in db:
            db = db[:db.index(";")].strip()

        if db == "0":
            if in_evos:
                in_evos = False
                continue
            break
        s = [i.strip() for i in db.split(",")]
        if not in_evos:
            p["level_up_moves"].append({ "level": int(s[0]), "move": s[1] })

    if not found_it:
        print("Failed to locate moves for {}".format(pk))
        sys.exit(1)

with open(args[6], "w") as f:
    j = json.dumps(pokemon, indent=4, ensure_ascii=False) + "\n"
    f.write(j)
