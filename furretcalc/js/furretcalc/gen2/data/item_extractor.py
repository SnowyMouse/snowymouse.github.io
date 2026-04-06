# Extracts party data from the pokegold/pokecrystal disassembly

import sys
import json

args = sys.argv

if len(args) != 4:
    print("Usage: <py> <attributes.asm> <names.asm> <output.json>")
    sys.exit(1)

with open(sys.argv[1], "r") as f:
    attributes_asm=f.readlines()

with open(sys.argv[2], "r") as f:
    names_asm=f.readlines()

item_names=[]
for l in names_asm:
    item=l.strip()
    if "li " in item:
        name=item[4:-1]
        item_names.append(name.replace("#", "POKé").title().replace("Tm","TM").replace("Hm","HM").replace("Pp","PP").replace("Hp","HP").replace("'S","'s"))


attributes={}
index=0
for l in attributes_asm:
    attribute=l.strip()
    if attribute.startswith("item_attribute "):
        s=[q.strip() for q in attribute[15:].split(",")]
        name=item_names[index]
        effect=s[1]
        param=s[2]
        index = index + 1

        if name == "Teru-Sama" or name == "?":
            continue
        attributes[name] = { "effect": effect, "parameter": int(param), "index": index }

with open(args[3], "w") as f:
    j = json.dumps(attributes, indent=4, ensure_ascii=False) + "\n"
    f.write(j)
