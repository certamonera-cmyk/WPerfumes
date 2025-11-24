"""app/__init__.py

Application factory and extension initialization for the WPerfumes Flask app.
This version includes:
 - Optional local SQLite fallback for development
 - Automatic SQLAlchemy engine connect_args for Postgres SSL (sslmode=require)
"""
import os
import logging
from flask import Flask

from flask_sqlalchemy import SQLAlchemy
from flask_mail import Mail
from flask_cors import CORS
from flask_migrate import Migrate

db = SQLAlchemy()
mail = Mail()
migrate = Migrate()


def _normalize_database_url(url: str) -> str:
    if not url:
        return url
    # normalize older provider scheme
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def _expose_unprefixed_endpoints(app: Flask, blueprint_name: str) -> None:
    created = []
    try:
        for rule in list(app.url_map.iter_rules()):
            ep = rule.endpoint
            if not ep.startswith(blueprint_name + "."):
                continue
            unprefixed = ep.split(".", 1)[1]
            if unprefixed in app.view_functions:
                continue
            view_func = app.view_functions.get(ep)
            if view_func is None:
                continue
            methods = sorted(
                m for m in rule.methods if m not in ("HEAD", "OPTIONS"))
            try:
                app.add_url_rule(rule.rule, endpoint=unprefixed,
                                 view_func=view_func, methods=methods)
                created.append((rule.rule, ep, unprefixed))
            except Exception as exc:
                app.logger.debug(
                    f"Could not create alias for {ep} -> {unprefixed}: {exc}")
    except Exception as e:
        app.logger.debug(f"Error while exposing unprefixed endpoints: {e}")

    if created:
        for path, src, alias in created:
            app.logger.debug(
                f"Created endpoint alias: {src} -> {alias} (path: {path})")


def create_app(test_config=None) -> Flask:
    app = Flask(__name__, instance_relative_config=True)

    app.config.from_mapping(
        SECRET_KEY=os.environ.get("SECRET_KEY", "dev-secret-key"),
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
    )

    app.config.setdefault("SESSION_COOKIE_SAMESITE", "Lax")
    app.config.setdefault("SESSION_COOKIE_SECURE", False)

    # instance config override (optional)
    app.config.from_pyfile("config.py", silent=True)

    # Determine DATABASE_URL. If missing, fall back to a local SQLite for dev.
    database_url = os.environ.get(
        "DATABASE_URL") or app.config.get("DATABASE_URL")
    if not database_url:
        # FALLBACK to SQLite for local development to avoid forced remote Postgres connectivity
        dev_sqlite = os.path.join(app.instance_path, "dev.sqlite")
        os.makedirs(os.path.dirname(dev_sqlite), exist_ok=True)
        database_url = f"sqlite:///{dev_sqlite}"
        app.logger.warning(
            "DATABASE_URL not set - falling back to local sqlite at %s", dev_sqlite)

    database_url = _normalize_database_url(database_url)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url

    # If connecting to Postgres and sslmode wasn't specified, instruct SQLAlchemy/psycopg2 to require SSL.
    engine_opts = app.config.get("SQLALCHEMY_ENGINE_OPTIONS", {}) or {}
    try:
        if database_url.startswith("postgresql://") and "sslmode=" not in database_url and "connect_args" not in engine_opts:
            # This will instruct psycopg2 to use SSL (no host cert verification) which is sufficient for most providers.
            engine_opts["connect_args"] = {
                "sslmode": os.environ.get("PGSSLMODE", "require")}
            app.logger.debug("Setting SQLALCHEMY_ENGINE_OPTIONS.connect_args.sslmode=%s",
                             engine_opts["connect_args"]["sslmode"])
    except Exception:
        app.logger.debug("Could not set postgres sslmode engine option")

    # Apply engine options if present
    if engine_opts:
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = engine_opts

    # Mail defaults
    if "MAIL_USERNAME" in os.environ:
        app.config["MAIL_USERNAME"] = os.environ.get("MAIL_USERNAME")
    if "MAIL_PASSWORD" in os.environ:
        app.config["MAIL_PASSWORD"] = os.environ.get("MAIL_PASSWORD")
    app.config.setdefault("MAIL_SERVER", "smtp.gmail.com")
    app.config.setdefault("MAIL_PORT", 587)
    app.config.setdefault("MAIL_USE_TLS", True)
    app.config.setdefault("MAIL_USE_SSL", False)

    db.init_app(app)
    mail.init_app(app)
    CORS(app, supports_credentials=True)
    migrate.init_app(app, db)

    # Register blueprints (same pattern as before) - keep the existing import/register logic
    try:
        from . import models  # noqa: F401
    except Exception:
        app.logger.debug("Could not import app.models during create_app")

    # Try to import payments models so migrations can pick them up if present.
    try:
        from . import models_payments  # noqa: F401
    except Exception:
        app.logger.debug(
            "models_payments not available during create_app (payments models will be disabled)")

    try:
        from .routes import bp as main_bp
        app.register_blueprint(main_bp)
        if os.environ.get("EXPOSE_LEGACY_ENDPOINTS", "1") != "0":
            try:
                _expose_unprefixed_endpoints(app, blueprint_name=main_bp.name)
            except Exception as e:
                app.logger.debug(
                    f"Failed to create unprefixed endpoint aliases: {e}")
    except Exception as e:
        app.logger.debug(f"Failed to register routes blueprint: {e}")

    # register other blueprints in a fault tolerant manner (unchanged)
    try:
        from .routes_settings import settings_bp
        app.register_blueprint(settings_bp)
    except Exception as e:
        app.logger.debug(f"Failed to register settings blueprint: {e}")
    try:
        from .routes_top_picks_stub import top_picks_bp
        app.register_blueprint(top_picks_bp)
    except Exception as e:
        app.logger.debug(f"Failed to register top-picks blueprint: {e}")
    try:
        from .routes_content import content_bp
        app.register_blueprint(content_bp, url_prefix="/content-api")

        @app.route("/content-admin")
        def _content_admin_alias():
            from flask import render_template, session
            signin_required = not (session.get(
                "user") in ("admin", "admin@example.com"))
            return render_template("content_admin.html", signin_required=signin_required)
    except Exception as e:
        app.logger.debug(f"Failed to register content blueprint: {e}")
    try:
        from .routes_search import search_bp
        app.register_blueprint(search_bp)
    except Exception as e:
        app.logger.debug(f"Failed to register search blueprint: {e}")
    try:
        from .routes_price_comparison import price_cmp_bp
        app.register_blueprint(price_cmp_bp)
    except Exception as e:
        app.logger.debug(f"Failed to register price comparison blueprint: {e}")
    try:
        from .payments_paypal import paypal_bp
        app.register_blueprint(paypal_bp, url_prefix="/paypal")
        app.logger.debug(
            "Registered PayPal payments blueprint with prefix /paypal")
    except Exception as e:
        app.logger.debug(f"Failed to register PayPal blueprint: {e}")

    # register payments-admin blueprint (existing file routes_payments_admin.py defines url_prefix)
    try:
        from .routes_payments_admin import bp as payments_admin_bp
        # uses url_prefix defined in blueprint
        app.register_blueprint(payments_admin_bp)
        app.logger.debug(
            "Registered payments-admin blueprint with prefix /payments-admin")
    except Exception as e:
        app.logger.debug(f"Failed to register payments-admin blueprint: {e}")

    try:
        # Set Jinja globals for PayPal client id/mode/currency.
        # Client ID replaced with provided sandbox client id (hard-coded per request).
        app.jinja_env.globals['PAYPAL_CLIENT_ID'] = "Aex5V6cd5gPmzyKIQ48BSM6iqwfpcZh_8YtxE_Dtn-F5txEJ1q4aaYguPAah098_VIAg6G5JnXJEZT3v"
        app.jinja_env.globals['PAYPAL_MODE'] = (
            os.environ.get("PAYPAL_MODE") or "sandbox").lower()
        app.jinja_env.globals['PAYPAL_CURRENCY'] = os.environ.get(
            "PAYPAL_CURRENCY", "USD")
    except Exception:
        app.logger.debug("Unable to set PayPal Jinja globals")

    with app.app_context():
        app.logger.debug("Database configured at: %s",
                         app.config.get("SQLALCHEMY_DATABASE_URI"))
        try:
            app.logger.debug("Registered routes:")
            for rule in app.url_map.iter_rules():
                app.logger.debug(f"{rule} -> methods={sorted(rule.methods)}")
        except Exception:
            pass
    if not app.logger.handlers:
        logging.basicConfig(level=logging.INFO)
    return app
