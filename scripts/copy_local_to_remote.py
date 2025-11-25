#!/usr/bin/env python3
"""
One-off copy script: copy rows from LOCAL_DB -> REMOTE_DB for small datasets.
Set LOCAL_DB and REMOTE_DB environment variables before running.
"""
import os, sys
from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

LOCAL_DB = os.environ.get("LOCAL_DB")
REMOTE_DB = os.environ.get("REMOTE_DB")
if not LOCAL_DB or not REMOTE_DB:
    print("Please set LOCAL_DB and REMOTE_DB and re-run.")
    sys.exit(1)

print("Connecting to LOCAL_DB:", LOCAL_DB)
print("Connecting to REMOTE_DB:", REMOTE_DB.split('@')[-1] if '@' in REMOTE_DB else REMOTE_DB)

local = create_engine(LOCAL_DB)
remote = create_engine(REMOTE_DB)

candidates = ["brand","brands","product","products","setting","settings"]
copied = []

with local.connect() as lconn, remote.connect() as rconn:
    for t in candidates:
        try:
            # check and fetch local rows if table exists
            try:
                rows = lconn.execute(text(f"SELECT * FROM {t} LIMIT 500")).fetchall()
            except Exception:
                # table missing locally
                print(f"Local table '{t}' not present - skipping.")
                continue
            if not rows:
                print(f"Local table '{t}' exists but has 0 rows - skipping.")
                continue
            print(f"Copying {len(rows)} rows for table '{t}' ...")
            cols = list(rows[0].keys())
            col_sql = ",".join(cols)
            placeholders = ",".join([f":{c}" for c in cols])
            insert_sql = text(f"INSERT INTO {t} ({col_sql}) VALUES ({placeholders})")
            for r in rows:
                data = dict(r)
                try:
                    rconn.execute(insert_sql, **data)
                except SQLAlchemyError as e:
                    # try insert without id if primary key conflict
                    if "id" in data:
                        data_noid = {k: v for k, v in data.items() if k != "id"}
                        cols2 = ",".join(data_noid.keys())
                        placeholders2 = ",".join([f":{c}" for c in data_noid.keys()])
                        insert_sql2 = text(f"INSERT INTO {t} ({cols2}) VALUES ({placeholders2})")
                        try:
                            rconn.execute(insert_sql2, **data_noid)
                        except Exception as e2:
                            print(f"Failed to insert row into {t} even after removing id: {e2}")
                    else:
                        print(f"Failed to insert row into {t}: {e}")
            copied.append(t)
        except Exception as e:
            print(f"Skipping {t} due to error: {e}")

print("Done. Copied tables:", copied)
