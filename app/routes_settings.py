# app/routes_settings.py
"""
Settings endpoints for WPerfumes.

Provides:
- GET  /api/settings/checkout_discount   -> { "percent": 0 }
- PUT  /api/settings/checkout_discount   -> { "success": True, "percent": <value> }
- GET  /api/settings/price_comparison    -> { "competitors": [...], "global_margin": <num> }
- PUT  /api/settings/price_comparison    -> { "success": True }
- POST /api/settings/price_comparison/push -> { "success": True }
"""
from flask import Blueprint, request, jsonify, current_app, session
from .models import Setting
from . import db
import json

settings_bp = Blueprint("settings_bp", __name__)


@settings_bp.route("/api/settings/checkout_discount", methods=["GET"])
def get_checkout_discount():
    """
    Return JSON: { "percent": 2.5 }
    Public endpoint (frontend reads it to show advert).
    Defensive: DB errors return 503 and are logged.
    """
    try:
        try:
            s = Setting.query.get("checkout_discount")
        except Exception as db_exc:
            current_app.logger.exception(
                "Database error reading checkout_discount: %s", db_exc)
            return jsonify({"error": "database_unavailable", "message": "Settings temporarily unavailable"}), 503

        try:
            percent = float(s.value) if s and s.value is not None else 0.0
        except Exception:
            percent = 0.0
        return jsonify({"percent": percent})
    except Exception as e:
        current_app.logger.exception(
            "Unexpected error in get_checkout_discount: %s", e)
        return jsonify({"error": "internal_error", "message": "An unexpected error occurred"}), 500


@settings_bp.route("/api/settings/checkout_discount", methods=["PUT"])
def update_checkout_discount():
    """
    Set checkout discount percent.
    Requires admin session (session['user'] == 'admin' or 'admin@example.com').
    """
    if session.get("user") not in ("admin", "admin@example.com"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    try:
        percent = float(data.get("percent", 0))
    except Exception:
        return jsonify({"error": "Invalid percent value"}), 400

    if percent < 0 or percent > 100:
        return jsonify({"error": "Percent must be between 0 and 100"}), 400

    try:
        s = Setting.query.get("checkout_discount")
        if not s:
            s = Setting(key="checkout_discount", value=str(percent))
            db.session.add(s)
        else:
            s.value = str(percent)
        db.session.commit()
        return jsonify({"success": True, "percent": percent})
    except Exception as e:
        try:
            db.session.rollback()
        except Exception:
            pass
        current_app.logger.exception(
            "Failed to update checkout_discount: %s", e)
        return jsonify({"error": "database_write_failed", "message": "Could not save settings"}), 500


# -----------------------
# Price comparison settings
# -----------------------
# Stored as Setting.key = 'price_comparison_competitors' with JSON string value.
# The admin UI produces a list of entries like:
#   { "name": "...", "product_id": "PRD001", "our_price": 350, "competitor_price": 400, "margin": 2.5 }
# -----------------------


@settings_bp.route("/api/settings/price_comparison", methods=["GET"])
def get_price_comparison_settings():
    """
    Return JSON:
    {
      "competitors": [ {name, product_id, our_price?, competitor_price?, margin?}, ... ],
      "global_margin": <number>
    }
    Defensive: catches DB errors and returns 503.
    """
    try:
        try:
            s = Setting.query.get("price_comparison_competitors")
        except Exception as db_exc:
            current_app.logger.exception(
                "Database error reading price_comparison_competitors: %s", db_exc)
            return jsonify({"error": "database_unavailable", "message": "Settings temporarily unavailable"}), 503

        competitors = []
        if s and s.value:
            try:
                competitors = json.loads(s.value)
            except Exception:
                current_app.logger.debug(
                    "Invalid JSON in price_comparison_competitors setting; returning empty list")
                competitors = []

        try:
            gm = Setting.query.get("price_comparison_global_margin")
        except Exception as db_exc:
            current_app.logger.exception(
                "Database error reading price_comparison_global_margin: %s", db_exc)
            return jsonify({"error": "database_unavailable", "message": "Settings temporarily unavailable"}), 503

        global_margin = 0.0
        try:
            global_margin = float(
                gm.value) if gm and gm.value is not None else 0.0
        except Exception:
            global_margin = 0.0

        return jsonify({"competitors": competitors, "global_margin": global_margin})
    except Exception as e:
        current_app.logger.exception(
            "Failed to get price comparison settings: %s", e)
        return jsonify({"error": "internal_error", "message": "Could not read settings"}), 500


@settings_bp.route("/api/settings/price_comparison", methods=["PUT"])
def update_price_comparison_settings():
    """
    Accept JSON body: { "competitors": [...], "global_margin": <number> }
    Requires admin session.
    Validates structure and persists JSON.
    """
    if session.get("user") not in ("admin", "admin@example.com"):
        return jsonify({"error": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    competitors = data.get("competitors", [])
    global_margin = data.get("global_margin", None)

    try:
        if not isinstance(competitors, list):
            return jsonify({"error": "competitors must be a list"}), 400

        cleaned = []
        for c in competitors:
            if not isinstance(c, dict):
                continue
            name = (c.get("name") or "").strip()
            product_id = (c.get("product_id") or "").strip()
            if not name or not product_id:
                continue

            def to_float_maybe(v):
                if v is None or v == "":
                    return None
                try:
                    return float(v)
                except Exception:
                    return None

            our_price = to_float_maybe(c.get("our_price"))
            competitor_price = to_float_maybe(
                c.get("competitor_price") or c.get("manual_price"))
            margin = to_float_maybe(c.get("margin"))

            cleaned.append({
                "name": name,
                "product_id": product_id,
                "our_price": our_price,
                "competitor_price": competitor_price,
                "margin": margin
            })

        # save competitors JSON
        try:
            s = Setting.query.get("price_comparison_competitors")
        except Exception as db_exc:
            current_app.logger.exception(
                "Database error fetching setting for write: %s", db_exc)
            return jsonify({"error": "database_unavailable", "message": "Settings temporarily unavailable"}), 503

        if not s:
            s = Setting(key="price_comparison_competitors",
                        value=json.dumps(cleaned))
            db.session.add(s)
        else:
            s.value = json.dumps(cleaned)

        # save optional global margin
        if global_margin is not None:
            try:
                gm_val = float(global_margin)
            except Exception:
                return jsonify({"error": "global_margin must be a number"}), 400
            try:
                gm = Setting.query.get("price_comparison_global_margin")
            except Exception as db_exc:
                current_app.logger.exception(
                    "Database error fetching margin setting for write: %s", db_exc)
                return jsonify({"error": "database_unavailable", "message": "Settings temporarily unavailable"}), 503
            if not gm:
                gm = Setting(key="price_comparison_global_margin",
                             value=str(gm_val))
                db.session.add(gm)
            else:
                gm.value = str(gm_val)

        db.session.commit()
        return jsonify({"success": True})
    except Exception as e:
        try:
            db.session.rollback()
        except Exception:
            pass
        current_app.logger.exception(
            "Failed to save price comparison settings: %s", e)
        return jsonify({"error": "failed_to_save", "detail": str(e)}), 500


@settings_bp.route("/api/settings/price_comparison/push", methods=["POST"])
def push_price_comparison_settings():
    """
    Admin-only endpoint that acts as a 'push' / publish hook for settings.
    Currently just logs and returns success.
    """
    if session.get("user") not in ("admin", "admin@example.com"):
        return jsonify({"error": "Unauthorized"}), 401
    try:
        current_app.logger.info(
            "Price comparison push triggered by admin user %s", session.get("user"))
        # Future: trigger cache refresh or other publish actions here.
        return jsonify({"success": True})
    except Exception as e:
        current_app.logger.exception(
            "Failed to handle push_price_comparison_settings: %s", e)
        return jsonify({"error": "internal_error", "detail": str(e)}), 500
