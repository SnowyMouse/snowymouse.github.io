# Extracts party data from the pokegold/pokecrystal disassembly

import sys
import json

args = sys.argv

if len(args) != 6:
    print("Usage: <py> <class_names.asm> <party_pointers.asm> <parties.asm> <dvs.asm> <output.json>")
    sys.exit(1)

with open(sys.argv[1], "r") as f:
    class_names_asm=f.readlines()

with open(sys.argv[2], "r") as f:
    party_pointers_asm=f.readlines()

with open(sys.argv[3], "r") as f:
    parties_asm=f.readlines()

with open(sys.argv[4], "r") as f:
    dvs_asm=f.readlines()

class_names = []
for l in class_names_asm:
    line = l.strip()
    if not line.startswith("li "):
        continue
    name=line[3:][1:][:-1]
    if name == "#FAN":
        name = "POKéFAN"
    if name == "#MANIAC":
        name = "POKéMANIAC"
    if name == "#MON PROF.":
        name = "POKéMON PROFESSOR"
    if name == "<PKMN> TRAINER":
        name = "POKéMON TRAINER"
    class_names.append(name)

dvs = []
for l in dvs_asm:
    line = l.strip()
    if not line.startswith("dn"):
        continue
    line_ends_index = line.find(";")
    if line_ends_index != -1:
        line = line[:line_ends_index]
    dvs.append([int(f.strip()) for f in line[3:].strip().split(",")])

if len(class_names) != len(dvs):
    print("number of trainer classes mismatches dv count (dvs={}, class_names={})".format(len(dvs), len(class_names)))

number_of_trainers = len(class_names)

party_pointers = []
party_pointers_with_colon = []
for l in party_pointers_asm:
    line = l.strip()
    if not line.startswith("dw "):
        continue
    party_pointers.append(line[3:])
    party_pointers_with_colon.append(line[3:] + ":")

if len(party_pointers) != number_of_trainers:
    print("number of party pointers mismatches class count (class_count={}, party_pointers={})".format(number_of_trainers, len(party_pointers)))

parties = {}
current_group = None
current_party = None
party_type = None

for l in parties_asm:
    line = l.strip()

    if line in party_pointers_with_colon:
        index = party_pointers_with_colon.index(line)
        party_pointer_with_colon = party_pointers[index]
        parties[party_pointer_with_colon] = { "name": class_names[index].lower().title(), "dvs": dvs[index], "trainers": [] }
        current_group = parties[party_pointer_with_colon]

        if current_party is not None:
            print("current party ended abruptly when switching groups")
            exit(1)
        continue

    if current_group is None:
        continue

    line_ends_index = line.find(";")
    if line_ends_index != -1:
        line = line[:line_ends_index]

    if not line.startswith("db "):
        continue

    line = line[3:].strip()

    elements = [f.strip() for f in line.split(",")]
    if len(elements) == 0:
        print("empty list???")
        exit(1)

    if elements == ["-1"]:
        current_party = None
        continue

    if current_party is None:
        name = elements[0]
        if len(elements) != 2:
            print("need two elements for party name")
            exit(1)

        if not name.startswith("\"") and not name.endswith("@\""):
            print("invalid name {}".format(name))
            exit(1)

        party_type = elements[1]
        name = name[1:-2].lower().title()
        
        if name == "Lt.Surge":
            name = "Lt. Surge"
        if name == "?":
            name = "???"

        current_party = {
            "name": name,
            "type": party_type,
            "party": []
        }
        current_group["trainers"].append(current_party)
        continue

    if len(elements) < 2:
        print("need at least two elements for party member")
        exit(1)

    level=int(elements[0])
    species=elements[1]
    item="NO_ITEM"
    moves=None

    if party_type == "TRAINERTYPE_NORMAL":
        pass
    elif party_type == "TRAINERTYPE_ITEM":
        if len(elements) != 3:
            print("need three elements for party member of type TRAINERTYPE_ITEM")
            exit(1)
        item = elements[2]
    elif party_type == "TRAINERTYPE_MOVES":
        if len(elements) != 6:
            print("need three elements for party member of type TRAINERTYPE_MOVES")
            exit(1)
        moves = elements[2:]
    elif party_type == "TRAINERTYPE_ITEM_MOVES":
        if len(elements) != 7:
            print("need three elements for party member of type TRAINERTYPE_ITEM_MOVES")
            exit(1)
        item = elements[2]
        moves = elements[3:]
    else:
        print("Unknown party type {}".format(party_type))
        exit(1)
    
    current_party["party"].append({
        "species": species,
        "level": level,
        "item": item,
        "moves": moves
    })

if current_party is not None:
    print("current party ended abruptly when reading parties asm")
    exit(1)

with open(args[5], "w") as f:
    j = json.dumps(parties, indent=4, ensure_ascii=False) + "\n"
    f.write(j)