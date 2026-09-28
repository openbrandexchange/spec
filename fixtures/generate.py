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
     "t_shirt", "women", "SS26", "Essentials", "main: 100% organic_cotton",
     "wash_40|do_not_bleach|tumble_dry_low|iron_medium|dry_clean_p", "PT",
     [("WHT", "White", "Wit", "Chalk", "#F7F7F2"), ("BLK", "Black", "Zwart", "Jet", "#1A1A1A"), ("RST", "Rust", "Roest", "Burnt Rust", "#A0472A")],
     ["XS", "S", "M", "L"], [("front", None), ("back", None)]),
    ("kestrel", "KO-1004", ("Selvedge Straight Jeans", "Rechte selvedge jeans"),
     ("Straight-leg jeans in rigid selvedge denim.", "Jeans met rechte pijp van stugge selvedge denim."),
     "jeans", "men", "NOS", "Denim", "main: 98% cotton, 2% elastane",
     "wash_30|do_not_bleach|do_not_tumble_dry|iron_medium|dry_clean_p", "IT",
     [("IND", "Indigo", "Indigo", "Rinse Indigo", "#26345C")],
     ["30/32", "32/32", "34/32"], [("front", None), ("back", None), ("detail", "detail")]),
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
    ("kestrel-trail", "KT-2001", ("Trail Running Shorts", "Trailrunning short"),
     ("Lightweight running shorts with inner brief.", "Lichte hardloopshort met binnenbroekje."),
     "shorts", "men", "SS26", "Trail", "outer: 100% recycled_polyester; lining: 88% polyamide, 12% elastane",
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

# assets.csv overrides: basename -> dict
ASSET_OVERRIDES = {
    "KO-1003_RST_3_model.png": {"ai_generated": "true", "ai_edited": "false", "source": "generated", "c2pa": "none",
                                "generator": "fictional-image-model 1.0",
                                "alt_text:en": "AI-generated image of a model wearing the rust tee",
                                "alt_text:nl": "Met AI gegenereerd beeld van een model in het roestkleurige T-shirt"},
    "KO-1002_BLK_2_back.png": {"embargo_until": "2030-01-01T00:00:00Z", "credit": "Photo: Kestrel Studio"},
}
BIG = "KO-1002_OLV_1_front.png"  # 2400x3000 original to exercise downscaling

PRODUCTS_HEADER = ["brand", "style_number", "name:en", "name:nl", "description:en", "description:nl", "item_type",
                   "target_group", "season", "collection", "materials", "care", "country_of_origin",
                   "variant_id", "gtin", "sku", "color_code", "color_name:en", "color_name:nl", "supplier_color",
                   "size", "size_system"]
ASSETS_HEADER = ["file", "role", "view", "alt_text:en", "alt_text:nl", "embargo_until", "credit",
                 "ai_generated", "ai_edited", "source", "c2pa", "generator"]

DEFAULT_RIGHTS = {"license": "retailer-use", "license_text": None, "channels": ["webshop", "marketplace", "social"],
                  "territories": None, "embargo_until": None, "expires_at": None, "credit": None, "model_release": None}
DEFAULT_PROVENANCE = {"ai_generated": False, "ai_edited": False, "source": "photo", "c2pa": "none",
                      "c2pa_manifest_url": None, "generator": None}


def parse_materials(s):
    parts = []
    for chunk in s.split(";"):
        chunk = chunk.strip()
        part, _, fibers = chunk.partition(":") if ":" in chunk else ("main", "", chunk)
        out = []
        for f in fibers.split(","):
            pct, _, fiber = f.strip().partition("% ")
            out.append({"fiber": fiber.strip(), "percentage": int(pct)})
        parts.append({"part": part.strip(), "fibers": out})
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
                rows.append([BRANDS[brand], style, name[0], name[1], desc[0], desc[1], itype, tg, season, coll, mats, care, origin,
                             "", g, f"{style}-{code}-{size.replace(' ', '').replace('/', '-')}", code, cen, cnl, sup, size,
                             "EU" if size[0].isdigit() else ("" if size == "ONE SIZE" else "INT")])
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
            variants.append({"id": ANY_ID, "external_id": g, "product_id": ANY_ID, "brand_id": ANY_ID, "gtin": gtin14(g),
                             "gtin_original": g, "sku": f"{style}-{code}-{size.replace(' ', '').replace('/', '-')}",
                             "color": {"code": code, "name": {"en": cen, "nl": cnl}, "supplier_color": sup},
                             "size": size, "size_system": "EU" if size[0].isdigit() else (None if size == "ONE SIZE" else "INT"),
                             "updated_at": ANY_TIME})
    variants.sort(key=lambda v: v["external_id"])
    assets = [expected_asset(f, m) for f, m in image_meta.items() if m["style"] == style]
    assets.sort(key=lambda a: (a["color_code"] or "", a["position"]))
    return {
        "id": ANY_ID, "external_id": style, "brand_id": ANY_ID, "style_number": style,
        "name": {"en": name[0], "nl": name[1]}, "description": {"en": desc[0], "nl": desc[1]},
        "item_type": itype, "gpc_brick": None, "target_group": tg, "season": season, "collection": coll,
        "materials": parse_materials(mats), "care": [{"code": c, "text": None} for c in care.split("|")],
        "country_of_origin": origin, "dpp_url": None, "attributes": None,
        "created_at": ANY_TIME, "updated_at": ANY_TIME, "variants": variants, "assets": assets,
    }


def write_expected(image_meta, gtins):
    out = os.path.join(HERE, "expected")
    os.makedirs(out, exist_ok=True)

    def dump(name, obj):
        write(os.path.join(out, name), json.dumps(obj, indent=2, ensure_ascii=False) + "\n")

    dump("product-KO-1001.json", expected_product("KO-1001", image_meta, gtins))
    dump("product-KO-1005.json", expected_product("KO-1005", image_meta, gtins))
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
               "season": "SS27", "materials": [{"part": "main", "fibers": [{"fiber": "cotton", "percentage": 100}]}],
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
