#!/usr/bin/env python3
import sys, os
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass
sys.path.insert(0, os.path.abspath('.'))
try:
    from app import create_app
    app = create_app()
    with app.app_context():
        db_uri = app.config.get("SQLALCHEMY_DATABASE_URI", "<not set>")
        safe = db_uri
        try:
            if "@" in db_uri:
                left, right = db_uri.split("@", 1)
                if "://" in left:
                    proto, creds = left.split("://", 1)
                    safe = f"{proto}://<creds>@{right}"
        except Exception:
            pass
        print("Effective SQLALCHEMY_DATABASE_URI (credentials redacted):")
        print(" ", safe)
except Exception:
    import traceback; traceback.print_exc()
    sys.exit(2)
