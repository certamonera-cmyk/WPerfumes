#!/usr/bin/env python3
import os, sys, traceback

def safe_print(*a, **k):
    print(*a, **k)
    sys.stdout.flush()

safe_print("=== Python executable ===")
safe_print(sys.executable)
safe_print("=== Python version ===")
safe_print(sys.version)
safe_print("=== CWD ===")
safe_print(os.getcwd())
safe_print("=== ENV vars (selected) ===")
for k in ("DATABASE_URL","FLASK_APP","FLASK_ENV","APP_SETTINGS","APP_CONFIG"):
    safe_print(f"{k}={os.environ.get(k)!r}")
safe_print("=== sys.path ===")
for p in sys.path:
    safe_print(p)
safe_print("=== Attempting imports and create_all ===")

def attempt(fn):
    try:
        fn()
    except Exception:
        safe_print("EXCEPTION:")
        safe_print(traceback.format_exc())

# 1) try import module app
def t1():
    import app
    safe_print("Imported module 'app' OK:", repr(app))
attempt(t1)

# 2) try from app import create_app, db
def t2():
    from app import create_app, db
    safe_print("Imported create_app and db from app; create_app:", create_app)
    app_inst = create_app() if callable(create_app) else None
    safe_print("create_app() returned:", app_inst)
    if app_inst:
        with app_inst.app_context():
            safe_print("Calling db.create_all()...")
            db.create_all()
            safe_print("db.create_all() OK")
attempt(t2)

# 3) try from app import app, db
def t3():
    from app import app as app_obj, db
    safe_print("Imported app and db; app:", app_obj)
    if app_obj:
        with app_obj.app_context():
            safe_print("Calling db.create_all() on app object...")
            db.create_all()
            safe_print("db.create_all() OK")
attempt(t3)

# 4) try import db only
def t4():
    try:
        from app import db
        safe_print("Imported db only:", db)
    except Exception:
        safe_print("Failed to import db only")
attempt(t4)

safe_print("=== debug script finished ===")
