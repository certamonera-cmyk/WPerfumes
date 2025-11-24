#!/usr/bin/env python3
"""
Transfer selected rows from a local SQLite dev DB into the Postgres DATABASE_URL.

Usage (git-bash):
  # You can set POSTGRES_DSN explicitly, otherwise the script will read:
  #  - env DATABASE_URL (if pointing to Postgres), or
  #  - instance/config.py DATABASE_URL
  export POSTGRES_DSN="postgresql://user:pass@host:5432/dbname?sslmode=require"
  python scripts/transfer_sqlite_to_postgres.py

What it does:
  - Finds a local sqlite DB file (instance/dev.sqlite3, instance/dev.db, instance/dev.sqlite)
  - Uses your app.create_app() to load models/session for sqlite, extracts rows
  - Recreates a target Flask app using your Postgres DATABASE_URL and upserts rows
  - Attempts to reconcile missing image filenames by searching app/static/images/*
"""
import os
import sys
import re
import difflib
from pathlib import Path
from typing import Dict, Any


def find_sqlite_path() -> str:
    candidates = ["instance/dev.sqlite3", "instance/dev.db",
                  "instance/dev.sqlite", "instance/dev.sqlite3"]
    if os.environ.get("SOURCE_SQLITE"):
        s = os.environ.get("SOURCE_SQLITE")
        if os.path.isfile(s):
            return os.path.abspath(s)
    for p in candidates:
        if os.path.isfile(p):
            return os.path.abspath(p)
    return ""


def find_postgres_dsn() -> str:
    if os.environ.get("POSTGRES_DSN"):
        return os.environ.get("POSTGRES_DSN")
    if os.environ.get("DATABASE_URL") and os.environ.get("DATABASE_URL").lower().startswith("postgres"):
        return os.environ.get("DATABASE_URL")
    cfg = os.path.join("instance", "config.py")
    if os.path.isfile(cfg):
        try:
            text = open(cfg, "r", encoding="utf8").read()
            m = re.search(r'DATABASE_URL\s*=\s*["\'](.+?)["\']', text)
            if m:
                return m.group(1)
        except Exception:
            pass
    return ""


def normalize_for_match(s: str) -> str:
    if not s:
        return ""
    s2 = s.lower()
    s2 = re.sub(r"[^a-z0-9]+", "_", s2)
    s2 = re.sub(r"_+", "_", s2).strip("_")
    return s2


def collect_from_sqlite(sqlite_path: str) -> Dict[str, Any]:
    print(">>> collecting from sqlite:", sqlite_path)
    os.environ["DATABASE_URL"] = "sqlite:///" + sqlite_path.replace("\\", "/")
    from app import create_app, db
    from app import models
    app = create_app()
    data = {}
    with app.app_context():
        prods = []
        for p in models.Product.query.all():
            prods.append({
                "id": p.id,
                "brand": p.brand,
                "title": p.title,
                "price": p.price,
                "description": p.description,
                "keyNotes": p.keyNotes,
                "image_url": p.image_url,
                "thumbnails": p.thumbnails,
                "status": p.status,
                "quantity": p.quantity,
                "tags": p.tags
            })
        data["products"] = prods

        brands = []
        for b in models.Brand.query.all():
            brands.append({"name": b.name, "description": b.description})
        data["brands"] = brands

        hps = []
        for h in models.HomepageProduct.query.all():
            hps.append({
                "homepage_id": h.homepage_id,
                "section": h.section,
                "product_id": h.product_id,
                "sort_order": h.sort_order,
                "visible": bool(h.visible)
            })
        data["homepage_products"] = hps

        try:
            coupons = []
            for c in models.Coupon.query.all():
                coupons.append({
                    "code": c.code,
                    "description": c.description,
                    "discount_type": c.discount_type,
                    "discount_value": c.discount_value,
                    "start_date": c.start_date,
                    "end_date": c.end_date,
                    "active": bool(c.active)
                })
            data["coupons"] = coupons
        except Exception:
            data["coupons"] = []

        try:
            settings = []
            for s in models.Setting.query.all():
                settings.append({"key": s.key, "value": s.value})
            data["settings"] = settings
        except Exception:
            data["settings"] = []

        try:
            stories = []
            for s in models.Story.query.all():
                stories.append({
                    "id": s.id, "title": s.title, "slug": s.slug, "section": s.section,
                    "excerpt": s.excerpt, "body_html": s.body_html, "author": s.author,
                    "featured_image": s.featured_image, "published": bool(s.published),
                    "published_at": s.published_at.isoformat() if s.published_at else None,
                    "position": int(s.position or 0)
                })
            data["stories"] = stories
        except Exception:
            data["stories"] = []

        try:
            orders = []
            for o in models.Order.query.all():
                orders.append({k: getattr(o, k) for k in ("id", "customer_name", "customer_email", "customer_phone",
                              "customer_address", "product_id", "product_title", "quantity", "status", "payment_method", "date")})
            data["orders"] = orders
        except Exception:
            data["orders"] = []

        try:
            attempts = []
            for a in models.OrderAttempt.query.all():
                attempts.append({k: getattr(a, k) for k in (
                    "id", "email", "product", "qty", "status", "timestamp")})
            data["order_attempts"] = attempts
        except Exception:
            data["order_attempts"] = []

        print("Collected: brands=%d products=%d homepage=%d settings=%d stories=%d" %
              (len(data.get("brands", [])), len(data.get("products", [])),
               len(data.get("homepage_products", [])), len(
                   data.get("settings", [])),
               len(data.get("stories", []))))
    return data


def reconcile_image(image_path: str, title: str, static_root: str) -> str:
    if image_path:
        if image_path.startswith("/static/"):
            candidate = os.path.join(
                static_root, image_path[len("/static/"):].lstrip("/\\"))
        else:
            candidate = os.path.join(static_root, image_path.lstrip("/\\"))
        if os.path.isfile(candidate):
            rel = os.path.relpath(candidate, static_root).replace("\\", "/")
            return rel
    search_key = normalize_for_match(title or image_path or "")
    best = None
    best_ratio = 0.0
    images_dir = os.path.join(static_root, "images")
    if not os.path.isdir(images_dir):
        return image_path or ""
    for root, dirs, files in os.walk(images_dir):
        for fn in files:
            fn_norm = normalize_for_match(fn)
            if search_key and search_key in fn_norm:
                candidate = os.path.join(root, fn)
                return os.path.relpath(candidate, static_root).replace("\\", "/")
            ratio = difflib.SequenceMatcher(
                None, search_key, fn_norm).ratio() if search_key else 0.0
            if ratio > best_ratio:
                best_ratio = ratio
                best = os.path.join(root, fn)
    if best and best_ratio >= 0.35:
        return os.path.relpath(best, static_root).replace("\\", "/")
    return image_path or ""


def upsert_to_postgres(data: Dict[str, Any], postgres_dsn: str):
    print(">>> upserting into Postgres DSN:", postgres_dsn)
    os.environ["DATABASE_URL"] = postgres_dsn
    from app import create_app, db
    from app import models
    app = create_app()
    with app.app_context():
        static_root = app.static_folder or os.path.join(
            app.root_path, "static")
        inserted = 0
        for b in data.get("brands", []):
            name = b.get("name")
            if not name:
                continue
            existing = models.Brand.query.filter_by(name=name).first()
            if existing:
                existing.description = b.get(
                    "description") or existing.description
            else:
                nb = models.Brand(name=name, description=b.get("description"))
                db.session.add(nb)
                inserted += 1
        db.session.commit()
        print("Brands upserted (new):", inserted)

        ins = upd = 0
        for p in data.get("products", []):
            pid = p.get("id")
            if not pid:
                continue
            existing = models.Product.query.filter_by(id=pid).first()
            img_rel = reconcile_image(
                p.get("image_url"), p.get("title") or pid, static_root)
            row = {
                "id": pid,
                "brand": p.get("brand"),
                "title": p.get("title"),
                "price": float(p.get("price") or 0),
                "description": p.get("description") or "",
                "keyNotes": p.get("keyNotes") or "",
                "image_url": img_rel,
                "thumbnails": p.get("thumbnails") or "",
                "status": p.get("status") or "restocked",
                "quantity": int(p.get("quantity") or 0),
                "tags": p.get("tags") or ""
            }
            if existing:
                for k, v in row.items():
                    setattr(existing, k, v)
                upd += 1
            else:
                prod = models.Product(**row)
                db.session.add(prod)
                ins += 1
        db.session.commit()
        print("Products upserted: inserted=%d updated=%d" % (ins, upd))

        ins = upd = 0
        for h in data.get("homepage_products", []):
            hp = models.HomepageProduct.query.filter_by(
                homepage_id=h.get("homepage_id")).first()
            if hp:
                hp.section = h.get("section") or hp.section
                hp.product_id = h.get("product_id") or hp.product_id
                hp.sort_order = int(h.get("sort_order") or hp.sort_order)
                hp.visible = bool(h.get("visible"))
                upd += 1
            else:
                hp = models.HomepageProduct(
                    homepage_id=int(h.get("homepage_id")),
                    section=h.get("section"),
                    product_id=h.get("product_id"),
                    sort_order=int(h.get("sort_order") or 0),
                    visible=bool(h.get("visible"))
                )
                db.session.add(hp)
                ins += 1
        db.session.commit()
        print("HomepageProducts upserted: inserted=%d updated=%d" % (ins, upd))

        ins = upd = 0
        for s in data.get("settings", []):
            key = s.get("key")
            if not key:
                continue
            existing = models.Setting.query.get(key)
            if existing:
                existing.value = s.get("value")
                upd += 1
            else:
                new = models.Setting(key=key, value=str(s.get("value") or ""))
                db.session.add(new)
                ins += 1
        db.session.commit()
        print("Settings upserted: inserted=%d updated=%d" % (ins, upd))

        ins = upd = 0
        for s in data.get("stories", []):
            slug = s.get("slug")
            if not slug:
                continue
            existing = models.Story.query.filter_by(slug=slug).first()
            if existing:
                existing.title = s.get("title") or existing.title
                existing.section = s.get("section") or existing.section
                existing.excerpt = s.get("excerpt") or existing.excerpt
                existing.body_html = s.get("body_html") or existing.body_html
                existing.author = s.get("author") or existing.author
                existing.featured_image = s.get(
                    "featured_image") or existing.featured_image
                existing.published = bool(s.get("published"))
                existing.position = int(s.get("position") or existing.position)
                upd += 1
            else:
                new = models.Story(
                    title=s.get("title"),
                    slug=slug,
                    section=s.get("section"),
                    excerpt=s.get("excerpt"),
                    body_html=s.get("body_html"),
                    author=s.get("author"),
                    featured_image=s.get("featured_image"),
                    published=bool(s.get("published")),
                    position=int(s.get("position") or 0)
                )
                db.session.add(new)
                ins += 1
        db.session.commit()
        print("Stories upserted: inserted=%d updated=%d" % (ins, upd))

        try:
            ins = upd = 0
            for c in data.get("coupons", []):
                code = c.get("code")
                if not code:
                    continue
                existing = models.Coupon.query.filter_by(code=code).first()
                if existing:
                    existing.description = c.get(
                        "description") or existing.description
                    existing.discount_type = c.get(
                        "discount_type") or existing.discount_type
                    existing.discount_value = float(
                        c.get("discount_value") or existing.discount_value or 0)
                    existing.start_date = c.get(
                        "start_date") or existing.start_date
                    existing.end_date = c.get("end_date") or existing.end_date
                    existing.active = bool(c.get("active"))
                    upd += 1
                else:
                    new = models.Coupon(
                        code=code,
                        description=c.get("description"),
                        discount_type=c.get("discount_type"),
                        discount_value=float(c.get("discount_value") or 0),
                        start_date=c.get("start_date") or "",
                        end_date=c.get("end_date") or "",
                        active=bool(c.get("active"))
                    )
                    db.session.add(new)
                    ins += 1
            db.session.commit()
            print("Coupons upserted: inserted=%d updated=%d" % (ins, upd))
        except Exception:
            db.session.rollback()
            print("Warning: coupons upsert skipped due to error (schema mismatch?)")

        print(">>> upsert complete. Restart app pointing to Postgres and verify.")
    return True


def main():
    sqlite_path = find_sqlite_path()
    if not sqlite_path:
        print("ERROR: No sqlite DB found in instance/ (checked dev.sqlite3 dev.db dev.sqlite). Use SOURCE_SQLITE env to set path.")
        sys.exit(1)
    postgres_dsn = find_postgres_dsn()
    if not postgres_dsn:
        print("ERROR: No Postgres DSN found (POSTGRES_DSN env or DATABASE_URL pointing to Postgres or instance/config.py).")
        sys.exit(1)
    data = collect_from_sqlite(sqlite_path)
    ok = upsert_to_postgres(data, postgres_dsn)
    if ok:
        print("SUCCESS: Data transferred to Postgres DSN.")
    else:
        print("FAIL: transfer encountered errors.")


if __name__ == "__main__":
    main()
