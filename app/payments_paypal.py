"""
app/payments_paypal.py

Complete PayPal integration blueprint for WPerfumes.

Features:
- /paypal/client-config         (GET)  -> returns public client id & mode
- /paypal/create-paypal-order   (POST) -> create order server-side (returns PayPal order payload)
- /paypal/capture-paypal-order  (POST) -> capture order server-side and persist Payment + Order
- /paypal/return                (GET)  -> PayPal redirect handler (captures if needed and shows simple page)
- /paypal/cancel                (GET)  -> PayPal canceled flow
- /paypal/webhook               (POST) -> Accepts webhooks and optionally verifies signature; persists event

Notes:
- Assumes `app/models_payments.py` exists with Payment, Order, and PayPalWebhookEvent models
  (the code is defensive if models are not available).
- Reads PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE and optional PAYPAL_WEBHOOK_ID from environment.
- This file is intended to be registered in create_app() under the prefix "/paypal".
"""
from __future__ import annotations
import os
import time
import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, Any, Optional, List

import requests
from flask import Blueprint, current_app, jsonify, request, render_template_string

paypal_bp = Blueprint("paypal_bp", __name__)
logger = logging.getLogger(__name__)

# Server-side configuration from environment
# Read sensitive credentials from env (do NOT hard-code in repo)
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "")  # set in Render or .env
PAYPAL_SECRET = os.environ.get("PAYPAL_SECRET", "")        # set in Render or .env
PAYPAL_MODE = (os.environ.get("PAYPAL_MODE") or "sandbox").lower()
PAYPAL_WEBHOOK_ID = os.environ.get("PAYPAL_WEBHOOK_ID", "")  # optional verification id
PAYPAL_CURRENCY = os.environ.get("PAYPAL_CURRENCY", "USD")

PAYPAL_BASE = "https://api-m.sandbox.paypal.com" if PAYPAL_MODE == "sandbox" else "https://api-m.paypal.com"

# tiny in-process cache for OAuth token
_token_cache: Dict[str, Any] = {}

# Attempt to import persistence models (defensive)
try:
    from .models_payments import Payment as PaymentModel, Order as PaymentsOrder, PayPalWebhookEvent  # type: ignore
    from . import db  # type: ignore
except Exception as e:
    logger.debug("payments persistence models not available: %s", e)
    PaymentModel = None
    PaymentsOrder = None
    PayPalWebhookEvent = None
    db = None


# Utilities
def _cache_access_token(token: str, expires_in: int) -> None:
    _token_cache["token"] = token
    _token_cache["expires_at"] = time.time() + int(expires_in) - 30


def _get_cached_token() -> Optional[str]:
    t = _token_cache.get("token")
    if not t:
        return None
    if time.time() >= _token_cache.get("expires_at", 0):
        _token_cache.clear()
        return None
    return t


def get_paypal_access_token() -> str:
    """
    Obtain OAuth2 token from PayPal; caches it in memory.
    Raises RuntimeError on failure.
    """
    token = _get_cached_token()
    if token:
        return token

    if not PAYPAL_CLIENT_ID or not PAYPAL_SECRET:
        logger.error(
            "Missing PayPal credentials (PAYPAL_CLIENT_ID/PAYPAL_SECRET)")
        raise RuntimeError("PayPal credentials not configured on server")

    url = f"{PAYPAL_BASE}/v1/oauth2/token"
    try:
        r = requests.post(url, auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET), data={
                          "grant_type": "client_credentials"}, timeout=15)
        r.raise_for_status()
        js = r.json()
        token = js.get("access_token")
        expires_in = int(js.get("expires_in", 300))
        if not token:
            raise RuntimeError("No access_token returned from PayPal")
        _cache_access_token(token, expires_in)
        return token
    except Exception as exc:
        logger.exception("Failed to obtain PayPal access token: %s", exc)
        raise RuntimeError("Failed to obtain PayPal access token") from exc


def _paypal_get(path: str, token: str) -> Dict[str, Any]:
    url = f"{PAYPAL_BASE}{path}"
    headers = {"Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}
    r = requests.get(url, headers=headers, timeout=15)
    r.raise_for_status()
    return r.json()


def _paypal_post(path: str, token: str, payload: Dict[str, Any]) -> Dict[str, Any]:
    url = f"{PAYPAL_BASE}{path}"
    headers = {"Authorization": f"Bearer {token}",
               "Content-Type": "application/json"}
    r = requests.post(url, headers=headers, json=payload, timeout=20)
    r.raise_for_status()
    return r.json()


def _currency_safe_decimal(value: str) -> Decimal:
    d = Decimal(str(value))
    return d.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _compute_items_total(items: List[Dict[str, Any]]) -> Decimal:
    total = Decimal("0.00")
    for it in items:
        unit = Decimal(str(it.get("unit_price", "0") or "0"))
        qty = Decimal(str(it.get("quantity", "1") or "1"))
        total += (unit * qty)
    return total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def _persist_capture_idempotent(provider_order_id: str, provider_capture_id: Optional[str], capture_resp: Dict[str, Any], amount: Decimal, currency: str, payer_info: Dict[str, Any]) -> Optional[int]:
    """
    Persist capture into PaymentsOrder + PaymentModel idempotently.
    Returns PaymentModel.id or None if persistence not available or failed.
    """
    if PaymentModel is None or PaymentsOrder is None or db is None:
        logger.debug(
            "Persistence disabled - skipping DB write for capture %s", provider_capture_id)
        return None

    try:
        # prevent duplicate by capture id
        if provider_capture_id:
            existing = PaymentModel.query.filter_by(
                provider_capture_id=str(provider_capture_id)).first()
            if existing:
                logger.debug("Capture %s already persisted as payment id %s",
                             provider_capture_id, existing.id)
                return existing.id

        # create PaymentsOrder (simple)
        order_number = f"PP-{str(provider_order_id)[:60]}"
        pay_order = PaymentsOrder(order_number=order_number, total_amount=amount, currency=(
            currency or "USD"), status="paid")
        db.session.add(pay_order)
        db.session.flush()

        payer_name = payer_info.get("name")
        payer_email = payer_info.get("email")
        payer_id = payer_info.get("payer_id")

        payment = PaymentModel(
            order_id=pay_order.id,
            provider="paypal",
            provider_order_id=str(provider_order_id),
            provider_capture_id=str(
                provider_capture_id) if provider_capture_id else None,
            amount=amount,
            currency=currency or "USD",
            status=(capture_resp.get("status") or "completed").lower(),
            payer_name=payer_name,
            payer_email=payer_email,
            payer_id=payer_id,
            raw_response=capture_resp
        )
        db.session.add(payment)
        db.session.commit()
        logger.info("Persisted payment id %s for capture %s",
                    payment.id, provider_capture_id)
        return payment.id
    except Exception as exc:
        try:
            db.session.rollback()
        except Exception:
            pass
        logger.exception("Failed to persist PayPal capture: %s", exc)
        return None


# --- Blueprint endpoints ---


@paypal_bp.route("/client-config", methods=["GET"])
def paypal_client_config():
    """
    Returns public client config used by frontend to load PayPal SDK.
    """
    try:
        mode = PAYPAL_MODE if PAYPAL_MODE in ("sandbox", "live") else "sandbox"
        return jsonify({"client_id": PAYPAL_CLIENT_ID or "", "mode": mode, "currency": PAYPAL_CURRENCY or "USD"})
    except Exception as e:
        logger.exception("Failed to serve client-config: %s", e)
        return jsonify({"client_id": "", "mode": "sandbox", "currency": "USD"}), 500


@paypal_bp.route("/create-paypal-order", methods=["POST"])
def create_paypal_order():
    """
    Create PayPal order server-side. Body:
      { items: [{title, unit_price, quantity, currency}, ...], currency, return_url, cancel_url, brand_name }
    """
    data = request.get_json(force=True, silent=True) or {}
    items = data.get("items") or []
    currency = (data.get("currency") or PAYPAL_CURRENCY or "USD").upper()
    return_url = data.get("return_url")
    cancel_url = data.get("cancel_url")
    brand_name = data.get(
        "brand_name") or current_app.config.get("SITE_NAME", "")

    if not isinstance(items, list) or len(items) == 0:
        return jsonify({"error": "invalid_items", "detail": "items array required"}), 400

    try:
        total = _compute_items_total(items)
        paypal_items = []
        for it in items:
            name = str(it.get("title") or it.get("name") or "")[:127]
            unit = Decimal(str(it.get("unit_price") or it.get("price") or "0"))
            qty = int(it.get("quantity") or it.get("qty") or 1)
            paypal_items.append({
                "name": name,
                "unit_amount": {"currency_code": currency, "value": f"{unit.quantize(Decimal('0.01'))}"},
                "quantity": str(qty)
            })

        purchase_unit = {
            "amount": {
                "currency_code": currency,
                "value": f"{total}",
                "breakdown": {"item_total": {"currency_code": currency, "value": f"{total}"}}
            },
            "items": paypal_items
        }

        order_payload = {
            "intent": "CAPTURE",
            "purchase_units": [purchase_unit],
            "application_context": {"brand_name": brand_name, "landing_page": "NO_PREFERENCE", "user_action": "PAY_NOW"}
        }
        if return_url:
            order_payload["application_context"]["return_url"] = return_url
        if cancel_url:
            order_payload["application_context"]["cancel_url"] = cancel_url

        token = get_paypal_access_token()
        resp = _paypal_post("/v2/checkout/orders", token, order_payload)
        return jsonify(resp)
    except requests.HTTPError as he:
        logger.exception("PayPal create order HTTP error: %s", he)
        try:
            return jsonify({"error": "paypal_create_failed", "detail": str(he), "response": he.response.json()}), 502
        except Exception:
            return jsonify({"error": "paypal_create_failed", "detail": str(he)}), 502
    except Exception as e:
        logger.exception("Unexpected create_paypal_order error: %s", e)
        return jsonify({"error": "create_failed", "detail": str(e)}), 500


@paypal_bp.route("/capture-paypal-order", methods=["POST"])
def capture_paypal_order():
    """
    Capture PayPal order server-side and persist payment record.
    Body: { orderID: "ORDERID", items: [...] }  (items optional)
    """
    data = request.get_json(force=True, silent=True) or {}
    order_id = data.get("orderID") or data.get(
        "order_id") or data.get("orderId")
    items = data.get("items") or []

    if not order_id:
        return jsonify({"error": "missing_order_id", "detail": "orderID required"}), 400

    try:
        token = get_paypal_access_token()
    except Exception as e:
        logger.exception("Auth failure getting PayPal token: %s", e)
        return jsonify({"error": "auth_failed", "detail": str(e)}), 500

    # Fetch order
    try:
        order = _paypal_get(f"/v2/checkout/orders/{order_id}", token)
    except requests.HTTPError as he:
        logger.exception("Failed to fetch PayPal order %s: %s", order_id, he)
        return jsonify({"error": "order_fetch_failed", "detail": str(he)}), 502
    except Exception as e:
        logger.exception(
            "Unexpected error fetching PayPal order %s: %s", order_id, e)
        return jsonify({"error": "order_fetch_failed", "detail": str(e)}), 500

    # Parse amount
    try:
        pus = order.get("purchase_units") or []
        if not pus:
            return jsonify({"error": "invalid_order", "detail": "no purchase_units"}), 400
        pu0 = pus[0]
        amount_obj = pu0.get("amount") or {}
        paypal_currency = (amount_obj.get("currency_code") or "USD").upper()
        paypal_value = _currency_safe_decimal(
            str(amount_obj.get("value") or "0"))
    except Exception as e:
        logger.exception("Failed to parse PayPal order %s: %s", order_id, e)
        return jsonify({"error": "invalid_order_data", "detail": str(e)}), 500

    # Optional client validation of items -> totals
    if items and isinstance(items, list):
        try:
            client_total = _compute_items_total(items)
            if client_total != paypal_value:
                logger.warning("Amount mismatch: client %s != paypal %s for %s",
                               client_total, paypal_value, order_id)
                return jsonify({"error": "amount_mismatch", "detail": "client total != paypal total", "client_total": str(client_total), "paypal_total": str(paypal_value)}), 400
        except Exception as e:
            logger.exception("Failed computing client items total: %s", e)
            return jsonify({"error": "total_compute_failed", "detail": str(e)}), 400

    # Check if already-captured
    try:
        payments_section = pu0.get("payments", {}) or {}
        captures = payments_section.get(
            "captures", []) if payments_section else []
        for c in captures:
            if (c.get("status") or "").upper() == "COMPLETED":
                capture_id = c.get("id")
                if PaymentModel is not None:
                    existing = PaymentModel.query.filter_by(
                        provider_capture_id=str(capture_id)).first()
                    if existing:
                        return jsonify({"status": "already_captured", "order_id": order_id, "capture_id": capture_id, "payment_id": existing.id, "paypal_order": order})
                break
    except Exception:
        logger.debug(
            "Error checking captures for existing completed status; continuing.")

    # Perform capture now
    try:
        capture_resp = _paypal_post(
            f"/v2/checkout/orders/{order_id}/capture", token, {})
    except requests.HTTPError as he:
        logger.exception("PayPal capture HTTP error for %s: %s", order_id, he)
        resp_body = None
        try:
            resp_body = he.response.json()
        except Exception:
            resp_body = {"detail": str(he)}
        return jsonify({"error": "capture_failed", "detail": str(he), "response": resp_body}), 502
    except Exception as e:
        logger.exception("Unexpected capture error for %s: %s", order_id, e)
        return jsonify({"error": "capture_failed", "detail": str(e)}), 500

    # Extract capture info (first capture)
    try:
        pu_after = capture_resp.get("purchase_units", []) or []
        pu0_after = pu_after[0] if pu_after else pu0
        payments_info = pu0_after.get("payments", {}) or {}
        captures_after = payments_info.get(
            "captures", []) if payments_info else []
        capture_info = captures_after[0] if captures_after else None

        provider_order_id = capture_resp.get("id") or order_id
        provider_capture_id = capture_info.get(
            "id") if isinstance(capture_info, dict) else None
        capture_status = capture_info.get(
            "status") if isinstance(capture_info, dict) else None

        # amount from capture if present
        amt_obj = (capture_info.get("amount") if isinstance(
            capture_info, dict) else None) or amount_obj
        amount_value = amt_obj.get("value") if amt_obj else None
        currency_code = (amt_obj.get("currency_code") if amt_obj and amt_obj.get(
            "currency_code") else paypal_currency).upper()

        # Normalize amount decimal
        amount_decimal = _currency_safe_decimal(
            str(amount_value or paypal_value or "0"))
    except Exception as e:
        logger.exception(
            "Failed to parse capture response for %s: %s", order_id, e)
        return jsonify({"status": "captured", "order_id": order_id, "capture_response": capture_resp})

    # Extract payer info
    try:
        payer = capture_resp.get("payer", {}) or {}
        payer_email = payer.get("email_address") or payer.get("email")
        payer_id = payer.get("payer_id") or payer.get(
            "payerID") or payer.get("payerId")
        name_obj = payer.get("name") or {}
        payer_name = None
        if isinstance(name_obj, dict):
            payer_name = " ".join(
                filter(None, [name_obj.get("given_name"), name_obj.get("surname")])).strip()
    except Exception:
        payer_name = None
        payer_email = None
        payer_id = None

    payer_info = {"name": payer_name,
                  "email": payer_email, "payer_id": payer_id}

    # Persist idempotently
    payment_id = _persist_capture_idempotent(
        provider_order_id, provider_capture_id, capture_resp, amount_decimal, currency_code, payer_info)

    return jsonify({"status": "captured", "order_id": order_id, "capture_id": provider_capture_id, "payment_id": payment_id, "capture_response": capture_resp})


@paypal_bp.route("/return", methods=["GET"])
def paypal_return():
    """
    Browser return URL for PayPal approval flow.
    """
    order_token = request.args.get("token") or request.args.get("orderID")
    if not order_token:
        logger.warning("PayPal return without token: %s", request.query_string)
        return render_template_string("<h2>Payment return error</h2><p>Missing order token.</p><p><a href='/'>Return to shop</a></p>"), 400

    try:
        token = get_paypal_access_token()
    except Exception as e:
        logger.exception("Failed to get PayPal token on /paypal/return: %s", e)
        return render_template_string("<h2>Payment error</h2><p>Unable to process return right now.</p><p><a href='/'>Return to shop</a></p>"), 500

    # Fetch order
    try:
        order = _paypal_get(f"/v2/checkout/orders/{order_token}", token)
    except Exception as e:
        logger.exception("Failed to fetch PayPal order on return: %s", e)
        return render_template_string("<h2>Payment error</h2><p>Unable to fetch PayPal order.</p><p><a href='/'>Return to shop</a></p>"), 502

    # If already captured - show success
    try:
        pus = order.get("purchase_units") or []
        pu0 = pus[0] if pus else {}
        payments = pu0.get("payments", {}) or {}
        captures = payments.get("captures", []) if payments else []
        for c in captures:
            if (c.get("status") or "").upper() == "COMPLETED":
                capture_id = c.get("id")
                return render_template_string("""
                    <h2>Payment Successful</h2>
                    <p>Your payment was completed (capture id: {{ cid }}).</p>
                    <p><a href="/">Continue shopping</a></p>
                """, cid=capture_id)
    except Exception:
        pass

    # Attempt server-side capture
    try:
        capture_resp = _paypal_post(
            f"/v2/checkout/orders/{order_token}/capture", token, {})
    except requests.HTTPError as he:
        logger.exception(
            "Capture failed on /paypal/return for %s: %s", order_token, he)
        try:
            body = he.response.json()
        except Exception:
            body = {"detail": str(he)}
        return render_template_string("<h2>Payment capture failed</h2><pre>{{ detail }}</pre><p><a href='/'>Return to shop</a></p>", detail=body), 502
    except Exception as e:
        logger.exception("Unexpected capture error on return: %s", e)
        return render_template_string("<h2>Payment capture error</h2><p>Unexpected error. Contact support.</p><p><a href='/'>Return to shop</a></p>"), 500

    # Persist capture (best-effort)
    try:
        pu_after = capture_resp.get("purchase_units", []) or []
        pu0_after = pu_after[0] if pu_after else {}
        payments_info = pu0_after.get("payments", {}) or {}
        captures_after = payments_info.get(
            "captures", []) if payments_info else []
        capture_info = captures_after[0] if captures_after else None
        provider_order_id = capture_resp.get("id") or order_token
        provider_capture_id = capture_info.get(
            "id") if isinstance(capture_info, dict) else None
        amt_obj = (capture_info.get("amount") if isinstance(
            capture_info, dict) else None) or (pu0_after.get("amount") or {})
        amount_value = amt_obj.get("value") or "0.00"
        currency_code = (amt_obj.get("currency_code") or "USD").upper()
        amount_decimal = _currency_safe_decimal(str(amount_value))
        payer = capture_resp.get("payer", {}) or {}
        payer_info = {"name": None, "email": payer.get("email_address") or payer.get(
            "email"), "payer_id": payer.get("payer_id")}
        payment_id = _persist_capture_idempotent(
            provider_order_id, provider_capture_id, capture_resp, amount_decimal, currency_code, payer_info)
    except Exception:
        payment_id = None

    # Render success page
    try:
        capture_id = provider_capture_id
    except Exception:
        capture_id = None

    return render_template_string("""
        <h2>Payment Successful</h2>
        <p>Your payment was completed successfully. Order id: <strong>{{ order_id }}</strong></p>
        {% if cid %}<p>Capture id: <strong>{{ cid }}</strong></p>{% endif %}
        {% if pid %}<p>Recorded payment id: <strong>{{ pid }}</strong></p>{% endif %}
        <p><a href="/">Continue shopping</a></p>
    """, order_id=order_token, cid=capture_id, pid=payment_id)


@paypal_bp.route("/cancel", methods=["GET"])
def paypal_cancel():
    return render_template_string("""
        <h2>Payment Cancelled</h2>
        <p>You cancelled the PayPal payment. Your order was not completed.</p>
        <p><a href="/">Return to shop</a></p>
    """), 200


@paypal_bp.route("/webhook", methods=["POST"])
def paypal_webhook():
    """
    Receive PayPal webhook events. If PAYPAL_WEBHOOK_ID is configured, attempt verification.
    Persist event into PayPalWebhookEvent model if available.
    """
    event_body = request.get_json(force=True, silent=True) or {}
    headers = dict(request.headers)

    logger.info("Received PayPal webhook event_type=%s id=%s",
                event_body.get("event_type"), event_body.get("id"))

    # Optional verification
    if PAYPAL_WEBHOOK_ID:
        try:
            token = get_paypal_access_token()
            verify_payload = {
                "transmission_id": headers.get("Paypal-Transmission-Id"),
                "transmission_time": headers.get("Paypal-Transmission-Time"),
                "cert_url": headers.get("Paypal-Cert-Url"),
                "auth_algo": headers.get("Paypal-Auth-Algo"),
                "transmission_sig": headers.get("Paypal-Transmission-Sig"),
                "webhook_id": PAYPAL_WEBHOOK_ID,
                "webhook_event": event_body
            }
            verify = _paypal_post(
                "/v1/notifications/verify-webhook-signature", token, verify_payload)
            if verify.get("verification_status") != "SUCCESS":
                logger.warning("Webhook verification failed: %s", verify)
                return jsonify({"error": "verification_failed", "details": verify}), 400
        except Exception as e:
            logger.exception("Webhook verification error: %s", e)
            return jsonify({"error": "webhook_verification_error", "detail": str(e)}), 500

    # Persist webhook event if model available
    if PayPalWebhookEvent is not None and db is not None:
        try:
            ev = PayPalWebhookEvent(event_id=event_body.get("id") or "", event_type=event_body.get(
                "event_type"), raw_event=event_body, headers=headers)
            db.session.add(ev)
            db.session.commit()
            logger.debug("Persisted PayPal webhook id=%s", ev.event_id)
        except Exception as e:
            try:
                db.session.rollback()
            except Exception:
                pass
            logger.exception("Failed to persist PayPal webhook: %s", e)

    return jsonify({"status": "accepted"}), 200