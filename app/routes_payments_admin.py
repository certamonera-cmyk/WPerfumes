# ======= UPDATED: routes_payments_admin.py =======
# routes_payments_admin.py
from __future__ import annotations
import os
import json
import logging
from functools import wraps
from typing import Dict, Any, List, Optional

from datetime import datetime, timedelta, date
import requests

from flask import Blueprint, request, Response, render_template, jsonify, current_app, abort, session
from werkzeug.security import check_password_hash, generate_password_hash

# Import SQLAlchemy models (ensure app/models_payments.py was added and migrations run)
try:
    from .models_payments import Payment, Order, PaymentsAdminUser  # type: ignore
    from . import db  # type: ignore
except Exception:
    Payment = None
    Order = None
    PaymentsAdminUser = None
    db = None

# Optionally reuse PayPal helper functions if you have payments_paypal implemented
try:
    from .payments_paypal import get_paypal_access_token, PAYPAL_BASE  # type: ignore
except Exception:
    get_paypal_access_token = None
    PAYPAL_BASE = None

bp = Blueprint("payments_admin", __name__,
               template_folder="templates", url_prefix="/payments-admin")
logger = logging.getLogger(__name__)

# Load admin credentials from environment. Expected format:
# PAYMENTS_ADMIN_TOKEN='long-random-token'


def _get_admin_token() -> str:
    return os.environ.get("PAYMENTS_ADMIN_TOKEN", "")


# Access control decorator: HTTP Basic or header token + role check (now supports DB users)
def require_payments_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        # First: allow API token header for programmatic access
        token = _get_admin_token()
        header_token = request.headers.get(
            "X-ADMIN-TOKEN") or request.args.get("admin_token")
        if token and header_token and header_token == token:
            return f(*args, **kwargs)

        # If the current session is a site admin (session-based admin panel), allow
        if session.get("user") in ("admin", "admin@example.com"):
            # session admin may access payments-admin pages for management tasks
            return f(*args, **kwargs)

        # Otherwise require HTTP Basic auth
        auth = request.authorization
        if not auth:
            return Response("Authentication required", 401, {"WWW-Authenticate": 'Basic realm="Payments Admin"'})

        # If PaymentsAdminUser table exists, validate against DB first
        if PaymentsAdminUser is not None:
            try:
                u = PaymentsAdminUser.query.filter_by(
                    username=auth.username).first()
                if u and check_password_hash(u.password_hash, auth.password or ""):
                    role = (u.role or "").strip().lower()
                    if role in ("ceo", "chairman", "cfo"):
                        # Attach user info for handlers optionally
                        request.payments_admin_user = {
                            "username": u.username, "role": u.role}
                        return f(*args, **kwargs)
                    else:
                        logger.warning(
                            "Payments admin access denied for user %s with role %s", auth.username, u.role)
                        return Response("Forbidden - insufficient privileges", 403)
                # fallthrough to env-based or deny
            except Exception:
                logger.exception(
                    "Error checking PaymentsAdminUser for %s", auth.username)
                # fallthrough and try env or deny

        # If DB user not found or table missing, fall back to env-based admin list (backwards compatibility)
        # Environment-based list is optional; if not configured we deny.
        raw_users = os.environ.get("PAYMENTS_ADMIN_USERS", "")
        if raw_users:
            try:
                allowed = json.loads(raw_users)
                for u in allowed:
                    if u.get("username") == auth.username:
                        # check password_hash if present; password_hash must be a werkzeug hash
                        ph = u.get("password_hash")
                        if ph and check_password_hash(ph, auth.password or ""):
                            role = (u.get("role") or "").strip().lower()
                            if role in ("ceo", "chairman", "cfo"):
                                request.payments_admin_user = {
                                    "username": auth.username, "role": u.get("role")}
                                return f(*args, **kwargs)
                                # else forbidden
                # not found in env list, deny
            except Exception:
                logger.exception(
                    "Failed to parse PAYMENTS_ADMIN_USERS env var")
        logger.warning("Payments admin auth failed for %s",
                       auth.username if auth else "<no auth>")
        return Response("Forbidden", 403)
    return wrapper


# Management UI & API for site-admin to create top-management users via the website.
# This route is protected by the existing site admin session (session['user'] == 'admin' or 'admin@example.com')
def require_site_admin_session(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if session.get("user") in ("admin", "admin@example.com"):
            return f(*args, **kwargs)
        return jsonify({"error": "Unauthorized"}), 401
    return wrapper


@bp.route("/", methods=["GET"])
@require_payments_admin
def index():
    # Renders the payments admin UI (template already added at templates/payments_admin.html)
    return render_template("payments_admin.html")


@bp.route("/manage-users", methods=["GET"])
@require_site_admin_session
def manage_users_page():
    """
    Simple web UI for site admin to create/manage top-management payments users.
    Accessible if you are logged into the main admin session (session user 'admin').
    """
    return render_template("payments_manage_users.html")


@bp.route("/api/manage-users", methods=["GET"])
@require_site_admin_session
def api_list_manage_users():
    """
    Returns JSON list of payments admin users (for the manage UI).
    """
    if PaymentsAdminUser is None:
        return jsonify({"error": "payments admin users model not available"}), 500
    users = PaymentsAdminUser.query.order_by(PaymentsAdminUser.username).all()
    return jsonify([{"id": u.id, "username": u.username, "role": u.role, "created_at": u.created_at.isoformat()} for u in users])


@bp.route("/api/manage-users", methods=["POST"])
@require_site_admin_session
def api_create_manage_user():
    """
    Create a PaymentsAdminUser record.
    Body JSON: { "username": "...", "password": "...", "role": "CEO" }
    """
    if PaymentsAdminUser is None or db is None:
        return jsonify({"error": "payments admin users model not available"}), 500
    data = request.get_json(force=True, silent=True) or {}
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    role = (data.get("role") or "").strip()
    if not username or not password or not role:
        return jsonify({"error": "username, password and role required"}), 400
    if role.lower() not in ("ceo", "chairman", "cfo"):
        return jsonify({"error": "invalid role; must be CEO, Chairman or CFO"}), 400

    # Check duplicates
    if PaymentsAdminUser.query.filter_by(username=username).first():
        return jsonify({"error": "user_exists"}), 409
    try:
        ph = generate_password_hash(password)
        u = PaymentsAdminUser(username=username, password_hash=ph, role=role)
        db.session.add(u)
        db.session.commit()
        return jsonify({"success": True, "id": u.id, "username": u.username, "role": u.role}), 201
    except Exception as e:
        logger.exception("Failed to create PaymentsAdminUser: %s", e)
        db.session.rollback()
        return jsonify({"error": "create_failed", "detail": str(e)}), 500


# ---------- Utilities & helpers for refunds/actions ----------

def _serialize_payment(p: Any) -> Dict[str, Any]:
    """Return a JSON-serializable dict for a Payment row (used in responses)."""
    if p is None:
        return {}
    try:
        order = None
        if getattr(p, "order_id", None) and Order is not None:
            o = Order.query.get(p.order_id)
            if o:
                order = {
                    "id": o.id,
                    "order_number": getattr(o, "order_number", None) or None,
                    "customer_name": getattr(o, "customer_name", None) or None,
                    "customer_email": getattr(o, "customer_email", None) or None,
                    "status": getattr(o, "status", None) or None,
                    "total_amount": str(getattr(o, "total_amount", None)) if getattr(o, "total_amount", None) is not None else None,
                    "currency": getattr(o, "currency", None) or None,
                }
    except Exception:
        order = None
    try:
        return {
            "id": p.id,
            "order_id": getattr(p, "order_id", None),
            "provider": getattr(p, "provider", None),
            "provider_order_id": getattr(p, "provider_order_id", None),
            "provider_capture_id": getattr(p, "provider_capture_id", None),
            "amount": str(getattr(p, "amount", None)),
            "currency": getattr(p, "currency", None),
            "status": getattr(p, "status", None),
            "payer_name": getattr(p, "payer_name", None),
            "payer_email": getattr(p, "payer_email", None),
            "payer_id": getattr(p, "payer_id", None),
            "raw_response": getattr(p, "raw_response", None),
            "created_at": getattr(p, "created_at").isoformat() if getattr(p, "created_at", None) else None,
            "order": order
        }
    except Exception:
        return {"id": getattr(p, "id", None)}


def _append_admin_action(p: Any, action_record: Dict[str, Any]) -> None:
    """
    Append an admin action record into p.raw_response['_admin_actions'] (creates it if necessary)
    and persist p to DB. Best-effort; failures are non-fatal beyond logging.
    """
    try:
        if p is None:
            return
        rr = getattr(p, "raw_response", None) or {}
        if not isinstance(rr, dict):
            # if it's JSON string, try parse
            try:
                rr = json.loads(rr)
            except Exception:
                rr = {}
        actions = rr.get("_admin_actions", [])
        actions.append(action_record)
        rr["_admin_actions"] = actions
        p.raw_response = rr
        db.session.add(p)
        db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.exception("Failed to persist admin action for payment %s", getattr(p, "id", "<unknown>"))


def _call_paypal_refund(capture_id: str, amount: Optional[float], currency: str, note: str) -> Dict[str, Any]:
    """
    Call PayPal capture refund API. Returns PayPal response JSON or raises requests.HTTPError / Exception.
    If amount is None -> refund full amount (no 'amount' in payload).
    """
    if not get_paypal_access_token or not PAYPAL_BASE:
        raise RuntimeError("PayPal integration not configured on server")
    token = get_paypal_access_token()
    url = f"{PAYPAL_BASE}/v2/payments/captures/{capture_id}/refund"
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    payload = {}
    if amount is not None:
        # Ensure amount as string with two decimals
        payload["amount"] = {"value": f"{float(amount):.2f}", "currency_code": (currency or "USD")}
    if note:
        payload["note_to_payer"] = note
    r = requests.post(url, headers=headers, json=payload or {}, timeout=20)
    r.raise_for_status()
    return r.json()


def _perform_payment_action(payment: Any, action: str, refund_amount: Optional[float], refund_percent: Optional[float], note: str, actor: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """
    Perform admin action on a Payment record.
    action: 'hold' | 'review' | 'refund' | 'rejected' | 'settled'
    refund_amount: explicit numeric amount (optional)
    refund_percent: numeric 25/50/100 etc. (optional)
    note: optional text to store/send
    actor: optional dict { username, role } for audit record

    Returns dict { success: bool, message: str, updated_payment?: {...}, refund_response?: {...} }
    """
    if payment is None:
        return {"success": False, "message": "payment_not_found"}

    # Resolve gross amount if needed
    try:
        gross = float(payment.amount) if getattr(payment, "amount", None) is not None else None
    except Exception:
        gross = None

    resolved_refund_amount = None
    if action == "refund":
        # If refund_amount provided, use it. Else if refund_percent provided compute.
        if refund_amount is not None:
            try:
                resolved_refund_amount = float(refund_amount)
            except Exception:
                resolved_refund_amount = None
        elif refund_percent is not None and gross is not None:
            try:
                resolved_refund_amount = round((float(refund_percent) / 100.0) * float(gross), 2)
            except Exception:
                resolved_refund_amount = None
        else:
            # Full refund fallback
            resolved_refund_amount = float(gross) if gross is not None else None

    # Build audit record
    action_record = {
        "timestamp": __import__("datetime").datetime.utcnow().isoformat(),
        "actor": actor or {"username": getattr(request, "payments_admin_user", {}).get("username", "unknown")},
        "action": action,
        "refund_amount": resolved_refund_amount,
        "refund_percent": refund_percent,
        "note": note
    }

    # If action is hold -> mark status and persist
    if action in ("hold", "on_hold"):
        payment.status = "on_hold"
        _append_admin_action(payment, action_record)
        try:
            db.session.add(payment)
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            logger.exception("Failed to persist on_hold status for payment %s", payment.id)
            return {"success": False, "message": "db_persist_failed"}
        return {"success": True, "message": "payment_on_hold", "updated_payment": _serialize_payment(payment)}

    # review/disputed
    if action in ("review", "dispute", "disputed"):
        payment.status = "disputed"
        _append_admin_action(payment, action_record)
        try:
            db.session.add(payment)
            db.session.commit()
        except Exception:
            try:
                db.session.rollback()
            except Exception:
                pass
            logger.exception("Failed to persist disputed status for payment %s", payment.id)
            return {"success": False, "message": "db_persist_failed"}
        return {"success": True, "message": "payment_marked_disputed", "updated_payment": _serialize_payment(payment)}

    # rejected/settled: admin rejects the customer's claim -> funds stay with merchant (treat as settled sales)
    if action in ("rejected", "settled", "reject"):
        try:
            # set a clear settled status on payment
            payment.status = "settled"
            # if there's an associated Order model (payments.models_payments.Order), mark order as paid/settled
            try:
                if getattr(payment, "order_id", None) and Order is not None:
                    o = Order.query.get(payment.order_id)
                    if o:
                        # Mark as paid; chosen canonical value is 'paid'
                        o.status = "paid"
                        db.session.add(o)
            except Exception:
                # non-fatal if order update fails
                logger.exception("Failed to update linked order status for payment %s", getattr(payment, "id", "<unknown>"))
            _append_admin_action(payment, action_record)
            try:
                db.session.add(payment)
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                logger.exception("Failed to persist settled/rejected status for payment %s", payment.id)
                return {"success": False, "message": "db_persist_failed"}
            return {"success": True, "message": "payment_settled_rejected", "updated_payment": _serialize_payment(payment)}
        except Exception as e:
            logger.exception("Unexpected error applying rejected/settled action to payment %s: %s", getattr(payment, "id", "<unknown>"), e)
            return {"success": False, "message": "rejected_action_failed", "detail": str(e)}

    # Refund flow (calls provider)
    if action == "refund":
        # If provider unsupported -> return an informative error and still record action
        provider = (getattr(payment, "provider", "") or "").lower()
        capture_id = getattr(payment, "provider_capture_id", None)
        currency = getattr(payment, "currency", None) or "USD"

        if provider != "paypal":
            # record admin intent but do not call provider
            action_record["warning"] = f"provider_{provider}_unsupported_for_refund"
            _append_admin_action(payment, action_record)
            payment.status = "refund_pending"
            try:
                db.session.add(payment)
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
            return {"success": False, "message": "unsupported_provider_for_refund", "updated_payment": _serialize_payment(payment)}

        if not capture_id:
            _append_admin_action(payment, {**action_record, "error": "no_capture_id"})
            return {"success": False, "message": "no_capture_id"}

        # Attempt PayPal refund
        try:
            refund_resp = _call_paypal_refund(capture_id=capture_id, amount=resolved_refund_amount, currency=currency, note=note)
            # Persist refund info to raw_response._refunds and update status
            try:
                rr = getattr(payment, "raw_response", None) or {}
                if not isinstance(rr, dict):
                    try:
                        rr = json.loads(rr)
                    except Exception:
                        rr = {}
                # ensure _refunds list
                rf_list = rr.get("_refunds", [])
                rf_list.append(refund_resp)
                rr["_refunds"] = rf_list
                # append admin action as well
                rr.setdefault("_admin_actions", []).append(action_record)
                payment.raw_response = rr
                payment.status = "refunded"
                db.session.add(payment)
                db.session.commit()
            except Exception:
                try:
                    db.session.rollback()
                except Exception:
                    pass
                logger.exception("Failed to persist refund info for payment %s", payment.id)
            return {"success": True, "message": "refund_initiated", "refund_response": refund_resp, "updated_payment": _serialize_payment(payment)}
        except requests.HTTPError as he:
            logger.exception("PayPal refund HTTP error for capture %s: %s", capture_id, he)
            try:
                details = he.response.json()
            except Exception:
                details = {"error": str(he)}
            # Persist failed attempt as admin action
            _append_admin_action(payment, {**action_record, "error": "paypal_refund_failed", "detail": details})
            return {"success": False, "message": "paypal_refund_failed", "detail": details}, 502
        except Exception as e:
            logger.exception("Unexpected refund error for capture %s: %s", capture_id, e)
            _append_admin_action(payment, {**action_record, "error": "refund_failed", "detail": str(e)})
            return {"success": False, "message": "refund_failed", "detail": str(e)}, 500

    # Unknown action
    return {"success": False, "message": "unknown_action"}


# ---------- Payments listing with optional server-side filtering ----------
def _parse_iso_date_str(d: str) -> date:
    """
    Parse YYYY-MM-DD style date string into a date object.
    Raises ValueError on bad input.
    """
    # Accept full ISO and also plain YYYY-MM-DD
    return date.fromisoformat(d)


@bp.route("/api/payments", methods=["GET"])
@require_payments_admin
def api_list_payments():
    if Payment is None:
        return jsonify({"error": "payments model not available"}), 500
    try:
        page = int(request.args.get("page", 1))
        per_page = min(int(request.args.get("per_page", 25)), 200)
    except Exception:
        page = 1
        per_page = 25

    # Duration filtering support:
    # Accepts: duration=daily|yesterday|weekly|monthly|yearly|custom|all
    # - daily (default/no param) => today from 00:00 UTC to next day 00:00 UTC
    # - yesterday => previous calendar day
    # - weekly => last 7 days inclusive (start = today 00:00 - 6 days)
    # - monthly => last 30 days
    # - yearly => last 365 days
    # - custom => requires from & to query params in YYYY-MM-DD (inclusive)
    # - all => no date-based filter
    duration = (request.args.get("duration") or "").strip().lower()
    if not duration:
        # frontend historically omitted 'duration' for daily — treat missing as daily
        duration = "daily"

    now = datetime.utcnow()
    today_start = datetime(now.year, now.month, now.day)
    start_dt = None
    end_dt = None

    try:
        if duration in ("daily", "today"):
            start_dt = today_start
            end_dt = today_start + timedelta(days=1)
        elif duration == "yesterday":
            start_dt = today_start - timedelta(days=1)
            end_dt = today_start
        elif duration in ("weekly", "week"):
            # last 7 days including today
            start_dt = today_start - timedelta(days=6)
            end_dt = now
        elif duration in ("monthly", "month"):
            # last 30 days including today
            start_dt = today_start - timedelta(days=29)
            end_dt = now
        elif duration in ("yearly", "year"):
            # last 365 days
            start_dt = today_start - timedelta(days=364)
            end_dt = now
        elif duration == "custom":
            from_str = (request.args.get("from") or request.args.get("from_date") or "").strip()
            to_str = (request.args.get("to") or request.args.get("to_date") or "").strip()
            if not from_str or not to_str:
                return jsonify({"error": "custom_duration_requires_from_and_to"}), 400
            try:
                d_from = _parse_iso_date_str(from_str)
                d_to = _parse_iso_date_str(to_str)
            except Exception:
                return jsonify({"error": "invalid_from_or_to_date", "message": "Expected YYYY-MM-DD"}), 400
            start_dt = datetime(d_from.year, d_from.month, d_from.day)
            # make end exclusive (next day after 'to')
            end_dt = datetime(d_to.year, d_to.month, d_to.day) + timedelta(days=1)
        elif duration == "all":
            start_dt = None
            end_dt = None
        else:
            # Unknown duration — treat as daily by default to be safe
            start_dt = today_start
            end_dt = today_start + timedelta(days=1)
    except Exception:
        # If anything goes wrong computing dates, fall back to no date filter (safer)
        logger.exception("Failed to compute duration bounds for %s", duration)
        start_dt = None
        end_dt = None

    # Base query
    q = Payment.query

    # Apply date range filters if computed
    if start_dt is not None and end_dt is not None:
        try:
            q = q.filter(Payment.created_at >= start_dt, Payment.created_at < end_dt)
        except Exception:
            logger.exception("Failed to apply created_at range filter; ignoring date filter")
    elif start_dt is not None and end_dt is None:
        # e.g. weekly/monthly/yearly where end is 'now' - use >= start_dt
        try:
            q = q.filter(Payment.created_at >= start_dt)
        except Exception:
            logger.exception("Failed to apply created_at >= filter; ignoring date filter")

    q = q.order_by(Payment.created_at.desc())

    # Optional server-side filters (simple)
    status_filter = (request.args.get("status") or "").strip().lower()
    category = (request.args.get("category") or "").strip().lower()  # alternate param
    if status_filter:
        if status_filter in ("refunded", "refund"):
            q = q.filter(Payment.status.ilike("%refund%"))
        elif status_filter in ("disputed", "disput"):
            q = q.filter(Payment.status.ilike("%disput%"))
        elif status_filter in ("on_hold", "hold", "held"):
            q = q.filter(Payment.status.ilike("%hold%") | (Payment.status == "on_hold"))
        elif status_filter in ("settled", "rejected", "rejected_settled"):
            q = q.filter(Payment.status.ilike("%settle%") | (Payment.status == "settled"))
        else:
            q = q.filter(Payment.status.ilike(f"%{status_filter}%"))
    elif category:
        # support legacy category keys from frontend (cash-in, today, prev-day, filtered)
        cat = category
        if cat == "refunded":
            q = q.filter(Payment.status.ilike("%refund%"))
        elif cat == "disputed":
            q = q.filter(Payment.status.ilike("%disput%"))
        elif cat in ("settled", "rejected"):
            q = q.filter(Payment.status.ilike("%settle%") | (Payment.status == "settled"))
        # else do nothing (frontend can still handle client-side)

    pagination = q.paginate(page=page, per_page=per_page, error_out=False)

    items = []
    for p in pagination.items:
        order = None
        if p.order_id and Order is not None:
            o = Order.query.get(p.order_id)
            if o:
                order = {
                    "id": o.id,
                    "order_number": getattr(o, "order_number", None) or None,
                    "customer_name": getattr(o, "customer_name", None) or None,
                    "customer_email": getattr(o, "customer_email", None) or None,
                    "status": getattr(o, "status", None) or None,
                    "total_amount": str(getattr(o, "total_amount", None)) if getattr(o, "total_amount", None) is not None else None,
                    "currency": getattr(o, "currency", None) or None,
                }
        items.append({
            "id": p.id,
            "order_id": p.order_id,
            "provider": p.provider,
            "provider_order_id": p.provider_order_id,
            "provider_capture_id": p.provider_capture_id,
            "amount": str(p.amount),
            "currency": p.currency,
            "status": p.status,
            "payer_name": p.payer_name,
            "payer_email": p.payer_email,
            "payer_id": p.payer_id,
            "raw_response": p.raw_response,
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "order": order
        })

    return jsonify({
        "items": items,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "total": pagination.total,
        "pages": pagination.pages
    })


@bp.route("/api/payments/<int:payment_id>", methods=["GET"])
@require_payments_admin
def api_payment_detail(payment_id: int):
    if Payment is None:
        return jsonify({"error": "payments model not available"}), 500
    p = Payment.query.get(payment_id)
    if not p:
        return jsonify({"error": "not_found"}), 404
    order = None
    if p.order_id and Order is not None:
        o = Order.query.get(p.order_id)
        if o:
            order = {
                "id": o.id,
                "order_number": getattr(o, "order_number", None) or None,
                "customer_name": getattr(o, "customer_name", None) or None,
                "customer_email": getattr(o, "customer_email", None) or None,
                "status": getattr(o, "status", None) or None,
                "total_amount": str(getattr(o, "total_amount", None)) if getattr(o, "total_amount", None) is not None else None,
                "currency": getattr(o, "currency", None) or None,
            }
    resp = {
        "id": p.id,
        "order_id": p.order_id,
        "provider": p.provider,
        "provider_order_id": p.provider_order_id,
        "provider_capture_id": p.provider_capture_id,
        "amount": str(p.amount),
        "currency": p.currency,
        "status": p.status,
        "payer_name": p.payer_name,
        "payer_email": p.payer_email,
        "payer_id": p.payer_id,
        "raw_response": p.raw_response,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "order": order
    }
    return jsonify(resp)


# Backwards-compatible endpoint that accepts structured payload via URL path
@bp.route("/api/payments/<int:payment_id>/refund", methods=["POST"])
@require_payments_admin
def api_payment_refund(payment_id: int):
    """
    Legacy/ID-based refund endpoint. Now accepts structured payload:
      { "action": "refund"|"hold"|"review"|"rejected", "refund_amount": 10.00, "refund_percent": 50, "note": "..." }
    This delegates to _perform_payment_action to unify logic with the new endpoint below.
    """
    if Payment is None:
        return jsonify({"error": "payments model not available"}), 500
    p = Payment.query.get(payment_id)
    if not p:
        return jsonify({"error": "not_found"}), 404

    data = request.get_json(force=True, silent=True) or {}
    action = (data.get("action") or "refund").strip().lower()
    refund_amount = data.get("refund_amount") if "refund_amount" in data else data.get("amount")
    refund_percent = data.get("refund_percent")
    note = data.get("note") or data.get("note_to_payer") or ""

    actor = getattr(request, "payments_admin_user", None) or {"username": session.get("user", "unknown")}
    result = _perform_payment_action(p, action=action, refund_amount=refund_amount, refund_percent=refund_percent, note=note, actor=actor)
    # _perform_payment_action may return a tuple-like (dict, status) in error cases (HTTPError path). Normalize:
    if isinstance(result, tuple):
        body, status = result
        return jsonify(body), status
    return jsonify(result)


# New generic refund/action endpoint expected by updated frontend:
# POST /payments-admin/api/refund
# Payload: { payment_id, action: 'hold'|'review'|'refund'|'rejected', refund_amount?, refund_percent?, note? }
@bp.route("/api/refund", methods=["POST"])
@require_payments_admin
def api_payment_refund_generic():
    """
    New frontend-friendly endpoint that accepts a JSON body with:
      { "payment_id": 123, "action": "refund"|"hold"|"review"|"rejected", "refund_amount": 10.00, "refund_percent": 25, "note": "..." }

    Behavior:
      - 'hold' -> set payment.status = 'on_hold' and record admin action.
      - 'review' -> set payment.status = 'disputed' and record admin action.
      - 'refund' -> attempt provider refund (PayPal supported). Accepts refund_amount OR refund_percent.
      - 'rejected'/'settled' -> mark the claim rejected and set payment.status='settled'; linked order (if present) marked 'paid'.
    Returns JSON with success flag, message and updated_payment (best-effort).
    """
    if Payment is None:
        return jsonify({"error": "payments model not available"}), 500
    data = request.get_json(force=True, silent=True) or {}
    payment_id = data.get("payment_id") or data.get("paymentId") or data.get("id")
    if not payment_id:
        return jsonify({"error": "payment_id required"}), 400
    try:
        pid = int(payment_id)
    except Exception:
        return jsonify({"error": "invalid_payment_id"}), 400
    p = Payment.query.get(pid)
    if not p:
        return jsonify({"error": "payment_not_found"}), 404

    action = (data.get("action") or "refund").strip().lower()
    refund_amount = data.get("refund_amount") if "refund_amount" in data else data.get("amount")
    refund_percent = data.get("refund_percent")
    note = data.get("note") or data.get("note_to_payer") or ""

    actor = getattr(request, "payments_admin_user", None) or {"username": session.get("user", "unknown")}
    result = _perform_payment_action(p, action=action, refund_amount=refund_amount, refund_percent=refund_percent, note=note, actor=actor)
    if isinstance(result, tuple):
        body, status = result
        return jsonify(body), status
    return jsonify(result)