#!/usr/bin/env python3
"""
Read CSVs in instance/csvs and produce instance/sql_upserts.sql containing
INSERT ... ON CONFLICT ... DO UPDATE statements suitable for importing
into Postgres via a web SQL console or psql.

Usage (Git Bash):
  python scripts/csvs_to_upsert_sql.py
Output:
  instance/sql_upserts.sql
Notes:
  - This script assumes CSV files were created by scripts/export_sqlite_to_csv.py
  - It uses ON CONFLICT on the following keys:
      brand -> name
      product -> id
      homepage_product -> homepage_id
      coupon -> code
  - Adjust conflict keys if your Postgres schema differs.
"""
import csv
import html
from pathlib import Path

CSV_DIR = Path("instance/csvs")
OUT_FILE = Path("instance/sql_upserts.sql")


def q(v):
    # Return SQL literal for value v: NULL or single-quoted escaped string
    if v is None or v == "":
        return "NULL"
    s = str(v)
    # Escape single quotes by doubling them
    s = s.replace("'", "''")
    return f"'{s}'"


def make_brand_rows(path):
    rows = []
    with path.open(newline="", encoding="utf8") as f:
        r = csv.DictReader(f)
        for rec in r:
            name = rec.get("name", "")
            description = rec.get("description", "")
            rows.append((name, description))
    return rows


def make_product_rows(path):
    cols = ["id", "brand", "title", "price", "description", "keyNotes",
            "image_url", "thumbnails", "status", "quantity", "tags"]
    rows = []
    with path.open(newline="", encoding="utf8") as f:
        r = csv.DictReader(f)
        for rec in r:
            row = [rec.get(c, "") for c in cols]
            rows.append(row)
    return cols, rows


def make_homepage_rows(path):
    cols = ["homepage_id", "section", "product_id", "sort_order", "visible"]
    rows = []
    with path.open(newline="", encoding="utf8") as f:
        r = csv.DictReader(f)
        for rec in r:
            rows.append([rec.get(c, "") for c in cols])
    return cols, rows


def make_coupon_rows(path):
    cols = ["code", "description", "discount_type",
            "discount_value", "start_date", "end_date", "active"]
    rows = []
    with path.open(newline="", encoding="utf8") as f:
        r = csv.DictReader(f)
        for rec in r:
            rows.append([rec.get(c, "") for c in cols])
    return cols, rows


def write_sql():
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open("w", encoding="utf8") as out:
        out.write("-- SQL upserts generated from instance/csvs\n")
        out.write(
            "-- Run this file in your Postgres provider console or via psql on a machine that can connect\n\n")

        # BRAND
        bfile = CSV_DIR / "brand.csv"
        if bfile.exists():
            for name, description in make_brand_rows(bfile):
                out.write("INSERT INTO brand (name, description) VALUES (" +
                          q(name) + ", " + q(description) + ")\n")
                out.write(
                    "  ON CONFLICT (name) DO UPDATE SET description = EXCLUDED.description;\n")
            out.write("\n")

        # PRODUCT
        pfile = CSV_DIR / "product.csv"
        if pfile.exists():
            cols, rows = make_product_rows(pfile)
            # note: keyNotes column needs quoting in SQL identifier, use "keyNotes"
            sql_cols = []
            for c in cols:
                if c == "keyNotes":
                    sql_cols.append('"keyNotes"')
                else:
                    sql_cols.append(c)
            col_list = ", ".join(sql_cols)
            for r in rows:
                # ensure numeric price/quantity become NULL if empty
                id_v = r[0]
                vals = []
                for idx, c in enumerate(cols):
                    v = r[idx]
                    if c in ("price",):
                        vals.append("NULL" if v == "" else v)
                    elif c in ("quantity",):
                        vals.append("NULL" if v == "" else v)
                    else:
                        vals.append(q(v))
                out.write(
                    f"INSERT INTO product ({col_list}) VALUES ({', '.join(vals)})\n")
                out.write("  ON CONFLICT (id) DO UPDATE SET\n")
                # skip id in update list
                updates = []
                for idx, c in enumerate(sql_cols):
                    if cols[idx] == "id":
                        continue
                    updates.append(f"    {c} = EXCLUDED.{c}")
                out.write(",\n".join(updates) + ";\n")
            out.write("\n")

        # HOMEPAGE_PRODUCT
        hfile = CSV_DIR / "homepage_product.csv"
        if hfile.exists():
            cols, rows = make_homepage_rows(hfile)
            col_list = ", ".join(cols)
            for r in rows:
                vals = []
                for idx, c in enumerate(cols):
                    v = r[idx]
                    if c in ("homepage_id", "product_id", "sort_order"):
                        vals.append("NULL" if v == "" else v)
                    elif c == "visible":
                        # normalize visible to true/false or NULL
                        vv = (v or "").strip().lower()
                        if vv in ("1", "true", "t", "yes", "y"):
                            vals.append("true")
                        elif vv in ("0", "false", "f", "no", "n"):
                            vals.append("false")
                        else:
                            vals.append("NULL")
                    else:
                        vals.append(q(v))
                out.write(
                    f"INSERT INTO homepage_product ({col_list}) VALUES ({', '.join(vals)})\n")
                out.write("  ON CONFLICT (homepage_id) DO UPDATE SET\n")
                updates = []
                for idx, c in enumerate(cols):
                    if c == "homepage_id":
                        continue
                    updates.append(f"    {c} = EXCLUDED.{c}")
                out.write(",\n".join(updates) + ";\n")
            out.write("\n")

        # COUPON
        cfile = CSV_DIR / "coupon.csv"
        if cfile.exists():
            cols, rows = make_coupon_rows(cfile)
            col_list = ", ".join(cols)
            for r in rows:
                vals = []
                for idx, c in enumerate(cols):
                    v = r[idx]
                    if c == "discount_value":
                        vals.append("NULL" if v == "" else v)
                    elif c == "active":
                        vv = (v or "").strip().lower()
                        if vv in ("1", "true", "t", "yes", "y"):
                            vals.append("true")
                        elif vv in ("0", "false", "f", "no", "n"):
                            vals.append("false")
                        else:
                            vals.append("NULL")
                    else:
                        vals.append(q(v))
                out.write(
                    f"INSERT INTO coupon ({col_list}) VALUES ({', '.join(vals)})\n")
                out.write("  ON CONFLICT (code) DO UPDATE SET\n")
                updates = []
                for idx, c in enumerate(cols):
                    if c == "code":
                        continue
                    updates.append(f"    {c} = EXCLUDED.{c}")
                out.write(",\n".join(updates) + ";\n")
            out.write("\n")

    print("Wrote", OUT_FILE.resolve())


if __name__ == "__main__":
    write_sql()
