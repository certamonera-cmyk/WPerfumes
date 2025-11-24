#!/usr/bin/env python3
"""
One-off script to create missing tables using SQLAlchemy's create_all().
Run this during deploy (before starting the webserver) or run locally
with DATABASE_URL pointing at your Render DB to create remote tables.
"""
import sys

try:
    # common factory pattern: from app import create_app, db
    from app import create_app, db
    app = create_app()
    with app.app_context():
        db.create_all()
        print("Database tables created via app.create_app() + db.create_all()")
        sys.exit(0)
except Exception:
    pass

try:
    # common direct pattern: from app import app, db
    from app import app, db
    with app.app_context():
        db.create_all()
        print("Database tables created via app + db.create_all()")
        sys.exit(0)
except Exception as e:
    print("Failed to create tables automatically:", e, file=sys.stderr)
    sys.exit(2)
