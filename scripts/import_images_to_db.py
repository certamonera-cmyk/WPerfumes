#!/usr/bin/env python3
"""
Import images under static/images/<brand_folder> into Brand and Product rows.

Features:
 - Dry-run mode (default) that prints actions without writing.
 - --apply to perform DB writes.
 - --force to overwrite existing products' image fields.
 - --set-brand-logos to set Brand.logo from images/brands/*logo* if found.
 - Non-destructive by default (skips products that already exist by id or brand+title).
Usage:
  # preview only (safe)
  python scripts/import_images_to_db.py

  # apply changes (writes to the DB configured by create_app())
  python scripts/import_images_to_db.py --apply

  # apply and force update image_url/thumbnails on existing products
  python scripts/import_images_to_db.py --apply --force

  # apply and set brand.logo from static/images/brands/*
  python scripts/import_images_to_db.py --apply --set-brand-logos
"""
# Ensure project root is on sys.path so "from app import ..." works when running as a script
from app.models import Brand, Product
from app import create_app, db
import re
import argparse
import sys
from pathlib import Path
project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))


# Adjust mapping if folder names differ from desired display names
BRAND_NAME_MAP = {
    "creed": "Creed",
    "clive_christian": "Clive Christian",
    "amouage": "Amouage",
    "tom_ford": "Tom Ford",
    "penhaligons": "Penhaligon's",
    "xerjoff": "Xerjoff",
    "emporio_armani": "Emporio Armani",
    # add more mappings if needed
}

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def slugify_id(s: str) -> str:
    return re.sub(r'[^A-Za-z0-9_]', '', s).upper()


def title_from_filename(name: str) -> str:
    t = re.sub(r'[_\-]+', ' ', name)
    t = re.sub(r'\s+', ' ', t).strip()
    return t.title()


def find_logo_for_brand(static_images_dir: Path, folder_name: str) -> str | None:
    brands_folder = static_images_dir / "brands"
    if not brands_folder.exists():
        return None
    candidates = []
    for f in brands_folder.iterdir():
        if not f.is_file():
            continue
        if f.suffix.lower() not in IMAGE_EXTS:
            continue
        fn = f.name.lower()
        if folder_name.lower() in fn and "logo" in fn:
            candidates.append(f)
    # fallback: any file containing folder_name
    if not candidates:
        for f in brands_folder.iterdir():
            if not f.is_file():
                continue
            if f.suffix.lower() not in IMAGE_EXTS:
                continue
            if folder_name.lower() in f.name.lower():
                candidates.append(f)
    if candidates:
        rel = f"images/brands/{candidates[0].name}"
        return rel
    return None


def run(dry_run=True, apply=False, force=False, set_brand_logos=False):
    app = create_app()
    with app.app_context():
        static_images_dir = Path(app.static_folder) / "images"
        if not static_images_dir.exists():
            print("No images directory at", static_images_dir)
            return

        created_brands = 0
        created_products = 0
        updated_products = 0
        skipped = 0

        for brand_folder in sorted([p for p in static_images_dir.iterdir() if p.is_dir()]):
            folder = brand_folder.name
            display_name = BRAND_NAME_MAP.get(
                folder, folder.replace('_', ' ').title())
            print(f"\nProcessing folder: {folder} -> Brand: {display_name}")

            brand = Brand.query.filter_by(name=display_name).first()
            if not brand:
                print(
                    "  Brand not found in DB -> will create" if not dry_run else "  Would create Brand")
                if apply:
                    try:
                        brand = Brand(
                            name=display_name, description=f"Imported from images/{folder}")
                        db.session.add(brand)
                        db.session.commit()
                        created_brands += 1
                        print(f"  Created Brand: {display_name}")
                    except Exception as e:
                        db.session.rollback()
                        print(f"  Failed to create Brand {display_name}: {e}")
                        continue
            else:
                print("  Brand exists in DB")

            # optionally set brand.logo from images/brands/*
            if set_brand_logos:
                logo_rel = find_logo_for_brand(static_images_dir, folder)
                if logo_rel:
                    if not brand.logo or force:
                        print(f"  Setting brand.logo -> {logo_rel}")
                        if apply:
                            try:
                                brand.logo = logo_rel
                                db.session.add(brand)
                                db.session.commit()
                            except Exception as e:
                                db.session.rollback()
                                print(f"  Failed to update brand.logo: {e}")

            # iterate files for product creation
            images = sorted([f for f in brand_folder.iterdir()
                            if f.is_file() and f.suffix.lower() in IMAGE_EXTS])
            if not images:
                print("  (no image files)")
                continue

            for img in images:
                name_noext = img.stem
                raw_id = f"{folder}_{name_noext}"
                prod_id = slugify_id(raw_id)
                title = title_from_filename(name_noext)
                image_rel = f"images/{folder}/{img.name}"

                existing_by_id = Product.query.filter_by(id=prod_id).first()
                existing_by_title = Product.query.filter_by(
                    brand=display_name, title=title).first()
                if existing_by_id or existing_by_title:
                    p = existing_by_id or existing_by_title
                    if force:
                        print(
                            f"  Will update existing product {p.id} image fields -> {image_rel}" if not dry_run else f"  Would update {p.id}")
                        if apply:
                            try:
                                p.image_url = image_rel
                                p.thumbnails = image_rel
                                db.session.add(p)
                                db.session.commit()
                                updated_products += 1
                            except Exception as e:
                                db.session.rollback()
                                print(
                                    f"  Failed to update product {p.id}: {e}")
                    else:
                        print(
                            f"  Skipping existing product (id/title found): {p.id} / {p.title}")
                        skipped += 1
                    continue

                # create new product
                print(
                    f"  Create Product -> id={prod_id} title='{title}' image='{image_rel}'" if not dry_run else f"  Would create Product id={prod_id} title='{title}'")
                if apply:
                    try:
                        newp = Product(
                            id=prod_id,
                            brand=display_name,
                            title=title,
                            price=0.0,
                            description="Imported from static images",
                            keyNotes="",
                            image_url=image_rel,
                            thumbnails=image_rel,
                            status="restocked",
                            quantity=10,
                            tags=""
                        )
                        db.session.add(newp)
                        db.session.commit()
                        created_products += 1
                    except Exception as e:
                        db.session.rollback()
                        print(f"  Failed to create product {prod_id}: {e}")

        print("\nSummary:")
        print(f"  Brands created: {created_brands}")
        print(f"  Products created: {created_products}")
        print(f"  Products updated: {updated_products}")
        print(f"  Products skipped (existing): {skipped}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Import images into Brands/Products")
    parser.add_argument("--apply", action="store_true",
                        help="Apply changes to the database (default is dry-run)")
    parser.add_argument("--force", action="store_true",
                        help="Force update image fields on existing products/brands")
    parser.add_argument("--set-brand-logos", action="store_true",
                        help="Attempt to set brand.logo from images/brands/*logo*")
    args = parser.parse_args()
    run(dry_run=not args.apply, apply=args.apply,
        force=args.force, set_brand_logos=args.set_brand_logos)
