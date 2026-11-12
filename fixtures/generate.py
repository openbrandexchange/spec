#!/usr/bin/env python3
"""Generate the OBX conformance fixtures (Python 3 standard library only, deterministic).

Writes:
  kestrel/products.csv, kestrel/assets.csv, kestrel/images/*.png   canonical import package
  ingest/files/*.png, ingest/script.ndjson,
  ingest/expected-results.json, ingest/expected-changes.json       ingest replay scenario
  expected/*.json                                                  expected protocol objects

Everything here is fictional: "Kestrel Outfitters" is not a real company, GTINs use the
GS1 restricted-circulation prefix 200 (never assigned to trade items), images are flat
placeholders. Run: python3 fixtures/generate.py
"""
import csv
import hashlib
import io
import json
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))

# --------------------------------------------------------------------------- GTIN

def ean13(first12: str) -> str:
    assert len(first12) == 12 and first12.isdigit()
    total = sum(int(d) * (3 if i % 2 else 1) for i, d in enumerate(first12))
    return first12 + str((10 - total % 10) % 10)


def gtin14(code: str) -> str:
    return code.zfill(14)

# --------------------------------------------------------------------------- PNG

FONT = {  # 5x7 bitmap font, rows top->bottom, 5 bits each
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
    "D": ["11100", "10010", "10001", "10001", "10001", "10010", "11100"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    " ": ["00000"] * 7,
}


def hexrgb(h):
    return bytes(int(h[i:i + 2], 16) for i in (1, 3, 5))


def png(width, height, garment_rgb, label, sublabel):
    """Flat placeholder: light background, a garment-coloured block, two text lines."""
    bg = hexrgb("#EEEEEA")
    ink = hexrgb("#222222")
    fg = hexrgb(garment_rgb)
    left, right = width // 5, width - width // 5
    top, bottom = height // 6, height - height // 3
    scale = max(4, width // 120)

    def text_rows(text, y0):
        rows = {}
        glyph_w = 6 * scale
        x0 = (width - glyph_w * len(text)) // 2
        for gy in range(7):
            for sy in range(scale):
                rows.setdefault(y0 + gy * scale + sy, []).extend(
                    (x0 + ci * glyph_w + gx * scale, scale)
                    for ci, ch in enumerate(text)
                    for gx, bit in enumerate(FONT.get(ch, FONT[" "])[gy]) if bit == "1")
        return rows

    text = {}
    text.update(text_rows(label, bottom + height // 12))
    text.update(text_rows(sublabel, bottom + height // 12 + 10 * scale))

    plain = b"\x00" + bg * width
    block = b"\x00" + bg * left + fg * (right - left) + bg * (width - right)
    raw = bytearray()
    for y in range(height):
        if y in text:
            row = bytearray(bg * width)
            for x, w in text[y]:
                row[x * 3:(x + w) * 3] = ink * w
            raw += b"\x00" + row
        elif top <= y < bottom:
            raw += block
        else:
            raw += plain

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 9)) + chunk(b"IEND", b"")

# --------------------------------------------------------------------------- catalog

BRANDS = {"kestrel": "Kestrel", "kestrel-trail": "Kestrel Trail"}

# (brand, style, name en/nl, description en/nl, item_type, target_group, season, collection,
#  materials, care, origin, colours [(code, en, nl, supplier, rgb)], sizes, images per colour)
PRODUCTS = [
    ("kestrel", "KO-1001", ("Merino Crew Sweater", "Merino trui met ronde hals"),
     ("Fine-knit crew neck sweater in soft merino wool.", "Fijngebreide trui met ronde hals van zachte merinowol."),
     "sweater", "unisex", "AW26", "Highland", "main: 100% merino_wool",
     "wash_30_very_mild|do_not_bleach|do_not_tumble_dry|dry_flat|iron_low|dry_clean_p", "PT",
     [("NVY", "Navy", "Marineblauw", "Deep Navy", "#1F2A44"), ("OAT", "Oatmeal", "Havermout", "Oat Melange", "#D8CBB0")],
     ["S", "M", "L", "XL"], [("front", None), ("back", None)]),
    ("kestrel", "KO-1002", ("Waxed Field Jacket", "Gewaxte veldjas"),
     ("Water-repellent waxed cotton jacket with corduroy collar.", "Waterafstotende jas van gewaxt katoen met corduroy kraag."),
     "jacket", "men", "AW26", "Highland", "outer: 100% cotton; lining: 100% cotton",
     "do_not_wash|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "GB",
     [("OLV", "Olive", "Olijf", "Field Olive", "#556B2F"), ("BLK", "Black", "Zwart", "Jet", "#1A1A1A")],
     ["S", "M", "L", "XL"], [("front", None), ("back", None)]),
    ("kestrel", "KO-1003", ("Organic Cotton Tee", "T-shirt van biologisch katoen"),
     ("Relaxed T-shirt in organic cotton jersey.", "Losvallend T-shirt van biologisch katoenen jersey."),
     "t_shirt", "women", "SS26", "Essentials", "main: 100% cotton (organic)",
     "wash_40|do_not_bleach|tumble_dry_low|iron_medium|dry_clean_p", "PT",
     [("WHT", "White", "Wit", "Chalk", "#F7F7F2"), ("BLK", "Black", "Zwart", "Jet", "#1A1A1A"), ("RST", "Rust", "Roest", "Burnt Rust", "#A0472A")],
     ["XS", "S", "M", "L"], [("front", None), ("back", None)]),
    ("kestrel", "KO-1004", ("Selvedge Straight Jeans", "Rechte selvedge jeans"),
     ("Straight-leg jeans in rigid selvedge denim.", "Jeans met rechte pijp van stugge selvedge denim."),
     "jeans", "men", "NOS", "Denim", "main: 98% cotton, 2% elastane",
     "wash_30|do_not_bleach|do_not_tumble_dry|iron_medium|dry_clean_p", "IT",
     [("IND", "Indigo", "Indigo", "Rinse Indigo", "#26345C")],
     ["30", "32", "34"], [("front", None), ("back", None), ("detail", "detail")]),
    ("kestrel", "KO-1005", ("Leather Weekender Bag", "Leren weekendtas"),
     ("Full-grain leather weekender with cotton lining.", "Weekendtas van volnerf leer met katoenen voering."),
     "bag", "unisex", "NOS", "Travel", "outer: 100% leather; lining: 100% cotton",
     "do_not_wash|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "IT",
     [("COG", "Cognac", "Cognac", "Saddle", "#8B4A1F")],
     ["ONE SIZE"], [("front", None), ("side", None), ("inside", None)]),
    ("kestrel", "KO-1006", ("Wool Beanie", "Wollen muts"),
     ("Rib-knit beanie in lambswool.", "Geribde muts van lamswol."),
     "hat", "unisex", "AW26", "Highland", "main: 100% lambswool",
     "hand_wash|do_not_bleach|do_not_tumble_dry|dry_flat|do_not_iron|dry_clean_p", "NL",
     [("RST", "Rust", "Roest", "Burnt Rust", "#A0472A"), ("NVY", "Navy", "Marineblauw", "Deep Navy", "#1F2A44")],
     ["ONE SIZE"], [("front", None)]),
    ("kestrel", "KO-1008", ("Hardshell Cabin Spinner", "Harde handbagagekoffer"),
     ("Four-wheel hardshell cabin suitcase with TSA lock and expansion zip.", "Harde handbagagekoffer met vier wielen, TSA-slot en uitbreidingsrits."),
     "luggage", "unisex", "NOS", "Travel", "shell: 100% polypropylene; lining: 100% polyester (recycled)",
     "do_not_wash|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "CN",
     [("BLK", "Black", "Zwart", "Jet", "#1A1A1A")],
     ["CABIN", "CABIN PLUS"], [("front", None), ("side", None), ("inside", None)]),
    ("kestrel", "KO-1009", ("Commuter Laptop Messenger", "Laptoptas voor forenzen"),
     ("Water-repellent messenger with a padded 15.6 inch laptop compartment and a detachable shoulder strap.", "Waterafstotende schoudertas met gevoerd laptopvak voor 15,6 inch en afneembare schouderband."),
     "bag", "unisex", "NOS", "Travel", "outer: 100% polyester (recycled); lining: 100% polyamide",
     "hand_wash|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "VN",
     [("CHR", "Charcoal", "Antraciet", "Slate", "#3C3F44")],
     ["ONE SIZE"], [("front", None), ("back", None), ("inside", None)]),
    ("kestrel", "KO-1010", ("Leather Chelsea Boot", "Leren chelsea boot"),
     ("Chelsea boot in full-grain leather with leather lining and a removable insole.", "Chelsea boot van volnerf leer met leren voering en uitneembaar voetbed."),
     "shoes", "men", "AW26", "Highland", "upper: 100% leather; lining: 100% leather; sole: 100% rubber",
     "do_not_wash|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "PT",
     [("BRN", "Dark brown", "Donkerbruin", "Espresso", "#4A2C1A")],
     ["41", "42", "43"], [("side", None), ("front", None)]),
    ("kestrel-trail", "KT-2001", ("Trail Running Shorts", "Trailrunning short"),
     ("Lightweight running shorts with inner brief.", "Lichte hardloopshort met binnenbroekje."),
     "shorts", "men", "SS26", "Trail", "outer: 100% recycled_polyester; lining: 88% polyamide, 12% elastane",  # 0.1 fibre key on purpose
     "wash_30|do_not_bleach|do_not_tumble_dry|do_not_iron|do_not_dry_clean", "VN",
     [("BLK", "Black", "Zwart", "Jet", "#1A1A1A")],
     ["S", "M", "L"], [("front", None), ("back", None)]),
    ("kestrel-trail", "KT-2002", ("Packable Rain Shell", "Opvouwbare regenjas"),
     ("Waterproof, breathable shell that packs into its own pocket.", "Waterdichte, ademende jas die in zijn eigen zak past."),
     "jacket", "unisex", "SS26", "Trail", "main: 100% recycled_polyamide",
     "wash_30|do_not_bleach|tumble_dry_low|do_not_iron|do_not_dry_clean", "VN",
     [("YLW", "Yellow", "Geel", "Signal Yellow", "#E8B820")],
     ["S", "M", "L"], [("front", None), ("back", None)]),
]

# 0.2 product data per style (docs/proposals/0002-product-data.md). Product level:
# item_subtype, contains_animal_origin, footwear_materials, certifications, features.
# Variant level: color family per colour code, size_length and measurements per size.
FEATURE_KEYS = ["shell", "wheels", "lock", "expandable", "closure", "laptop_compartment", "water_resistance",
                "detachable_parts", "adjustable_parts", "fit", "sleeve_length", "neckline"]
MEASUREMENT_KEYS = ["height_cm", "width_cm", "depth_cm", "weight_kg", "volume_l", "volume_expanded_l",
                    "handle_drop_cm", "strap_length_cm", "laptop_max_inch", "heel_height_cm", "shaft_height_cm", "inseam_cm"]
COLOR_FAMILY = {"NVY": "blue", "OAT": "beige", "OLV": "green", "BLK": "black", "WHT": "white", "RST": "orange",
                "IND": "blue", "COG": "brown", "YLW": "yellow", "CHR": "grey", "BRN": "brown"}
EXTRA = {
    "KO-1001": {"contains_animal_origin": False,
                "certifications": [{"scheme": "rws", "licence_number": "CU 200101", "scope": "material"}],
                "features": {"fit": "regular", "sleeve_length": "long", "neckline": "crew"}},
    "KO-1002": {"contains_animal_origin": False,
                "features": {"closure": "zip", "water_resistance": "water_repellent", "fit": "regular", "sleeve_length": "long", "neckline": "collar"}},
    "KO-1003": {"contains_animal_origin": False,
                "certifications": [{"scheme": "gots", "licence_number": "CU 200301", "scope": "product"},
                                   {"scheme": "oeko_tex_standard_100", "licence_number": "26.KST.20003", "scope": "product"}],
                "features": {"fit": "relaxed", "sleeve_length": "short", "neckline": "crew"}},
    "KO-1004": {"contains_animal_origin": True,  # leather patch at the back
                "features": {"closure": "button", "fit": "regular"},
                "size_length": {"30": "32", "32": "32", "34": "32"},
                "measurements": {"30": {"inseam_cm": 81}, "32": {"inseam_cm": 81}, "34": {"inseam_cm": 81}}},
    "KO-1005": {"item_subtype": "weekender", "contains_animal_origin": True,
                "features": {"closure": "zip", "detachable_parts": ["shoulder_strap"], "adjustable_parts": ["shoulder_strap"]},
                "measurements": {"ONE SIZE": {"height_cm": 32, "width_cm": 52, "depth_cm": 26, "weight_kg": 1.8, "volume_l": 40,
                                              "handle_drop_cm": 20, "strap_length_cm": {"min": 100, "max": 130}}}},
    "KO-1006": {"contains_animal_origin": False},
    "KO-1008": {"item_subtype": "cabin", "size_system": None,
                "features": {"shell": "hard", "wheels": 4, "lock": "tsa_combination", "expandable": True, "closure": "zip"},
                "measurements": {"CABIN": {"height_cm": 55, "width_cm": 40, "depth_cm": 20, "weight_kg": 2.6, "volume_l": 36, "volume_expanded_l": 42},
                                 "CABIN PLUS": {"height_cm": 55, "width_cm": 40, "depth_cm": 23, "weight_kg": 2.8, "volume_l": 42, "volume_expanded_l": 48}}},
    "KO-1009": {"item_subtype": "laptop_bag", "contains_animal_origin": False,
                "certifications": [{"scheme": "grs", "licence_number": "CU 200901", "scope": "material"}],
                "features": {"closure": "flap", "laptop_compartment": True, "water_resistance": "water_repellent",
                             "detachable_parts": ["shoulder_strap"], "adjustable_parts": ["shoulder_strap"]},
                "measurements": {"ONE SIZE": {"height_cm": 30, "width_cm": 40, "depth_cm": 12, "weight_kg": 0.9, "volume_l": 14,
                                              "handle_drop_cm": 10, "strap_length_cm": {"min": 85, "max": 140}, "laptop_max_inch": 15.6}}},
    "KO-1010": {"item_subtype": "ankle_boot",
                "footwear_materials": {"upper": "leather", "lining_and_sock": "leather", "outer_sole": "other"},
                "certifications": [{"scheme": "lwg", "licence_number": "LWG-200-1010", "scope": "material"}],
                "features": {"closure": "slip_on", "detachable_parts": ["insole"]},
                "measurements": {"41": {"heel_height_cm": 3.5, "shaft_height_cm": 14},
                                 "42": {"heel_height_cm": 3.5, "shaft_height_cm": 14.5},
                                 "43": {"heel_height_cm": 3.5, "shaft_height_cm": 15}}},
    "KT-2001": {"contains_animal_origin": False, "features": {"fit": "regular"}},
    "KT-2002": {"contains_animal_origin": False,
                "features": {"closure": "zip", "water_resistance": "waterproof", "fit": "regular", "sleeve_length": "long", "neckline": "hood"}},
}


def size_system(style, size):
    if "size_system" in EXTRA[style]:
        return EXTRA[style]["size_system"]
    return "EU" if size[0].isdigit() else (None if size == "ONE SIZE" else "INT")


def sku(style, code, size):
    length = EXTRA[style].get("size_length", {}).get(size)
    return f"{style}-{code}-{size.replace(' ', '')}" + (f"-{length}" if length else "")


def csv_number(n):
    return str(n)


def csv_measurement(key, v):
    if key == "strap_length_cm":
        return f"{csv_number(v['min'])}-{csv_number(v['max'])}"
    return csv_number(v)


def csv_feature(v):
    if isinstance(v, bool):
        return "yes" if v else "no"
    if isinstance(v, list):
        return "|".join(v)
    return str(v)


def csv_certifications(certs):
    return "; ".join(f"{c['scheme']}:{c['licence_number']}" + (" (material)" if c["scope"] == "material" else "") for c in certs or [])


def csv_footwear(fw):
    return "; ".join(f"{k}: {fw[k]}" for k in ("upper", "lining_and_sock", "outer_sole") if fw.get(k)) if fw else ""

# assets.csv overrides: basename -> dict
ASSET_OVERRIDES = {
    "KO-1003_RST_3_model.png": {"ai_generated": "true", "ai_edited": "false", "source": "generated", "c2pa": "none",
                                "generator": "fictional-image-model 1.0",
                                "alt_text:en": "AI-generated image of a model wearing the rust tee",
                                "alt_text:nl": "Met AI gegenereerd beeld van een model in het roestkleurige T-shirt"},
    "KO-1002_BLK_2_back.png": {"embargo_until": "2030-01-01T00:00:00Z", "credit": "Photo: Kestrel Studio"},
}
BIG = "KO-1002_OLV_1_front.png"  # 2400x3000 original to exercise downscaling

PRODUCTS_HEADER = (["brand", "style_number", "name:en", "name:nl", "description:en", "description:nl", "item_type",
                    "item_subtype", "target_group", "season", "collection", "materials", "contains_animal_origin",
                    "footwear_materials", "care", "country_of_origin", "certifications"]
                   + [f"feature:{k}" for k in FEATURE_KEYS]
                   + ["variant_id", "gtin", "sku", "color_code", "color_name:en", "color_name:nl", "color_family",
                      "supplier_color", "size", "size_length", "size_system"]
                   + MEASUREMENT_KEYS)
ASSETS_HEADER = ["file", "role", "view", "alt_text:en", "alt_text:nl", "embargo_until", "credit",
                 "ai_generated", "ai_edited", "source", "c2pa", "generator"]

DEFAULT_RIGHTS = {"license": "retailer-use", "license_text": None, "channels": ["webshop", "marketplace", "social"],
                  "territories": None, "embargo_until": None, "expires_at": None, "credit": None, "model_release": None}
DEFAULT_PROVENANCE = {"ai_generated": False, "ai_edited": False, "source": "photo", "c2pa": "none",
                      "c2pa_manifest_url": None, "generator": None}


VOCAB = {k: {e["code"]: e for e in json.load(open(os.path.join(HERE, "..", "vocabularies", k + ".json"), encoding="utf-8"))["entries"]}
         for k in ("parts", "materials", "qualifiers", "care")}
QUALIFIERS_01 = ("recycled", "organic")  # 0.1 keys: recycled_polyester -> polyester + qualifier recycled


def term(kind, code):
    """A term {code, name}: the vocabulary's name for a known code, else null (protocol.md 5.9.1)."""
    entry = VOCAB[kind].get(code)
    return {"code": code, "name": entry["name"] if entry else None}


def care_entry(code):
    entry = VOCAB["care"].get(code)
    return {"code": code, "category": entry["category"] if entry else None, "symbol": entry["symbol"] if entry else None,
            "name": entry["name"] if entry else None, "text": None}


def parse_materials(s):
    parts = []
    for chunk in s.split(";"):
        chunk = chunk.strip()
        part, _, fibers = chunk.partition(":") if ":" in chunk else ("main", "", chunk)
        out = []
        for f in fibers.split(","):
            pct, _, fiber = f.strip().partition("% ")
            qualifier = None
            fiber = fiber.strip()
            if fiber.endswith(")"):
                fiber, _, qualifier = fiber[:-1].rpartition("(")
                fiber, qualifier = fiber.strip(), qualifier.strip()
            for prefix in QUALIFIERS_01:
                if fiber.startswith(prefix + "_"):
                    fiber = fiber[len(prefix) + 1:]
                    qualifier = prefix
            out.append({"material": term("materials", fiber), "percentage": int(pct),
                        "qualifier": term("qualifiers", qualifier) if qualifier else None})
        parts.append({"part": term("parts", part.strip()), "fibers": out})
    return parts


def write(path, data, mode="w"):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, mode, **({} if "b" in mode else {"encoding": "utf-8", "newline": ""})) as f:
        f.write(data)


def sha(b):
    return hashlib.sha256(b).hexdigest()


def main():
    images_dir = os.path.join(HERE, "kestrel", "images")
    os.makedirs(images_dir, exist_ok=True)
    for old in os.listdir(images_dir):
        os.remove(os.path.join(images_dir, old))

    rows, asset_rows, image_meta, gtins = [], [], {}, {}
    for pi, (brand, style, name, desc, itype, tg, season, coll, mats, care, origin, colors, sizes, shots) in enumerate(PRODUCTS):
        for ci, (code, cen, cnl, sup, rgb) in enumerate(colors):
            for si, size in enumerate(sizes):
                g = ean13("200" + style[-4:].rjust(5, "0") + f"{ci + 1:02d}{si + 1:02d}")
                gtins[(style, code, size)] = g
                x = EXTRA[style]
                cao = x.get("contains_animal_origin")
                meas = x.get("measurements", {}).get(size, {})
                rows.append([BRANDS[brand], style, name[0], name[1], desc[0], desc[1], itype, x.get("item_subtype", ""), tg,
                             season, coll, mats, "" if cao is None else ("yes" if cao else "no"),
                             csv_footwear(x.get("footwear_materials")), care, origin, csv_certifications(x.get("certifications"))]
                            + [csv_feature(x["features"][k]) if k in x.get("features", {}) else "" for k in FEATURE_KEYS]
                            + ["", g, sku(style, code, size), code, cen, cnl, COLOR_FAMILY[code], sup, size,
                               x.get("size_length", {}).get(size, ""), size_system(style, size) or ""]
                            + [csv_measurement(k, meas[k]) if k in meas else "" for k in MEASUREMENT_KEYS])
            extra = [("model", None)] if (style, code) == ("KO-1003", "RST") else []
            for pos, (q1, q2) in enumerate(shots + extra, start=1):
                quals = [q1]
                fname = f"{style}_{code}_{pos}_{quals[0]}.png"
                big = fname == BIG
                data = png(2400 if big else 1200, 3000 if big else 1500, rgb, f"{style} {code} {pos}", (quals[0]).upper().replace("_", " "))
                write(os.path.join(images_dir, fname), data, "wb")
                image_meta[fname] = {"sha256": sha(data), "bytes": len(data), "width": 2400 if big else 1200,
                                     "height": 3000 if big else 1500, "style": style, "color": code, "position": pos,
                                     "qualifier": quals[0]}
                if fname in ASSET_OVERRIDES:
                    o = ASSET_OVERRIDES[fname]
                    asset_rows.append([fname, o.get("role", ""), o.get("view", ""), o.get("alt_text:en", ""), o.get("alt_text:nl", ""),
                                       o.get("embargo_until", ""), o.get("credit", ""), o.get("ai_generated", ""),
                                       o.get("ai_edited", ""), o.get("source", ""), o.get("c2pa", ""), o.get("generator", "")])

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(PRODUCTS_HEADER)
    w.writerows(rows)
    write(os.path.join(HERE, "kestrel", "products.csv"), buf.getvalue())
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(ASSETS_HEADER)
    w.writerows(asset_rows)
    write(os.path.join(HERE, "kestrel", "assets.csv"), buf.getvalue())
    write(os.path.join(HERE, "kestrel", "images.json"), json.dumps(image_meta, indent=2, sort_keys=True) + "\n")

    write_expected(image_meta, gtins)
    write_import_cases(gtins)
    write_ingest()
    total = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fs in os.walk(HERE) for f in fs)
    print(f"{len(rows)} variant rows, {len(image_meta)} images, fixtures total {total / 1024:.0f} KiB")

# --------------------------------------------------------------------------- expected protocol JSON

ANY_ID, ANY_TIME, ANY_URL, ANY_SHA, ANY_INT = "{{id}}", "{{datetime}}", "{{url}}", "{{sha256}}", "{{int}}"
ROLE_KEYS = {"packshot", "model", "detail", "ghost", "flatlay", "scene", "swatch", "size_chart", "other"}


def rendition(name, w, h):
    return {"name": name, "url": ANY_URL, "url_expires_at": "{{datetime|null}}", "content_type": "image/jpeg",
            "width": w, "height": h, "bytes": ANY_INT, "sha256": ANY_SHA}


def fit(w, h, limit):
    if max(w, h) <= limit:
        return w, h
    if w >= h:
        return limit, round(h * limit / w)
    return round(w * limit / h), limit


def expected_asset(fname, meta, original=True):
    q = meta["qualifier"]
    role = q if q in ROLE_KEYS else "packshot"
    view = None if q in ROLE_KEYS and q != "detail" else q
    o = ASSET_OVERRIDES.get(fname, {})
    rights = dict(DEFAULT_RIGHTS)
    if o.get("embargo_until"):
        rights["embargo_until"] = o["embargo_until"]
    if o.get("credit"):
        rights["credit"] = o["credit"]
    prov = dict(DEFAULT_PROVENANCE)
    if o.get("ai_generated") == "true":
        prov.update({"ai_generated": True, "source": "generated", "generator": o.get("generator")})
    alt = {k.split(":")[1]: v for k, v in o.items() if k.startswith("alt_text:")} or None
    ww, wh = fit(meta["width"], meta["height"], 2000)
    tw, th = fit(meta["width"], meta["height"], 600)
    rend = {}
    if original:
        rend["original"] = {"name": "original", "url": ANY_URL, "url_expires_at": "{{datetime|null}}", "content_type": "image/png",
                            "width": meta["width"], "height": meta["height"], "bytes": meta["bytes"], "sha256": meta["sha256"]}
    rend["web"] = rendition("web", ww, wh)
    rend["square"] = rendition("square", max(ww, wh), max(ww, wh))
    rend["thumb"] = rendition("thumb", tw, th)
    return {
        "id": ANY_ID, "external_id": f"{meta['style']}_{meta['color']}_{meta['position']}", "product_id": ANY_ID,
        "brand_id": ANY_ID, "media_type": "image", "color_code": meta["color"], "variant_ids": None, "role": role, "view": view,
        "position": meta["position"], "filename": fname, "alt_text": alt, "content_type": "image/png",
        "width": meta["width"], "height": meta["height"], "bytes": meta["bytes"], "sha256": meta["sha256"],
        "rights": rights, "provenance": prov, "renditions": rend, "updated_at": ANY_TIME,
    }


def expected_product(style, image_meta, gtins):
    p = next(x for x in PRODUCTS if x[1] == style)
    brand, style, name, desc, itype, tg, season, coll, mats, care, origin, colors, sizes, shots = p
    variants = []
    for code, cen, cnl, sup, rgb in colors:
        for size in sizes:
            g = gtins[(style, code, size)]
            x = EXTRA[style]
            variants.append({"id": ANY_ID, "external_id": g, "product_id": ANY_ID, "brand_id": ANY_ID, "gtin": gtin14(g),
                             "gtin_original": g, "sku": sku(style, code, size),
                             "color": {"code": code, "name": {"en": cen, "nl": cnl}, "supplier_color": sup, "family": COLOR_FAMILY[code]},
                             "size": size, "size_length": x.get("size_length", {}).get(size), "size_system": size_system(style, size),
                             "measurements": x.get("measurements", {}).get(size), "updated_at": ANY_TIME})
    variants.sort(key=lambda v: v["external_id"])
    assets = [expected_asset(f, m) for f, m in image_meta.items() if m["style"] == style]
    assets.sort(key=lambda a: (a["color_code"] or "", a["position"]))
    return {
        "id": ANY_ID, "external_id": style, "brand_id": ANY_ID, "style_number": style,
        "name": {"en": name[0], "nl": name[1]}, "description": {"en": desc[0], "nl": desc[1]},
        "item_type": itype, "item_subtype": EXTRA[style].get("item_subtype"), "gpc_brick": None, "target_group": tg,
        "season": season, "collection": coll, "materials": parse_materials(mats),
        "contains_animal_origin": EXTRA[style].get("contains_animal_origin"),
        "footwear_materials": EXTRA[style].get("footwear_materials"),
        "care": [care_entry(c) for c in care.split("|")],
        "country_of_origin": origin, "certifications": EXTRA[style].get("certifications"), "dpp_url": None,
        "features": {k: EXTRA[style]["features"][k] for k in FEATURE_KEYS if k in EXTRA[style].get("features", {})} or None,
        "attributes": None,
        "created_at": ANY_TIME, "updated_at": ANY_TIME, "variants": variants, "assets": assets,
    }


def write_expected(image_meta, gtins):
    out = os.path.join(HERE, "expected")
    os.makedirs(out, exist_ok=True)

    def dump(name, obj):
        write(os.path.join(out, name), json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

    dump("product-KO-1001.json", expected_product("KO-1001", image_meta, gtins))
    for style in ("KO-1005", "KO-1008", "KO-1009", "KO-1010", "KT-2001"):
        dump(f"product-{style}.json", expected_product(style, image_meta, gtins))
    dump("asset-ai-generated.json", expected_asset("KO-1003_RST_3_model.png", image_meta["KO-1003_RST_3_model.png"]))
    dump("asset-embargoed.json", expected_asset("KO-1002_BLK_2_back.png", image_meta["KO-1002_BLK_2_back.png"]))
    dump("asset-large-original.json", expected_asset(BIG, image_meta[BIG]))
    dump("asset-without-original-scope.json", expected_asset("KO-1001_NVY_1_front.png", image_meta["KO-1001_NVY_1_front.png"], original=False))
    g1 = gtins[("KO-1001", "NVY", "M")]
    g2 = gtins[("KT-2001", "BLK", "L")]
    unknown = ean13("200099990101")
    dump("gtin-lookup.request.json", {"gtins": [g1, " " + g2[:4] + " " + g2[4:], "0" + g1, unknown, "12345", "ABC"]})
    dump("gtin-lookup.json", {
        "results": [
            {"input": g1, "gtin": gtin14(g1), "status": "matched", "product_id": ANY_ID, "variant_id": ANY_ID},
            {"input": g2[:4] + " " + g2[4:], "gtin": gtin14(g2), "status": "matched", "product_id": ANY_ID, "variant_id": ANY_ID},
            {"input": unknown, "gtin": gtin14(unknown), "status": "unmatched", "product_id": None, "variant_id": None},
            {"input": "12345", "gtin": None, "status": "invalid", "product_id": None, "variant_id": None},
            {"input": "ABC", "gtin": None, "status": "invalid", "product_id": None, "variant_id": None},
        ],
        "products": ["{{product:KO-1001}}", "{{product:KT-2001}}"],
    })
    dump("counts.json", {"brands": 2, "products": len(PRODUCTS), "variants": len(gtins), "assets": len(image_meta),
                         "note": "Visible objects after importing fixtures/kestrel into a fresh node whose first brand is external_id 'kestrel' (see fixtures/README.md)."})

# --------------------------------------------------------------------------- import cases (0.2 columns)

def write_import_cases(gtins):
    """Small products.csv files for conformance I-IMP-7, applied in order to a node that holds exactly
    the fixture import; the last case re-imports kestrel/products.csv and restores that state."""
    out = os.path.join(HERE, "imports")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        # imports/xlsx/ is written by tools/xlsx-fixtures.mjs, not here
        if os.path.isfile(os.path.join(out, old)):
            os.remove(os.path.join(out, old))
    cabin, plus = gtins[("KO-1008", "BLK", "CABIN")], gtins[("KO-1008", "BLK", "CABIN PLUS")]
    bag, boot = gtins[("KO-1009", "CHR", "ONE SIZE")], gtins[("KO-1010", "BRN", "41")]
    f1008 = dict(EXTRA["KO-1008"]["features"])
    m_cabin = dict(EXTRA["KO-1008"]["measurements"]["CABIN"])
    name = "Hardshell Cabin Spinner"
    cases = [
        ("1-feature-update.csv", ["brand", "style_number", "name:en", "feature:wheels"],
         [["Kestrel", "KO-1008", name, "2"]],
         "A file with one feature column changes only that feature; the other features of KO-1008 stay (rule 9, per key).",
         {"rows": 1, "created": 0, "updated": 1, "unchanged": 0, "errors": 0}, [],
         [("product", "upsert", "KO-1008")], {"KO-1008": {"features": dict(f1008, wheels=2)}}, {}),
        ("2-feature-clear.csv", ["brand", "style_number", "name:en", "feature:wheels"],
         [["Kestrel", "KO-1008", name, ""]],
         "An empty cell in a feature column removes that feature only.",
         {"rows": 1, "created": 0, "updated": 1, "unchanged": 0, "errors": 0}, [],
         [("product", "upsert", "KO-1008")], {"KO-1008": {"features": {k: v for k, v in f1008.items() if k != "wheels"}}}, {}),
        ("3-measurement-update.csv", ["brand", "style_number", "name:en", "gtin", "color_code", "weight_kg"],
         [["Kestrel", "KO-1008", name, cabin, "BLK", "2,7"]],
         "One measurement column with a decimal comma changes only that measurement of that variant; the product is unchanged.",
         {"rows": 1, "created": 0, "updated": 1, "unchanged": 1, "errors": 0}, [],
         [("variant", "upsert", cabin)], {}, {cabin: {"measurements": dict(m_cabin, weight_kg=2.7)}}),
        ("4-fibre-flags.csv", ["brand", "style_number", "name:en", "materials"],
         [["Kestrel Trail", "KT-2001", "Trail Running Shorts", "outer: 100% polyester (recycled); lining: 88% polyamide, 12% elastane"]],
         "The qualifier form gives the same materials as the 0.1 key recycled_polyester in the fixture: unchanged, no change entries.",
         {"rows": 1, "created": 0, "updated": 0, "unchanged": 1, "errors": 0}, [], [], {}, {}),
        ("5-invalid.csv", ["brand", "style_number", "name:en", "gtin", "color_code", "feature:wheels", "height_cm", "color_family", "footwear_materials"],
         [["Kestrel", "KO-1008", name, "", "", "3", "", "", ""],
          ["Kestrel", "KO-1009", "Commuter Laptop Messenger", bag, "CHR", "", "30 cm", "", ""],
          ["Kestrel", "KO-1010", "Leather Chelsea Boot", boot, "BRN", "", "", "navy", ""],
          ["Kestrel", "KO-1005", "Leather Weekender Bag", "", "", "", "", "", "upper: plastic"]],
         "Each row has one value outside the rules: every row is skipped with an error, nothing is written, the job succeeds.",
         {"rows": 4, "created": 0, "updated": 0, "unchanged": 0, "errors": 4},
         [{"file": "products.csv", "row": 1, "column": "feature:wheels", "severity": "error", "obx_error": "validation_failed", "value": "3"},
          {"file": "products.csv", "row": 2, "column": "height_cm", "severity": "error", "obx_error": "validation_failed", "value": "30 cm"},
          {"file": "products.csv", "row": 3, "column": "color_family", "severity": "error", "obx_error": "validation_failed", "value": "navy"},
          {"file": "products.csv", "row": 4, "column": "footwear_materials", "severity": "error", "obx_error": "validation_failed", "value": "upper: plastic"}],
         [], {}, {}),
        ("6-restore.csv", None, None,
         "kestrel/products.csv again (the same bytes): restores wheels 4 and weight 2.6; everything else is unchanged.",
         {"rows": len(gtins), "created": 0, "updated": 2, "unchanged": len(PRODUCTS) + len(gtins) - 2, "errors": 0}, [],
         [("product", "upsert", "KO-1008"), ("variant", "upsert", cabin)],
         {"KO-1008": {"features": f1008}}, {cabin: {"measurements": m_cabin}}),
    ]
    expected = []
    for fname, header, rows, what, counts, errors, changes, products, variants in cases:
        if header is None:
            with open(os.path.join(HERE, "kestrel", "products.csv"), encoding="utf-8", newline="") as f:
                data = f.read()
        else:
            buf = io.StringIO()
            w = csv.writer(buf, lineterminator="\r\n")
            w.writerow(header)
            w.writerows(rows)
            data = buf.getvalue()
        write(os.path.join(out, fname), data)
        expected.append({"file": fname, "what": what, "counts": counts, "errors": errors,
                         "changes": [{"type": t, "op": o, "external_id": e} for t, o, e in changes],
                         "products": products, "variants": variants})
    assert plus not in variants
    # I-IMP-8: label completeness warnings (dry run, nothing is written)
    header = ["brand", "style_number", "name:en", "item_type", "materials", "contains_animal_origin", "footwear_materials"]
    rows = [["Kestrel", "KL-8001", "Label Test Tee", "t_shirt", "", "no", ""],
            ["Kestrel", "KL-8002", "Label Test Scarf", "scarf", "main: 100% wool", "", ""],
            ["Kestrel", "KL-8003", "Label Test Sneaker", "sneakers", "upper: 100% polyester", "", ""],
            ["Kestrel", "KL-8004", "Label Test Shirt", "shirt", "main: 60% cotton, 30% polyester", "no", ""],
            ["Kestrel", "KL-8005", "Label Test Sandal", "sandals", "", "", "upper: leather; lining_and_sock: leather"],
            ["Kestrel", "KL-8006", "Label Test Complete", "t_shirt", "main: 100% cotton", "no", ""]]
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(header)
    w.writerows(rows)
    write(os.path.join(out, "label-warnings.csv"), buf.getvalue())
    warn = lambda row, col, code: {"file": "products.csv", "row": row, "column": col, "severity": "warning", "obx_error": code}
    write(os.path.join(out, "label-warnings.expected.json"), json.dumps({
        "description": "Conformance I-IMP-8. Send label-warnings.csv as the import's products.csv with dry_run: true (mode upsert). The job succeeds, "
                       "nothing is written (no change entries, KL-8001 to KL-8006 do not exist afterwards), there are no errors, and the ImportRowErrors whose "
                       "obx_error is one of the four label completeness codes are exactly these, in this order (other warnings are not checked). "
                       "KL-8006 is complete and gets none.",
        "warnings": [warn(1, "materials", "fibre_composition_missing"),
                     warn(2, "contains_animal_origin", "animal_origin_unknown"),
                     warn(3, "footwear_materials", "footwear_materials_missing"),
                     warn(4, "materials", "fibre_percentages_not_100"),
                     warn(5, "footwear_materials", "footwear_materials_missing")]}, indent=2, ensure_ascii=False) + "\n")
    write(os.path.join(out, "expected.json"), json.dumps({
        "description": "Conformance I-IMP-7. Apply the files in order, each sent as the import's products.csv (mode upsert, no images, no assets.csv), "
                       "to a node that holds exactly the import of fixtures/kestrel. counts: ImportRun.counts (other count fields not checked). "
                       "errors: the ImportRowErrors with severity error, in order (warnings not checked). changes: the /changes entries the import "
                       "produced, in order. products/variants: fields of the protocol objects afterwards (by external_id), matched like fixtures/expected.",
        "cases": expected}, indent=2, ensure_ascii=False) + "\n")

# --------------------------------------------------------------------------- ingest scenario

def write_ingest():
    files_dir = os.path.join(HERE, "ingest", "files")
    os.makedirs(files_dir, exist_ok=True)
    imgs = {
        "KL-9001_GRN_1.png": png(1200, 1500, "#2E7D4F", "KL-9001 GRN 1", "FRONT"),
        "KL-9001_GRN_1_v2.png": png(1200, 1500, "#2E7D4F", "KL-9001 GRN 1", "REPLACED"),
        "KL-9001_GRN_2.png": png(1200, 1500, "#2E7D4F", "KL-9001 GRN 2", "BACK"),
    }
    shas = {}
    for n, b in imgs.items():
        write(os.path.join(files_dir, n), b, "wb")
        shas[n] = {"sha256": sha(b), "bytes": len(b)}
    write(os.path.join(files_dir, "files.json"), json.dumps(shas, indent=2, sort_keys=True) + "\n")

    gs, gm = ean13("200900100101"), ean13("200900100102")
    bad = gs[:12] + str((int(gs[12]) + 1) % 10)  # wrong check digit
    product = {"brand_external_id": "kestrel-lab", "style_number": "KL-9001",
               "name": {"en": "Lab Test Shorts", "nl": "Testshort"}, "item_type": "shorts", "target_group": "unisex",
               "season": "SS27", "materials": [{"part": {"code": "main"}, "fibers": [{"material": {"code": "cotton"}, "percentage": 100}]}],
               "care": [{"code": "wash_30"}]}
    changed = dict(product, description={"en": "Now with pockets.", "nl": "Nu met zakken."})

    def asset(pos, view, f):
        return {"product_external_id": "KL-9001", "color_code": "GRN", "role": "packshot", "view": view, "position": pos,
                "files": {"original": {"sha256": shas[f]["sha256"]}}}

    steps = [
        # (operation, expected result, expected change entries [(type, op, external_id)])
        ({"op": "upsert", "kind": "brand", "external_id": "kestrel-lab", "data": {"name": "Kestrel Lab"}}, "created",
         [("brand", "upsert", "kestrel-lab")]),
        ({"op": "upsert", "kind": "product", "external_id": "KL-9001", "data": product}, "created",
         [("product", "upsert", "KL-9001")]),
        ({"op": "upsert", "kind": "variant", "external_id": gs, "data": {"product_external_id": "KL-9001", "gtin": gs,
          "color": {"code": "GRN", "name": {"en": "Green"}}, "size": "S"}}, "created", [("variant", "upsert", gs)]),
        ({"op": "upsert", "kind": "variant", "external_id": gm, "data": {"product_external_id": "KL-9001", "gtin": gm,
          "color": {"code": "GRN", "name": {"en": "Green"}}, "size": "M"}}, "created", [("variant", "upsert", gm)]),
        ({"op": "upsert", "kind": "asset", "external_id": "KL-9001_GRN_1", "data": asset(1, "front", "KL-9001_GRN_1.png")},
         "created", [("asset", "upsert", "KL-9001_GRN_1")]),
        ({"op": "upsert", "kind": "product", "external_id": "KL-9001", "data": product}, "unchanged", []),
        ({"op": "upsert", "kind": "product", "external_id": "KL-9001", "data": changed}, "updated",
         [("product", "upsert", "KL-9001")]),
        ({"op": "upsert", "kind": "asset", "external_id": "KL-9001_GRN_1", "data": asset(1, "front", "KL-9001_GRN_1_v2.png")},
         "updated", [("asset", "upsert", "KL-9001_GRN_1")]),
        ({"op": "upsert", "kind": "asset", "external_id": "KL-9001_GRN_2", "data": asset(2, "back", "KL-9001_GRN_2.png")},
         "created", [("asset", "upsert", "KL-9001_GRN_2")]),
        ({"op": "upsert", "kind": "asset", "external_id": "KL-9001_GRN_2b", "data": asset(2, "back", "KL-9001_GRN_2.png")},
         "error:position_conflict", []),
        ({"op": "unpublish", "kind": "asset", "external_id": "KL-9001_GRN_2"}, "updated",
         [("asset", "delete", "KL-9001_GRN_2")]),
        ({"op": "upsert", "kind": "variant", "external_id": "bad-gtin", "data": {"product_external_id": "KL-9001",
          "gtin": bad, "color": {"code": "GRN"}, "size": "L"}}, "error:invalid_gtin", []),
        ({"op": "patch", "kind": "variant", "external_id": gm, "data": {"size_system": "INT"}}, "updated",
         [("variant", "upsert", gm)]),
        ({"op": "unpublish", "kind": "product", "external_id": "KL-9001"}, "updated",
         [("product", "delete", "KL-9001"), ("variant", "delete", gs), ("variant", "delete", gm),
          ("asset", "delete", "KL-9001_GRN_1")]),
        ({"op": "publish", "kind": "product", "external_id": "KL-9001"}, "updated",
         [("product", "upsert", "KL-9001"), ("variant", "upsert", gs), ("variant", "upsert", gm),
          ("asset", "upsert", "KL-9001_GRN_1")]),
        ({"op": "delete", "kind": "variant", "external_id": gm}, "deleted", [("variant", "delete", gm)]),
        ({"op": "delete", "kind": "variant", "external_id": gm}, "unchanged", []),
        ({"op": "delete", "kind": "product", "external_id": "KL-9001"}, "deleted",
         [("product", "delete", "KL-9001"), ("variant", "delete", gs), ("asset", "delete", "KL-9001_GRN_1")]),
    ]
    assert ean13(bad[:12]) != bad
    lines = "".join(json.dumps(op, ensure_ascii=False, separators=(",", ":")) + "\n" for op, _, _ in steps)
    write(os.path.join(HERE, "ingest", "script.ndjson"), lines)
    results = []
    for i, (op, res, _) in enumerate(steps):
        r = {"index": i, "op": op["op"], "kind": op["kind"], "external_id": op["external_id"]}
        if res.startswith("error:"):
            r.update(result="error", obx_error=res.split(":")[1])
        else:
            r["result"] = res
        results.append(r)
    write(os.path.join(HERE, "ingest", "expected-results.json"), json.dumps(results, indent=2) + "\n")
    changes = [{"after_op": i, "type": t, "op": o, "external_id": e} for i, (_, _, ch) in enumerate(steps) for t, o, e in ch]
    write(os.path.join(HERE, "ingest", "expected-changes.json"), json.dumps({
        "description": "Live /changes entries (after draining the initial snapshot) produced by replaying script.ndjson in order on a node that already contains nothing but the setup brand. after_op = 0-based index of the operation that produced the entry.",
        "changes": changes}, indent=2) + "\n")


if __name__ == "__main__":
    main()
