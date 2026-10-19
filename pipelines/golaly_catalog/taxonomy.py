"""Golaly taxonomy + provider category maps (data/*.json) → categories / category_maps tables."""

from __future__ import annotations

import json
from functools import lru_cache
from importlib import resources
from typing import Any

import psycopg


@lru_cache
def load_taxonomy() -> list[dict[str, Any]]:
    return json.loads(resources.files("golaly_catalog.data").joinpath("taxonomy.json").read_text("utf-8"))["categories"]


@lru_cache
def load_maps() -> dict[str, dict[str, str]]:
    data = json.loads(resources.files("golaly_catalog.data").joinpath("category_maps.json").read_text("utf-8"))
    return {k: v for k, v in data.items() if not k.startswith("_")}


def osm_keys() -> set[str]:
    """Every OSM 'key=value' that can map to a category (used to pre-filter the OSM extract)."""
    return {k.split(";", 1)[0] for k in load_maps()["osm"]}


def sync_taxonomy(conn: psycopg.Connection) -> dict[str, int]:
    """Upserts categories by key and provider maps; never deletes (admins may have added maps)."""
    ids: dict[str, str] = {}
    for c in sorted(load_taxonomy(), key=lambda c: (c["parent"] is not None, c["sort_order"])):
        row = conn.execute(
            """
            INSERT INTO categories (id, parent_id, key, label_vi, label_en, item_type, sort_order)
            VALUES (gen_random_uuid(), %s, %s, %s, %s, %s::"ItemType", %s)
            ON CONFLICT (key) DO UPDATE SET parent_id = EXCLUDED.parent_id, label_vi = EXCLUDED.label_vi,
              label_en = EXCLUDED.label_en, item_type = EXCLUDED.item_type, sort_order = EXCLUDED.sort_order
            RETURNING id::text AS id
            """,
            [ids.get(c["parent"]) if c["parent"] else None, c["key"], c["label_vi"], c["label_en"], c["item_type"], c["sort_order"]],
        ).fetchone()
        assert row
        ids[c["key"]] = row["id"]
    maps = 0
    for provider, mapping in load_maps().items():
        for external, key in mapping.items():
            conn.execute(
                """
                INSERT INTO category_maps (provider, external_category, category_id) VALUES (%s, %s, %s)
                ON CONFLICT (provider, external_category) DO UPDATE SET category_id = EXCLUDED.category_id
                """,
                [provider, external, ids[key]],
            )
            maps += 1
    conn.commit()
    return {"categories": len(ids), "category_maps": maps}
