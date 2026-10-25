"""
UW Seattle buildings and where they are, for putting events on the map.

Coordinates come from OpenStreetMap. To add a building, add a line with its
name, latitude, longitude, any full-name spellings people use (matched
ignoring case), and its UW abbreviation(s) (matched only in CAPITALS, so
"ART" doesn't match the word "art").
"""

import re

# (display name, lat, lng, [full names], [abbreviations])
BUILDINGS = [
    ("HUB", 47.65537, -122.30510, ["husky union building", "hub ballroom", "hub lyceum", "hub yard", "husky den"], ["HUB"]),
    ("Odegaard Library", 47.65647, -122.31042, ["odegaard"], ["OUG", "ODE"]),
    ("Suzzallo Library", 47.65581, -122.30805, ["suzzallo", "allen library"], ["SUZ", "ALB"]),
    ("Kane Hall", 47.65660, -122.30917, ["kane hall"], ["KNE"]),
    ("Savery Hall", 47.65712, -122.30842, ["savery"], ["SAV"]),
    ("Mary Gates Hall", 47.65485, -122.30779, ["mary gates"], ["MGH"]),
    ("Allen Center (CSE)", 47.65323, -122.30590, ["paul g. allen center", "allen center"], ["CSE", "CSE1"]),
    ("Gates Center (CSE2)", 47.65287, -122.30448, ["gates center", "bill & melinda gates center"], ["CSE2"]),
    ("Physics/Astronomy", 47.65360, -122.31131, ["physics/astronomy", "physics and astronomy", "physics & astronomy"], ["PAB", "PAA"]),
    ("Padelford Hall", 47.65696, -122.30428, ["padelford"], ["PDL"]),
    ("Gowen Hall", 47.65633, -122.30770, ["gowen hall"], ["GWN"]),
    ("Smith Hall", 47.65666, -122.30711, ["smith hall"], ["SMI"]),
    ("Denny Hall", 47.65840, -122.30882, ["denny hall"], ["DEN"]),
    ("Red Square", 47.65603, -122.30944, ["red square"], []),
    ("PACCAR Hall", 47.65909, -122.30867, ["paccar"], ["PCAR"]),
    ("Dempsey Hall", 47.65911, -122.30781, ["dempsey"], ["DEM"]),
    ("ECE Building", 47.65358, -122.30630, ["electrical and computer engineering", "electrical & computer engineering"], ["ECE"]),
    ("Sieg Hall", 47.65489, -122.30649, ["sieg hall", "sieg building"], ["SIG"]),
    ("Johnson Hall", 47.65442, -122.30875, ["johnson hall"], ["JHN"]),
    ("Kincaid Hall", 47.65265, -122.31062, ["kincaid"], ["KIN"]),
    ("Bagley Hall", 47.65349, -122.30885, ["bagley"], ["BAG"]),
    ("Guthrie Hall", 47.65402, -122.31090, ["guthrie"], ["GTH"]),
    ("Loew Hall", 47.65434, -122.30452, ["loew hall"], ["LOW"]),
    ("Mechanical Engineering", 47.65369, -122.30476, ["mechanical engineering building"], ["MEB"]),
    ("More Hall", 47.65249, -122.30482, ["more hall"], ["MOR"]),
    ("IMA", 47.65374, -122.30123, ["intramural activities", "ima building"], ["IMA"]),
    ("Husky Stadium", 47.65037, -122.30198, ["husky stadium"], []),
    ("Hec Ed Pavilion", 47.65218, -122.30212, ["hec edmundson", "hec ed", "alaska airlines arena"], []),
    ("Meany Hall", 47.65566, -122.31066, ["meany"], ["MNY"]),
    ("Thomson Hall", 47.65650, -122.30575, ["thomson hall"], ["THO"]),
    ("Raitt Hall", 47.65791, -122.30728, ["raitt"], ["RAI"]),
    ("Art Building", 47.65841, -122.30669, ["art building"], ["ART"]),
    ("Music Building", 47.65766, -122.30584, ["music building"], ["MUS"]),
    ("Communications Building", 47.65701, -122.30536, ["communications building"], ["CMU"]),
    ("Condon Hall", 47.65664, -122.31613, ["condon"], ["CDH"]),
    ("Architecture Hall", 47.65456, -122.31096, ["architecture hall"], ["ARC"]),
    ("Gould Hall", 47.65491, -122.31274, ["gould hall"], ["GLD"]),
    ("Burke Museum", 47.66052, -122.31156, ["burke museum", "the burke"], []),
    ("Winkenwerder Hall", 47.65139, -122.30687, ["winkenwerder"], ["WFS"]),
    ("Anderson Hall", 47.65175, -122.30760, ["anderson hall"], ["AND"]),
    ("Miller Hall", 47.65721, -122.30632, ["miller hall"], ["MLR"]),
    ("Clark Hall", 47.65765, -122.30487, ["clark hall"], ["CLK"]),
    ("Parrington Hall", 47.65744, -122.31025, ["parrington"], ["PAR"]),
    ("Drumheller Fountain", 47.65381, -122.30780, ["drumheller", "frosh pond"], []),
    ("Chemistry Building", 47.65295, -122.30837, ["chemistry building"], ["CHB", "CHL"]),
    ("Health Sciences", 47.65164, -122.31052, ["health sciences", "south campus center"], ["HSB", "HSEB", "SOCC"]),
    ("Alder Hall", 47.65567, -122.31355, ["alder hall"], ["ALD"]),
    ("Elm Hall", 47.65653, -122.31525, ["elm hall"], []),
    ("Lander Hall", 47.65566, -122.31468, ["lander hall"], []),
    ("The Quad", 47.65728, -122.30721, ["the quad", "liberal arts quad"], []),
]

_PATTERNS = []
for name, lat, lng, full, abbrs in BUILDINGS:
    parts = [re.compile(r"\b" + re.escape(f) + r"\b", re.I) for f in full]
    parts += [re.compile(r"\b" + re.escape(a) + r"\b") for a in abbrs]
    _PATTERNS.append((name, (lat, lng), parts))


def find_building(text):
    """Return (name, (lat, lng)) for the building mentioned first in text, or None."""
    best = None
    for name, pos, parts in _PATTERNS:
        for p in parts:
            m = p.search(text or "")
            if m and (best is None or m.start() < best[0]):
                best = (m.start(), name, pos)
    return (best[1], best[2]) if best else None
