#!/usr/bin/env python3
"""
One-off script to create missing tables using SQLAlchemy's create_all().

This prepends the project root to sys.path so 'import app' works even when the script
is executed as: python scripts/create_db.py (which sets sys.path[0] to the scripts/ dir).
"""
import sys
from pathlib import Path

# Ensure project root is on sys.path so "import app" works
project_root = Path(__file__).resolve().parents[1]
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

import traceback

def try_create():
    try:
        # factory pattern
        from app import create_app, db
        app = create_app()
        with app.app_context():
            db.create_all()
            print("Database tables created via app.create_app() + db.create_all()")
            return 0
    except Exception:
        pass

    try:
        # direct pattern
        from app import app, db
        with app.app_context():
            db.create_all()
            print("Database tables created via app + db.create_all()")
            return 0
    except Exception as e:
        print("Failed to create tables automatically:", e)
        traceback.print_exc()
        return 2

if __name__ == "__main__":
    raise SystemExit(try_create())
