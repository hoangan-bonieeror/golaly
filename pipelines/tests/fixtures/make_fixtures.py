"""Builds small SYNTHETIC fixture files shaped exactly like the real sources:

- overture/fixture/theme=places/type=place/*.parquet        (Overture Places schema, Sept 2026 release)
- overture/fixture/theme=divisions/type=division_area/*.parquet
- osm/hoian.osm                                            (OSM XML; pyosmium reads it like a .pbf)
- fsq/dt=fixture/places/parquet/*.parquet                   (Foursquare OS Places schema)

Coordinates are approximate and boundaries are simplified rectangles — good enough to exercise
the pipeline end-to-end, not real data. Run: python tests/fixtures/make_fixtures.py
"""

from __future__ import annotations

import json
import struct
from pathlib import Path

import duckdb

HERE = Path(__file__).parent


def wkb_point(x: float, y: float) -> bytes:
    return struct.pack("<BIdd", 1, 1, x, y)


def wkb_box(x0: float, y0: float, x1: float, y1: float) -> bytes:
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]
    return struct.pack("<BIII", 1, 3, 1, len(ring)) + b"".join(struct.pack("<dd", *p) for p in ring)


# id, primary, common{lang: name}, basic_category, taxonomy hierarchy, confidence, lat, lng, phone, website, address, status
PLACES = [
    (
        "ovt-chua-cau",
        "Chùa Cầu",
        {"en": "Japanese Covered Bridge"},
        "landmark_and_historical_building",
        ["attractions_and_activities", "landmark_and_historical_building"],
        0.95,
        15.87732,
        108.32585,
        None,
        None,
        "Nguyễn Thị Minh Khai, Minh An",
        "open",
    ),
    (
        "ovt-banh-mi-phuong",
        "Bánh Mì Phượng",
        {"en": "Banh Mi Phuong"},
        "restaurant",
        ["food_and_drink", "restaurant", "vietnamese_restaurant"],
        0.93,
        15.87945,
        108.33172,
        "+84 235 0000 001",
        "banhmiphuong.example?utm_source=x",
        "2B Phan Châu Trinh",
        "open",
    ),
    (
        "ovt-reaching-out",
        "Reaching Out Tea House",
        {},
        "cafe",
        ["food_and_drink", "beverage_shop", "tea_room"],
        0.9,
        15.87760,
        108.32910,
        None,
        "https://reachingout.example/teahouse",
        "131 Trần Phú",
        "open",
    ),
    (
        "ovt-night-market",
        "Chợ đêm Hội An",
        {"en": "Hoi An Night Market"},
        "market",
        ["shopping", "market", "night_market"],
        0.88,
        15.87655,
        108.32610,
        None,
        None,
        "Nguyễn Hoàng, An Hội",
        "open",
    ),
    (
        "ovt-faifo",
        "Faifo Coffee",
        {},
        "cafe",
        ["food_and_drink", "cafe", "coffee_shop"],
        0.86,
        15.87720,
        108.32700,
        "0235 0000 002",
        None,
        "130 Trần Phú",
        "open",
    ),
    (
        "ovt-tan-ky",
        "Nhà cổ Tấn Ký",
        {"en": "Tan Ky Old House"},
        "historic_site",
        ["attractions_and_activities", "landmark_and_historical_building", "historic_site"],
        0.9,
        15.87660,
        108.32790,
        None,
        None,
        "101 Nguyễn Thái Học",
        "open",
    ),
    ("ovt-an-bang", "An Bàng Beach", {"vi": "Bãi biển An Bàng"}, "beach", ["outdoors", "beach"], 0.92, 15.91410, 108.34175, None, None, "Cẩm An", "open"),
    ("ovt-low-confidence", "Spam Listing 123", {}, "restaurant", ["food_and_drink", "restaurant"], 0.2, 15.8800, 108.3300, None, None, None, "open"),
    ("ovt-dentist", "Nha khoa Minh An", {}, "dentist", ["health_and_medical", "dentist"], 0.9, 15.87800, 108.33000, None, None, None, "open"),
    ("ovt-closed-cafe", "Old Lantern Cafe", {}, "cafe", ["food_and_drink", "cafe"], 0.8, 15.87690, 108.32650, None, None, None, "permanently_closed"),
    (
        "ovt-dragon-bridge",
        "Cầu Rồng",
        {"en": "Dragon Bridge"},
        "landmark_and_historical_building",
        ["attractions_and_activities", "landmark_and_historical_building"],
        0.95,
        16.06120,
        108.22720,
        None,
        None,
        "Đà Nẵng",
        "open",
    ),
]

DIVISIONS = [
    # external id, subtype, primary, common, region code, bbox
    ("div-vn", "country", "Việt Nam", {"en": "Vietnam"}, None, (102.1, 8.2, 109.5, 23.4)),
    ("div-vn-dn", "region", "Đà Nẵng", {"en": "Da Nang"}, "VN-DN", (107.2, 14.9, 108.75, 16.25)),
    ("div-vn-hn", "region", "Hà Nội", {"en": "Hanoi"}, "VN-HN", (105.25, 20.55, 106.05, 21.4)),
]


def sql_map(d: dict[str, str]) -> str:
    if not d:
        return "MAP {}::MAP(VARCHAR, VARCHAR)"
    return "MAP {" + ", ".join(f"'{k}': '{v}'" for k, v in d.items()) + "}"


def lit(v):
    return "NULL" if v is None else "'" + str(v).replace("'", "''") + "'"


def build_overture(con: duckdb.DuckDBPyConnection) -> None:
    base = HERE / "overture" / "fixture"
    places_dir = base / "theme=places" / "type=place"
    places_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for pid, primary, common, basic, hierarchy, conf, lat, lng, phone, web, addr, status in PLACES:
        rows.append(
            f"""SELECT {lit(pid)} AS id,
              {{'primary': {lit(primary)}, 'common': {sql_map(common)}}} AS names,
              {lit(basic)} AS basic_category,
              {{'primary': {lit(hierarchy[-1])}, 'hierarchy': {hierarchy}::VARCHAR[], 'alternates': []::VARCHAR[]}} AS taxonomy,
              {conf}::DOUBLE AS confidence,
              {f"[{lit(web)}]" if web else "NULL::VARCHAR[]"} AS websites,
              {f"[{lit(phone)}]" if phone else "NULL::VARCHAR[]"} AS phones,
              {f"[{{'freeform': {lit(addr)}, 'locality': 'Hội An', 'postcode': NULL::VARCHAR, 'region': 'VN-DN', 'country': 'VN'}}]" if addr else "NULL::STRUCT(freeform VARCHAR, locality VARCHAR, postcode VARCHAR, region VARCHAR, country VARCHAR)[]"} AS addresses,
              {lit(status)} AS operating_status,
              [{{'property': '', 'dataset': 'fixture', 'record_id': {lit(pid)}, 'confidence': {conf}::DOUBLE}}] AS sources,
              {{'xmin': {lng}::FLOAT, 'xmax': {lng}::FLOAT, 'ymin': {lat}::FLOAT, 'ymax': {lat}::FLOAT}} AS bbox,
              from_hex('{wkb_point(lng, lat).hex()}') AS geometry"""
        )
    con.execute("CREATE OR REPLACE TABLE places AS " + " UNION ALL ".join(rows))
    geo = json.dumps({"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["Point"]}}})
    con.execute(f"COPY places TO '{places_dir / 'part-00000.parquet'}' (FORMAT parquet, KV_METADATA {{geo: '{geo}'}})")

    div_dir = base / "theme=divisions" / "type=division_area"
    div_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for ext, subtype, primary, common, region, (x0, y0, x1, y1) in DIVISIONS:
        rows.append(
            f"""SELECT {lit(ext + "-area")} AS id, {lit(ext)} AS division_id, {lit(subtype)} AS subtype, 'land' AS class,
              {{'primary': {lit(primary)}, 'common': {sql_map(common)}}} AS names, 'VN' AS country, {lit(region)} AS region,
              {{'xmin': {x0}::FLOAT, 'xmax': {x1}::FLOAT, 'ymin': {y0}::FLOAT, 'ymax': {y1}::FLOAT}} AS bbox,
              from_hex('{wkb_box(x0, y0, x1, y1).hex()}') AS geometry"""
        )
    con.execute("CREATE OR REPLACE TABLE divisions AS " + " UNION ALL ".join(rows))
    geo = json.dumps({"version": "1.1.0", "primary_column": "geometry", "columns": {"geometry": {"encoding": "WKB", "geometry_types": ["Polygon"]}}})
    con.execute(f"COPY divisions TO '{div_dir / 'part-00000.parquet'}' (FORMAT parquet, KV_METADATA {{geo: '{geo}'}})")


# fsq_place_id, name, lat, lng, address, tel, website, category labels, date_refreshed, date_closed, unresolved_flags
FSQ = [
    # Same place as Overture's / OSM's bánh mì shop (attaches by name), with a finer category.
    (
        "fsq-banh-mi",
        "Bánh Mì Phượng",
        15.87946,
        108.33170,
        "2B Phan Châu Trinh",
        "0235 0000 001",
        None,
        ["Dining and Drinking > Restaurant > Asian Restaurant > Vietnamese Restaurant"],
        "2026-08-01",
        None,
        [],
    ),
    # Only in Foursquare.
    (
        "fsq-reaching-out",
        "Reaching Out Tea House",
        15.87705,
        108.32905,
        "131 Trần Phú",
        None,
        "reachingoutvietnam.example",
        ["Dining and Drinking > Cafe, Coffee, and Tea House > Tea Room"],
        "2026-07-15",
        None,
        [],
    ),
    ("fsq-tailor", "Bebe Tailor", 15.87790, 108.32990, "11 Hoàng Diệu", None, None, ["Retail > Fashion Retail > Tailor Shop"], "2026-06-01", None, []),
    # Closed upstream → kept as closed.
    (
        "fsq-closed",
        "Old Town Noodles",
        15.87720,
        108.32800,
        None,
        None,
        None,
        ["Dining and Drinking > Restaurant > Noodle Restaurant"],
        "2026-05-01",
        "2025-11-01",
        [],
    ),
    # Not refreshed for years → skipped (stale listings are common in Foursquare data).
    ("fsq-stale", "Ghost Bar", 15.87700, 108.32700, None, None, None, ["Dining and Drinking > Bar"], "2019-01-01", None, []),
    # Flagged as not existing → skipped.
    (
        "fsq-flagged",
        "Fake Spa",
        15.87760,
        108.32760,
        None,
        None,
        None,
        ["Business and Professional Services > Health and Beauty Service > Spa"],
        "2026-08-01",
        None,
        ["doesnt_exist"],
    ),
    # A dentist: stored, but not a travel category (no mapping) → not published.
    ("fsq-dentist", "Nha Khoa Hội An", 15.87810, 108.33010, None, None, None, ["Health and Medicine > Dentist"], "2026-08-01", None, []),
    # Outside the Hội An box.
    ("fsq-danang", "Cầu Rồng", 16.06110, 108.22760, None, None, None, ["Landmarks and Outdoors > Bridge"], "2026-08-01", None, []),
]


def build_fsq(con: duckdb.DuckDBPyConnection) -> None:
    out = HERE / "fsq" / "dt=fixture" / "places" / "parquet"
    out.mkdir(parents=True, exist_ok=True)
    rows = []
    for pid, name, lat, lng, addr, tel, web, labels, refreshed, closed, flags in FSQ:
        rows.append(
            f"""SELECT {lit(pid)} AS fsq_place_id, {lit(name)} AS name, {lat}::DOUBLE AS latitude, {lng}::DOUBLE AS longitude,
              {lit(addr)} AS address, 'Hội An' AS locality, 'Quảng Nam' AS region, NULL::VARCHAR AS postcode, 'VN' AS country,
              DATE '2015-01-01' AS date_created, DATE {lit(refreshed)} AS date_refreshed, {f"DATE {lit(closed)}" if closed else "NULL::DATE"} AS date_closed,
              {lit(tel)} AS tel, {lit(web)} AS website, NULL::VARCHAR AS email,
              ['cat-' || {lit(pid)}]::VARCHAR[] AS fsq_category_ids, {labels}::VARCHAR[] AS fsq_category_labels,
              {flags}::VARCHAR[] AS unresolved_flags,
              {{'xmin': {lng}::DOUBLE, 'ymin': {lat}::DOUBLE, 'xmax': {lng}::DOUBLE, 'ymax': {lat}::DOUBLE}} AS bbox,
              from_hex('{wkb_point(lng, lat).hex()}') AS geom"""
        )
    con.execute("CREATE OR REPLACE TABLE fsq AS " + " UNION ALL ".join(rows))
    con.execute(f"COPY fsq TO '{out / 'places-00000.zstd.parquet'}' (FORMAT parquet)")


OSM = """<?xml version='1.0' encoding='UTF-8'?>
<osm version="0.6" generator="golaly-fixture">
  <node id="1001" lat="15.87948" lon="108.33166" version="1">
    <tag k="amenity" v="fast_food"/><tag k="cuisine" v="vietnamese"/><tag k="name" v="Bánh Mì Phượng"/>
    <tag k="name:en" v="Banh Mi Phuong"/><tag k="opening_hours" v="Mo-Su 06:30-21:30"/><tag k="phone" v="+84 235 0000 001"/>
  </node>
  <node id="1002" lat="15.87710" lon="108.32640" version="1">
    <tag k="amenity" v="restaurant"/><tag k="cuisine" v="vietnamese"/><tag k="name" v="Morning Glory"/>
    <tag k="addr:housenumber" v="106"/><tag k="addr:street" v="Nguyễn Thái Học"/><tag k="website" v="morningglory.example"/>
  </node>
  <node id="1003" lat="15.87712" lon="108.32760" version="1">
    <tag k="tourism" v="attraction"/><tag k="name" v="Phố cổ Hội An"/><tag k="name:en" v="Hội An Ancient Town"/>
  </node>
  <node id="1004" lat="15.87800" lon="108.33010" version="1"><tag k="shop" v="supermarket"/><tag k="name" v="Mini Mart"/></node>
  <node id="1005" lat="15.87820" lon="108.33020" version="1"><tag k="amenity" v="cafe"/></node>
  <node id="1006" lat="15.87660" lon="108.32700" version="1">
    <tag k="disused:amenity" v="cafe"/><tag k="amenity" v="cafe"/><tag k="name" v="Closed Corner Cafe"/>
  </node>
  <node id="2001" lat="15.87730" lon="108.32575" version="1"/>
  <node id="2002" lat="15.87730" lon="108.32595" version="1"/>
  <node id="2003" lat="15.87736" lon="108.32595" version="1"/>
  <node id="2004" lat="15.87736" lon="108.32575" version="1"/>
  <way id="3001" version="1">
    <nd ref="2001"/><nd ref="2002"/><nd ref="2003"/><nd ref="2004"/><nd ref="2001"/>
    <tag k="historic" v="yes"/><tag k="tourism" v="attraction"/><tag k="name" v="Chùa Cầu"/><tag k="name:en" v="Japanese Covered Bridge"/><tag k="wikidata" v="Q900001"/>
    <tag k="name:ja" v="来遠橋"/><tag k="name:prefix" v="not-a-language"/>
  </way>
</osm>
"""


def main() -> None:
    con = duckdb.connect()
    build_overture(con)
    build_fsq(con)
    (HERE / "osm").mkdir(exist_ok=True)
    (HERE / "osm" / "hoian.osm").write_text(OSM, encoding="utf-8")
    print("fixtures written to", HERE)


if __name__ == "__main__":
    main()
