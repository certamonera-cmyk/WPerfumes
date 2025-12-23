#!/usr/bin/env python3
import os, sys, traceback
from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError

# load .env if available
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

database_url = os.environ.get("DATABASE_URL")
print("DATABASE_URL set in environment?:", bool(database_url))
if not database_url:
    print("No DATABASE_URL environment variable. Create .env or export it and re-run.")
    sys.exit(1)

# show host part (redacted)
try:
    without_scheme = database_url.split("://", 1)[-1]
    host_and_rest = without_scheme.split("@", 1)[-1] if "@" in without_scheme else without_scheme
    host_display = host_and_rest.split("/", 1)[0]
except Exception:
    host_display = "<could not parse>"
print("Attempting connection to host:", host_display)

try:
    engine = create_engine(database_url, connect_args={"connect_timeout": 5})
    with engine.connect() as conn:
        r = conn.execute("SELECT version()")
        ver = r.fetchone()
        print("Connected OK. Server version:", ver[0] if ver else ver)
except SQLAlchemyError:
    print("SQLAlchemy / DB connect failed:")
    traceback.print_exc()
    print("\nHint: make sure the DSN contains '?sslmode=require' or set PGSSLMODE=require")
    sys.exit(2)
except Exception:
    print("Unexpected exception:")
    traceback.print_exc()
    sys.exit(3)

print("DB connection test succeeded.")
