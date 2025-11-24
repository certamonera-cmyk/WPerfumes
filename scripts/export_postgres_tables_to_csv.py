#!/usr/bin/env python3
"""
scripts/export_postgres_tables_to_csv.py

Exports key app tables to CSV files under instance/csvs/ using the app's DATABASE_URL.
Safe to run locally (reads DB via your app.create_app()).

Usage:
  cd /d/WPerfumes
  source venv/Scripts/activate
  python scripts/export_postgres_tables_to_csv.py

Output:
  instance/csvs/brand.csv
  instance/csvs/product.csv
  instance/csvs/homepage_product.csv
  instance/csvs/coupon.csv (if model exists)
  instance/csvs/story.csv  (if model exists)
  instance/csvs/setting.csv (if model exists)
"""
from pathlib import Path
import csv
import sys

# Ensure project root is importable when running from scripts/
proj_root = Path(__file__).resolve().parents[1]
if str(proj_root) not in sys.path:
    sys.path.insert(0, str(proj_root))

try:
    from app import create_app
    from app.models import Brand, Product, HomepageProduct
except Exception as e:
    print("Failed to import app or core models:", e)
    print("Make sure you're running this from the project root and your venv is activated.")
    raise

# Optional models that may not exist in all repos
_optional_model_names = {
    "Coupon": "Coupon",
    "Story": "Story",
    "Setting": "Setting"
}
_optional_models = {}

# Try to import optional models if present
for mdl in list(_optional_model_names):
    try:
        mod = __import__("app.models", fromlist=[mdl])
        _optional_models[mdl.lower()] = getattr(mod, mdl)
    except Exception:
        _optional_models[mdl.lower()] = None

OUT_DIR = proj_root / "instance" / "csvs"
OUT_DIR.mkdir(parents=True, exist_ok=True)


def write_rows(path: Path, header, rows):
    with path.open("w", newline="", encoding="utf8") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow(r)
    print(f"Wrote {path} ({len(rows)} rows)")


def main():
    app = create_app()
    with app.app_context():
        # BRANDS
        brands = [(b.name or "", b.description or "")
                  for b in Brand.query.order_by(Brand.name).all()]
        write_rows(OUT_DIR / "brand.csv", ["name", "description"], brands)

        # PRODUCTS
        products = []
        for p in Product.query.order_by(Product.id).all():
            products.append([
                p.id or "",
                p.brand or "",
                p.title or "",
                p.price if p.price is not None else "",
                p.description or "",
                getattr(p, "keyNotes", "") or "",
                p.image_url or "",
                p.thumbnails or "",
                p.status or "",
                p.quantity if p.quantity is not None else "",
                p.tags or ""
            ])
        write_rows(OUT_DIR / "product.csv", ["id", "brand", "title", "price", "description",
                   "keyNotes", "image_url", "thumbnails", "status", "quantity", "tags"], products)

        # HOMEPAGE PRODUCTS
        try:
            hps = []
            for h in HomepageProduct.query.order_by(HomepageProduct.section, HomepageProduct.sort_order).all():
                hps.append([h.homepage_id, h.section, h.product_id or "",
                           h.sort_order or 0, bool(h.visible)])
            write_rows(OUT_DIR / "homepage_product.csv",
                       ["homepage_id", "section", "product_id", "sort_order", "visible"], hps)
        except Exception as e:
            print("Skipping homepage_product export (model missing or error):", e)

        # Optional: Coupon
        Coupon = _optional_models.get("coupon")
        if Coupon:
            try:
                coupons = []
                for c in Coupon.query.order_by(getattr(Coupon, "code", "code")).all():
                    coupons.append([c.code or "", c.description or "", c.discount_type or "", c.discount_value or "",
                                   c.start_date or "", c.end_date or "", bool(getattr(c, "active", False))])
                write_rows(OUT_DIR / "coupon.csv", ["code", "description", "discount_type",
                           "discount_value", "start_date", "end_date", "active"], coupons)
            except Exception as e:
                print("Warning: coupon export failed:", e)

        # Optional: Story
        Story = _optional_models.get("story")
        if Story:
            try:
                stories = []
                for s in Story.query.order_by(getattr(Story, "id", "id")).all():
                    stories.append([s.id or "", s.title or "", s.slug or "", s.section or "", s.excerpt or "", s.body_html or "", s.author or "", s.featured_image or "", bool(
                        getattr(s, "published", False)), getattr(s, "published_at", None).isoformat() if getattr(s, "published_at", None) else ""])
                write_rows(OUT_DIR / "story.csv", ["id", "title", "slug", "section", "excerpt",
                           "body_html", "author", "featured_image", "published", "published_at"], stories)
            except Exception as e:
                print("Warning: story export failed:", e)

        # Optional: Setting
        Setting = _optional_models.get("setting")
        if Setting:
            try:
                settings = []
                for st in Setting.query.order_by(getattr(Setting, "key", "key")).all():
                    settings.append([st.key or "", st.value or ""])
                write_rows(OUT_DIR / "setting.csv", ["key", "value"], settings)
            except Exception as e:
                print("Warning: setting export failed:", e)

    print("CSV export complete. Files are in:", OUT_DIR)


if __name__ == "__main__":
    main()
