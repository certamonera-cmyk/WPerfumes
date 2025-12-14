# app/routes.py
from flask import session
from flask import Blueprint, request, jsonify, session, render_template, url_for, redirect, current_app
from flask_mail import Message
from datetime import datetime
from . import db, mail
from .models import Brand, Product, HomepageProduct, Coupon, Order, OrderAttempt, Story
import re

bp = Blueprint("main", __name__)


def to_static_url(path):
    """
    Convert a stored image path like 'images/creed/aventus.jpg'
    into a browser URL '/static/images/creed/aventus.jpg'.
    If path already starts with '/' or 'http', return as-is.
    """
    if not path:
        return "/static/images/placeholder.jpg"
    if isinstance(path, str) and (path.startswith("http://") or path.startswith("https://") or path.startswith("/")):
        return path
    return "/static/" + path.lstrip("/")


# -------------------------
# Server-side price sanitizer
# -------------------------
def _sanitize_price_server(raw):
    """
    Robustly coerce a client-supplied price into a float or return None if not parseable.
    Accepts numeric types or strings containing currency symbols, grouping separators and
    different decimal separators. Attempts to normalize and return float.
    """
    if raw is None:
        return None
    # already numeric
    if isinstance(raw, (int, float)):
        try:
            return float(raw)
        except Exception:
            return None

    s = str(raw).strip()
    if s == "":
        return None

    # remove currency symbols and whitespace (but keep ',' and '.' for later disambiguation)
    s = re.sub(r'[\u00A0\s£$€¥₹]', '', s)

    # If both '.' and ',' present decide which is decimal separator by position:
    # - if last ',' occurs after last '.' then treat ',' as decimal separator (e.g. "1.234,56")
    # - else treat '.' as decimal separator and remove commas (e.g. "1,234.56")
    if ',' in s and '.' in s:
        if s.rfind(',') > s.rfind('.'):
            s = s.replace('.', '')
            s = s.replace(',', '.')
        else:
            s = s.replace(',', '')
    elif ',' in s and '.' not in s:
        # ambiguous single separator: if the part after last comma has 3 digits -> thousands separator -> remove commas
        parts = s.split(',')
        if len(parts[-1]) == 3:
            s = s.replace(',', '')
        else:
            # treat comma as decimal separator
            s = s.replace(',', '.')
    # else: no commas, dots left as-is

    # strip any remaining non-digit/dot/minus characters
    s = re.sub(r'[^0-9.\-]', '', s)

    # normalize multiple dots: keep first as decimal separator
    parts = s.split('.')
    if len(parts) > 2:
        s = parts[0] + '.' + ''.join(parts[1:])

    # avoid bare '-', '.' or '-.'
    if s in ('', '-', '.', '-.'):
        return None

    try:
        return float(s)
    except Exception:
        return None


# -------------------------
# Story helpers
# -------------------------
def _get_published_story_for_section_or_slug(section_or_slug):
    """
    Resolve a story to show on a simple section page (e.g. 'history' or 'about').
    Priority:
      1) Story with slug == section_or_slug and published=True
      2) Most recent Story with section == section_or_slug and published=True
      3) None
    """
    if not section_or_slug:
        return None
    # exact slug match
    s = Story.query.filter_by(slug=section_or_slug, published=True).first()
    if s:
        return s
    # fallback: latest published story in this section
    s2 = Story.query.filter_by(section=section_or_slug, published=True) \
        .order_by(Story.published_at.desc().nullslast(), Story.created_at.desc()) \
        .first()
    return s2


def _get_published_stories_for_section(section, limit=None, page=1):
    """
    Return a list of published stories for the given section, newest first.
    If section is None or empty, return all published stories.
    Pagination via limit/page if provided.
    """
    q = Story.query.filter_by(published=True)
    if section:
        q = q.filter_by(section=section)
    q = q.order_by(Story.published_at.desc().nullslast(),
                   Story.created_at.desc())
    if limit:
        try:
            limit = int(limit)
        except Exception:
            limit = None
    try:
        page = int(page) if page and int(page) > 0 else 1
    except Exception:
        page = 1
    if limit:
        q = q.limit(limit).offset((page - 1) * limit)
    return q.all()


def _render_story_page_or_fallback(story, fallback_title, fallback_html):
    """
    Given a Story (or None) render content_page.html with story data or fallback markup.
    """
    if story:
        data = story.to_public_dict()
        images = []
        if data.get("featured_image"):
            images = [data.get("featured_image")]
        meta = {
            "author": data.get("author"),
            "published_at": data.get("published_at")
        }
        return render_template("content_page.html", title=data.get("title"), body_html=data.get("body_html"), images=images, meta=meta)
    # fallback
    return render_template("content_page.html", title=fallback_title, body_html=fallback_html, images=[], meta={})


# -------------------------
# Page routes
# -------------------------
@bp.route('/admin')
def admin_dashboard():
    return render_template('admin.html')


@bp.route('/brands')
def brands():
    """
    Render the brands listing page. Pass the server-side brands data to the template so:
      - server-side rendered fallback list (Jinja for-loop) works
      - client-side JS (window.BRANDS) can use the data without an API fetch
    The Brand model stores logo path via Brand.logo_url property (e.g. 'images/creed/aventus.jpg')
    which the templates use with url_for('static', filename=...).
    """
    try:
        brand_objs = Brand.query.order_by(Brand.name).all()
        # pass a list of lightweight dicts (logo path kept as stored path so template's url_for works)
        brands_list = []
        for b in brand_objs:
            brands_list.append({
                "name": b.name,
                "logo_url": getattr(b, "logo_url", "") or "",
                "description": b.description or "",
                # include gender if model later extended; safe default ''
                "gender": getattr(b, "gender", "") if hasattr(b, "gender") else ""
            })
    except Exception:
        # In case DB is unavailable, render page with empty list to avoid template crash
        current_app.logger.exception(
            "Failed to load brands for /brands; rendering empty list")
        brands_list = []

    return render_template('brands.html', brands=brands_list)


@bp.route('/brand')
def brand():
    return render_template('brand.html')


@bp.route('/brand_detail')
def brand_detail():
    return render_template('brand_detail.html')


@bp.route('/checkout')
def checkout():
    return render_template('checkout.html')


@bp.route('/cart')
def cart():
    return render_template('cart.html')


@bp.route('/forgot_password')
def forgot_password():
    return render_template('forgot_password.html')


# -------------------------
# Auth endpoints
# -------------------------
@bp.route('/api/auth/login', methods=['POST'])
def login():
    data = request.json or {}
    # Accept either username or email (frontend uses email in many places)
    identity = (data.get('username') or data.get('email') or "").strip()
    password = data.get('password') or ""
    # Simple demo auth: allow admin/password123 or admin@example.com/password123
    if (identity.lower() in ('admin', 'admin@example.com')) and password == 'password123':
        session['user'] = identity
        return jsonify({"user": {"username": "admin", "role": "admin"}})
    return jsonify({"error": "Invalid credentials"}), 401


@bp.route('/api/auth/logout', methods=['POST'])
def logout():
    session.pop('user', None)
    return jsonify({"success": True})


# -------------------------
# Brands / Products
# -------------------------
@bp.route('/api/brands', methods=['GET'])
def get_brands():
    brands = Brand.query.order_by(Brand.name).all()
    return jsonify([{
        "name": b.name,
        "logo": to_static_url(b.logo_url),
        "description": b.description
    } for b in brands])


@bp.route('/api/brands', methods=['POST'])
def add_brand():
    data = request.json or {}
    brand = Brand(name=data.get("name"),
                  description=data.get("description", ""))
    db.session.add(brand)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/brands/<name>', methods=['PUT'])
def update_brand(name):
    b = Brand.query.filter_by(name=name).first()
    if not b:
        return jsonify({"error": "Brand not found"}), 404
    data = request.json or {}
    b.description = data.get("description", b.description)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/brands/<name>', methods=['DELETE'])
def delete_brand(name):
    b = Brand.query.filter_by(name=name).first()
    if b:
        Product.query.filter_by(brand=name).delete()
        db.session.delete(b)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Brand not found"}), 404


@bp.route('/api/products', methods=['GET'])
def get_products():
    products = Product.query.all()
    return jsonify([
        {
            "id": p.id,
            "brand": p.brand,
            "title": p.title,
            "price": p.price,
            "description": p.description,
            "keyNotes": p.keyNotes.split(";") if p.keyNotes else [],
            "image_url": to_static_url(p.image_url or p.image_url_dynamic),
            "thumbnails": p.thumbnails if p.thumbnails else "",
            "status": p.status,
            "quantity": p.quantity,
            "tags": p.tags
        }
        for p in products
    ])


@bp.route('/api/products', methods=['POST'])
def add_product():
    data = request.json or {}
    # sanitize incoming price robustly
    raw_price = data.get("price")
    price_val = _sanitize_price_server(raw_price)
    price = price_val if (price_val is not None) else 0.0

    # safe quantity parse
    try:
        quantity = int(data.get("quantity", 10))
    except Exception:
        quantity = 10

    product = Product(
        id=data.get("id"),
        brand=data.get("brand"),
        title=data.get("title"),
        price=price,
        description=data.get("description", ""),
        keyNotes=data.get("keyNotes", ""),
        image_url=data.get("image_url", data.get("imageUrl", "")),
        thumbnails=data.get("thumbnails", ""),
        status=data.get("status", "restocked"),
        quantity=quantity,
        tags=data.get("tags", "")
    )
    db.session.add(product)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/products/<id>', methods=['PUT'])
def update_product(id):
    prod = Product.query.filter_by(id=id).first()
    if not prod:
        return jsonify({"error": "Product not found"}), 404
    data = request.json or {}

    prod.title = data.get("title", prod.title)
    prod.brand = data.get("brand", prod.brand)

    # Robust price handling: only update if we can parse the incoming value
    if "price" in data:
        raw_price = data.get("price")
        price_val = _sanitize_price_server(raw_price)
        if price_val is not None:
            prod.price = price_val
        else:
            # If client explicitly sent an empty string or invalid value, set to 0.0
            # (This preserves previous behavior but avoids exceptions.)
            try:
                # treat empty string as 0 if that's what client intended
                if raw_price == "" or raw_price is None:
                    prod.price = 0.0
            except Exception:
                pass

    prod.description = data.get("description", prod.description)
    prod.keyNotes = data.get("keyNotes", prod.keyNotes)
    prod.image_url = data.get("image_url", prod.image_url)
    prod.thumbnails = data.get("thumbnails", prod.thumbnails)
    prod.status = data.get("status", prod.status)
    # safe quantity parse
    if "quantity" in data:
        try:
            prod.quantity = int(data.get("quantity", prod.quantity))
        except Exception:
            # keep existing quantity on parse failure
            pass
    prod.tags = data.get("tags", prod.tags)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/products/<id>', methods=['DELETE'])
def delete_product(id):
    prod = Product.query.filter_by(id=id).first()
    if prod:
        db.session.delete(prod)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Product not found"}), 404


@bp.route('/api/products/status/<id>', methods=['PUT'])
def update_product_status(id):
    data = request.json or {}
    prod = Product.query.filter_by(id=id).first()
    if prod:
        prod.status = data.get("status", prod.status)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Product not found"}), 404


# NEW: authoritative lookup by product_id (maintains compatibility with existing frontend)
@bp.route('/api/product_by_id', methods=['GET'])
def get_product_by_id():
    """
    Client expects: GET /api/product_by_id?product_id=PRD123
    Return a single product JSON object or 404.
    """
    product_id = request.args.get('product_id') or request.args.get('id') or ''
    if not product_id:
        return jsonify({"error": "product_id required"}), 400

    prod = Product.query.filter_by(id=product_id).first()
    if not prod:
        return jsonify({"error": "Product not found"}), 404

    return jsonify({
        "id": prod.id,
        "brand": prod.brand,
        "title": prod.title,
        "price": prod.price,
        "description": prod.description,
        "keyNotes": prod.keyNotes.split(";") if prod.keyNotes else [],
        "image_url": to_static_url(prod.image_url or prod.image_url_dynamic),
        "thumbnails": prod.thumbnails if prod.thumbnails else "",
        "status": prod.status,
        "quantity": prod.quantity,
        "tags": prod.tags
    })


# NEW: compatible fallback endpoint used by some client pages
@bp.route('/api/product', methods=['GET'])
def get_product_by_brand_query():
    """
    Client fallback: GET /api/product?brand=Amouage&product=Gold
    Accepts brand & product as query params (slugs with underscores),
    returns a single product JSON or 404. Mirrors existing /api/products/<brand>/<product>.
    """
    brand_param = request.args.get('brand') or ''
    product_param = request.args.get('product') or ''
    # If caller passed a product_id in the query, prefer authoritative id
    product_id = request.args.get('product_id') or ''

    # Prefer authoritative id if provided
    if product_id:
        prod = Product.query.filter_by(id=product_id).first()
        if prod:
            return jsonify({
                "id": prod.id,
                "brand": prod.brand,
                "title": prod.title,
                "price": prod.price,
                "description": prod.description,
                "keyNotes": prod.keyNotes.split(";") if prod.keyNotes else [],
                "image_url": to_static_url(prod.image_url or prod.image_url_dynamic),
                "thumbnails": prod.thumbnails if prod.thumbnails else "",
                "status": prod.status,
                "quantity": prod.quantity,
                "tags": prod.tags
            })
        return jsonify({"error": "Product not found"}), 404

    if not brand_param or not product_param:
        return jsonify({"error": "brand and product query parameters required"}), 400

    brand_name = brand_param.replace('_', ' ')
    product_title = product_param.replace('_', ' ')
    prod = Product.query.filter_by(
        brand=brand_name, title=product_title).first()
    if not prod:
        return jsonify({"error": "Product not found"}), 404

    return jsonify({
        "id": prod.id,
        "brand": prod.brand,
        "title": prod.title,
        "price": prod.price,
        "description": prod.description,
        "keyNotes": prod.keyNotes.split(";") if prod.keyNotes else [],
        "image_url": to_static_url(prod.image_url or prod.image_url_dynamic),
        "thumbnails": prod.thumbnails if prod.thumbnails else "",
        "status": prod.status,
        "quantity": prod.quantity,
        "tags": prod.tags
    })


@bp.route('/api/products/<brand>', methods=['GET'])
def get_products_by_brand(brand):
    # If brand param actually matches a product id, return that product
    by_id = Product.query.filter_by(id=brand).first()
    if by_id:
        return jsonify({
            "id": by_id.id,
            "brand": by_id.brand,
            "title": by_id.title,
            "price": by_id.price,
            "description": by_id.description,
            "keyNotes": by_id.keyNotes.split(";") if by_id.keyNotes else [],
            "image_url": to_static_url(by_id.image_url or by_id.image_url_dynamic),
            "thumbnails": by_id.thumbnails if by_id.thumbnails else "",
            "status": by_id.status,
            "quantity": by_id.quantity,
            "tags": by_id.tags
        })
    brand_name = brand.replace('_', ' ')
    products = Product.query.filter_by(brand=brand_name).all()
    return jsonify([
        {
            "id": p.id,
            "brand": p.brand,
            "title": p.title,
            "price": p.price,
            "description": p.description,
            "keyNotes": p.keyNotes.split(";") if p.keyNotes else [],
            "image_url": to_static_url(p.image_url or p.image_url_dynamic),
            "thumbnails": p.thumbnails if p.thumbnails else "",
            "status": p.status,
            "quantity": p.quantity,
            "tags": p.tags
        }
        for p in products
    ])


@bp.route('/api/products/<brand>/<product>', methods=['GET'])
def get_product_detail(brand, product):
    brand_name = brand.replace('_', ' ')
    product_title = product.replace('_', ' ')
    prod = Product.query.filter_by(
        brand=brand_name, title=product_title).first()
    if not prod:
        return jsonify({"error": "Product not found"}), 404
    return jsonify({
        "id": prod.id,
        "brand": prod.brand,
        "title": prod.title,
        "price": prod.price,
        "description": prod.description,
        "keyNotes": prod.keyNotes.split(";") if prod.keyNotes else [],
        "image_url": to_static_url(prod.image_url or prod.image_url_dynamic),
        "thumbnails": prod.thumbnails if prod.thumbnails else "",
        "status": prod.status,
        "quantity": prod.quantity,
        "tags": prod.tags
    })


@bp.route('/api/homepage-products', methods=['GET'])
def get_homepage_products():
    homepage_products = HomepageProduct.query.order_by(
        HomepageProduct.section, HomepageProduct.sort_order).all()
    products = {p.id: p for p in Product.query.all()}
    result = {"signature": [], "men": [], "women": [], "offers": []}
    for hp in homepage_products:
        if not hp.visible:
            continue
        prod = products.get(hp.product_id)
        if prod:
            result.setdefault(hp.section, []).append({
                "homepage_id": hp.homepage_id,
                "section": hp.section,
                "id": prod.id,
                "title": prod.title,
                "brand": prod.brand,
                "price": prod.price,
                "image_url": to_static_url(prod.image_url or prod.image_url_dynamic),
                "sort_order": hp.sort_order,
                "visible": hp.visible
            })
    return jsonify(result)


@bp.route('/api/homepage-products', methods=['POST'])
def add_homepage_product():
    data = request.json or {}
    hp = HomepageProduct(
        section=data.get("section"),
        product_id=data.get("product_id"),
        sort_order=int(data.get("sort_order", 0)),
        visible=bool(data.get("visible", True))
    )
    db.session.add(hp)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/homepage-products/<int:homepage_id>', methods=['PUT'])
def update_homepage_product(homepage_id):
    hp = HomepageProduct.query.filter_by(homepage_id=homepage_id).first()
    if not hp:
        return jsonify({"error": "Homepage product not found"}), 404
    data = request.json or {}
    hp.section = data.get("section", hp.section)
    hp.product_id = data.get("product_id", hp.product_id)
    hp.sort_order = int(data.get("sort_order", hp.sort_order))
    hp.visible = bool(data.get("visible", hp.visible))
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/homepage-products/<int:homepage_id>', methods=['DELETE'])
def delete_homepage_product(homepage_id):
    hp = HomepageProduct.query.filter_by(homepage_id=homepage_id).first()
    if hp:
        db.session.delete(hp)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Homepage product not found"}), 404


@bp.route('/api/cart/add', methods=['POST'])
def add_to_cart():
    data = request.json or {}
    product_id = data.get("product_id")
    try:
        qty = int(data.get("quantity", 1))
    except Exception:
        qty = 1
    prod = Product.query.filter_by(id=product_id).first()
    if not prod:
        return jsonify({"error": "Product not found"}), 404
    if prod.quantity < qty:
        return jsonify({"error": "Sold Out", "quantity_left": prod.quantity}), 400
    prod.quantity -= qty
    db.session.commit()
    if prod.quantity == 0:
        prod.status = "out-of-stock"
        db.session.commit()
    return jsonify({"success": True, "quantity_left": prod.quantity})


@bp.route('/api/order-attempts', methods=['POST'])
def log_order_attempt():
    data = request.json or {}
    attempt = OrderAttempt(
        email=data.get("email", ""),
        product=data.get("product", ""),
        qty=data.get("qty", 1),
        status=data.get("status", "Carted"),
        timestamp=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )
    db.session.add(attempt)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/products/similar', methods=['GET'])
def get_similar_products():
    product_id = request.args.get("product_id")
    prod = Product.query.filter_by(id=product_id).first()
    if not prod or not prod.tags:
        return jsonify([])
    tag_list = [t.strip().lower() for t in prod.tags.split(',') if t.strip()]
    similar = Product.query.filter(Product.id != prod.id).all()
    result = []
    for p in similar:
        if not p.tags:
            continue
        ptags = set([tt.strip().lower()
                    for tt in p.tags.split(',') if tt.strip()])
        if set(tag_list) & ptags:
            result.append({
                "id": p.id,
                "title": p.title,
                "brand": p.brand,
                "image_url": to_static_url(p.image_url or p.image_url_dynamic),
                "thumbnails": p.thumbnails if p.thumbnails else "",
                "tags": p.tags
            })
    return jsonify(result)


@bp.route('/api/coupons', methods=['GET'])
def get_coupons():
    coupons = Coupon.query.order_by(Coupon.start_date.desc()).all()
    return jsonify([
        {
            "code": c.code,
            "description": c.description,
            "discount_type": c.discount_type,
            "discount_value": c.discount_value,
            "start_date": c.start_date,
            "end_date": c.end_date,
            "active": c.active
        }
        for c in coupons
    ])


@bp.route('/api/coupons', methods=['POST'])
def add_coupon():
    data = request.json or {}
    c = Coupon.query.filter_by(code=data.get("code")).first()
    if c:
        db.session.delete(c)
        db.session.commit()
    active_val = data.get("active", True)
    if isinstance(active_val, bool):
        active = active_val
    elif isinstance(active_val, str):
        active = active_val.lower() == "true"
    else:
        active = bool(active_val)
    coupon = Coupon(
        code=data.get("code"),
        description=data.get("description", ""),
        discount_type=data.get("discount_type", "percent"),
        discount_value=float(data.get("discount_value", 0)),
        start_date=data.get("start_date", ""),
        end_date=data.get("end_date", ""),
        active=active
    )
    db.session.add(coupon)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/coupons/<code>', methods=['PUT'])
def update_coupon(code):
    coupon = Coupon.query.filter_by(code=code).first()
    if not coupon:
        return jsonify({"error": "Coupon not found"}), 404
    data = request.json or {}
    coupon.description = data.get("description", coupon.description)
    coupon.discount_type = data.get("discount_type", coupon.discount_type)
    coupon.discount_value = float(
        data.get("discount_value", coupon.discount_value))
    coupon.start_date = data.get("start_date", coupon.start_date)
    coupon.end_date = data.get("end_date", coupon.end_date)
    active_val = data.get("active", coupon.active)
    if isinstance(active_val, bool):
        coupon.active = active_val
    elif isinstance(active_val, str):
        coupon.active = active_val.lower() == "true"
    else:
        coupon.active = bool(active_val)
    db.session.commit()
    return jsonify({"success": True})


@bp.route('/api/coupons/<code>', methods=['DELETE'])
def delete_coupon(code):
    coupon = Coupon.query.filter_by(code=code).first()
    if coupon:
        db.session.delete(coupon)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Coupon not found"}), 404


@bp.route('/api/orders', methods=['GET'])
def get_orders():
    orders = Order.query.order_by(Order.date.desc()).all()
    return jsonify([
        {
            "id": o.id,
            "customer_name": o.customer_name,
            "customer_email": o.customer_email,
            "customer_phone": o.customer_phone,
            "customer_address": o.customer_address,
            "product_id": o.product_id,
            "product_title": o.product_title,
            "quantity": o.quantity,
            "status": o.status,
            "payment_method": o.payment_method,
            "date": o.date
        }
        for o in orders
    ])


@bp.route('/api/orders', methods=['POST'])
def add_order():
    data = request.json or {}
    customer_name = data.get("customer_name") or data.get("customer") or ""
    customer_email = data.get("customer_email") or data.get("email") or ""
    customer_phone = data.get("customer_phone") or data.get("phone") or ""
    customer_address = data.get(
        "customer_address") or data.get("address") or ""
    product_id = data.get("product_id") or ""
    product_title = data.get("product_title") or data.get("product") or ""
    # Accept both 'quantity' and 'qty' (fallback to 1)
    try:
        quantity = int(data.get("quantity") or data.get("qty") or 1)
    except Exception:
        quantity = 1
    status = data.get("status", "Pending")
    payment_method = data.get("payment_method", "Cash on Delivery")
    date = data.get("date", datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    order = Order(
        customer_name=customer_name,
        customer_email=customer_email,
        customer_phone=customer_phone,
        customer_address=customer_address,
        product_id=product_id,
        product_title=product_title,
        quantity=quantity,
        status=status,
        payment_method=payment_method,
        date=date
    )

    # Safely persist the order and return helpful JSON on failure
    try:
        db.session.add(order)
        db.session.commit()
    except Exception as e:
        try:
            db.session.rollback()
        except Exception:
            pass
        current_app.logger.exception("Failed to create order: %s", e)
        # Return JSON error with detail string so the client can display useful debug info
        return jsonify({"error": "order_create_failed", "detail": str(e)}), 500

    # === EMAIL FEATURE: Send confirmation email after saving ===
    email_body = f"""
Hi {customer_name},

Thank you for your order with WPerfumes!

Order Details:
Product: {product_title}
Quantity: {quantity}
Payment Method: {payment_method}
Delivery Address: {customer_address}
Status: {status}
Date: {date}

For any questions, reply to this email.
Best Regards,
WPerfumes Team
"""
    try:
        sender = current_app.config.get('MAIL_USERNAME') or None
        msg = Message(
            subject="Your WPerfumes Order Confirmation",
            sender=sender,
            recipients=[customer_email],
            body=email_body
        )
        mail.send(msg)
    except Exception as e:
        # Mail failures should not break order creation
        current_app.logger.debug(f"Error sending email: {e}")

    # Notify top-picks in-memory store so its sales_count can be updated immediately.
    try:
        from .routes_top_picks_stub import increment_sales_for_product
        try:
            increment_sales_for_product(product_id, quantity)
        except Exception as inner_exc:
            current_app.logger.debug(
                f"Warning: failed to increment top-picks sales in-memory: {inner_exc}")
    except Exception:
        # top-picks stub not present or import failed — that's fine
        pass

    return jsonify({"success": True})


@bp.route('/api/orders/<int:order_id>', methods=['PUT'])
def update_order(order_id):
    order = Order.query.filter_by(id=order_id).first()
    if not order:
        return jsonify({"error": "Order not found"}), 404
    data = request.json or {}
    old_status = order.status  # Save the old status before updating

    order.customer_name = data.get("customer_name", order.customer_name)
    order.customer_email = data.get("customer_email", order.customer_email)
    order.customer_phone = data.get("customer_phone", order.customer_phone)
    order.customer_address = data.get(
        "customer_address", order.customer_address)
    order.product_id = data.get("product_id", order.product_id)
    order.product_title = data.get("product_title", order.product_title)
    order.quantity = int(data.get("quantity", order.quantity))
    order.status = data.get("status", order.status)
    order.payment_method = data.get("payment_method", order.payment_method)
    order.date = data.get("date", order.date)
    db.session.commit()

    # If the status changed, send a notification email
    if order.status != old_status:
        email_body = f"""
Hi {order.customer_name},

Your order for {order.product_title} has been updated!

Order Details:
Product: {order.product_title}
Quantity: {order.quantity}
Payment Method: {order.payment_method}
Delivery Address: {order.customer_address}
Current Status: {order.status}
Date: {order.date}

You can reply to this email if you have any questions.
Best Regards,
WPerfumes Team
        """
        try:
            sender = current_app.config.get('MAIL_USERNAME') or None
            msg = Message(
                subject=f"Order Update: {order.product_title} is now '{order.status}'",
                sender=sender,
                recipients=[order.customer_email],
                body=email_body
            )
            mail.send(msg)
        except Exception as e:
            current_app.logger.debug(f"Error sending update email: {e}")

    return jsonify({"success": True})


@bp.route('/api/orders/<int:order_id>', methods=['DELETE'])
def delete_order(order_id):
    order = Order.query.filter_by(id=order_id).first()
    if order:
        db.session.delete(order)
        db.session.commit()
        return jsonify({"success": True})
    return jsonify({"error": "Order not found"}), 404


# ===========================
# Page Routes for HTML
# ===========================
@bp.route('/offers')
def offers():
    # return an offers template; create templates/offers.html if it doesn't exist
    return render_template('offers.html')


@bp.route('/')
def index():
    return render_template('index.html')


@bp.route('/men')
def men():
    # Redirect /men to the canonical brands listing so the same context (brands list)
    # is produced by the existing /brands view and templates receive the expected 'brands' variable.
    return redirect(url_for('main.brands'))


@bp.route('/women')
def women():
    return render_template('women.html')


@bp.route('/beauty')
def beauty():
    return render_template('beauty.html')


@bp.route('/login')
def login_page():
    return render_template('login.html')


@bp.route('/signup')
def signup():
    return render_template('signup.html')


@bp.route('/brand/<brand>')
def brand_page(brand):
    # Serve the single-brand listing page. The brand page template (brand.html) is query-param driven
    # and the frontend also supports /brand?brand=Name — here we render brand.html for the path form.
    return render_template('brand.html')


@bp.route('/brand/<brand>/product/<product>')
def brand_product_page(brand, product):
    # product detail (serves brand_detail.html which reads query params or path segments)
    return render_template('brand_detail.html')


# New: story detail and section listing routes
@bp.route('/story/<slug>')
def story_detail_page(slug):
    """
    Render a single story by slug (server-side).
    Falls back to 404 page if not found/published.
    """
    s = Story.query.filter_by(slug=slug, published=True).first()
    if not s:
        return render_template('404.html'), 404
    data = s.to_public_dict()
    images = [data.get('featured_image')] if data.get('featured_image') else []
    meta = {"author": data.get(
        'author'), "published_at": data.get('published_at')}
    return render_template('content_page.html', title=data.get('title'), body_html=data.get('body_html'), images=images, meta=meta)


@bp.route('/stories')
def stories_index():
    """
    Generic listing of stories. Supports query params:
      - section=history|about (optional)
      - page, limit (optional)
    Renders a server-side list template.
    """
    section = request.args.get('section')
    try:
        limit = int(request.args.get('limit')
                    ) if request.args.get('limit') else None
    except Exception:
        limit = None
    try:
        page = int(request.args.get('page')) if request.args.get('page') else 1
    except Exception:
        page = 1

    stories = _get_published_stories_for_section(
        section, limit=limit, page=page)
    # separate latest from others if present
    latest = stories[0] if stories else None
    others = stories[1:] if len(stories) > 1 else []
    return render_template('content_section.html', section=section or 'Stories', latest=latest, stories=stories, others=others)


# Updated History and About to render a section page (latest + archive)
@bp.route('/history')
def history():
    """
    Render the History page: latest story for section 'history' plus archive/list below.
    If you prefer direct mapping, publish a story with slug='history' or section='history'.
    """
    stories = _get_published_stories_for_section('history', limit=None, page=1)
    latest = stories[0] if stories else None
    others = stories[1:] if len(stories) > 1 else []
    return render_template('content_section.html', section='History', latest=latest, stories=stories, others=others)


@bp.route('/about')
def about():
    """
    Render the About Us page: latest story for section 'about' plus archive/list below.
    """
    stories = _get_published_stories_for_section('about', limit=None, page=1)
    latest = stories[0] if stories else None
    others = stories[1:] if len(stories) > 1 else []
    return render_template('content_section.html', section='About Us', latest=latest, stories=stories, others=others)

# Favicon: return 204 to avoid browser 404 noise


@bp.route('/favicon.ico')
def favicon():
    return ("", 204)