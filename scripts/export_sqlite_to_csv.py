#!/usr/bin/env python3
"""
Export selected tables from a sqlite file into CSV files under instance/csvs/.
Usage:
  export SOURCE_SQLITE="/absolute/path/to/instance/database.db"
  python scripts/export_sqlite_to_csv.py
"""
import os
import csv
import sqlite3
from pathlib import Path

SRC = os.environ.get("SOURCE_SQLITE", "instance/database.db")
OUT_DIR = Path("instance/csvs")
OUT_DIR.mkdir(parents=True, exist_ok=True)

tables = {
    "brand": ["name", "description"],
    "product": ["id", "brand", "title", "price", "description", "keyNotes", "image_url", "thumbnails", "status", "quantity", "tags"],
    "homepage_product": ["homepage_id", "section", "product_id", "sort_order", "visible"],
    "coupon": ["code", "description", "discount_type", "discount_value", "start_date", "end_date", "active"],
    "story": ["id", "title", "slug", "section", "excerpt", "body_html", "author", "featured_image", "published", "published_at", "position"],
    "setting": ["key", "value"]
}


def export_table(conn, table, cols):
    cur = conn.cursor()
    try:
        cur.execute(f"SELECT {','.join(cols)} FROM {table}")
    except Exception as e:
        print(f"Skipping {table}: {e}")
        return
    rows = cur.fetchall()
    out_path = OUT_DIR / f"{table}.csv"
    with open(out_path, "w", newline="", encoding="utf8") as f:
        w = csv.writer(f)
        w.writerow(cols)
        for r in rows:
            w.writerow(list(r))
    print(f"Wrote {out_path} ({len(rows)} rows)")


def main():
    if not Path(SRC).is_file():
        print("Source sqlite not found:", SRC)
        return
    conn = sqlite3.connect(SRC)
    for t, cols in tables.items():
        export_table(conn, t, cols)
    conn.close()
    print("CSV export complete. Files in:", OUT_DIR.resolve())


if __name__ == "__main__":
    main()
