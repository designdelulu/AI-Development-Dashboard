#!/usr/bin/env python3
"""Read only Cline session lifecycle metadata.

This helper intentionally has a fixed allowlist of columns. It never reads
prompts, messages, transcript bodies, provider configuration, or secrets.
"""
import json
import sqlite3
import sys

db = sys.argv[1]
uri = "file:" + db + "?mode=ro"
conn = sqlite3.connect(uri, uri=True, timeout=0.25)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA query_only=ON")
conn.execute("PRAGMA busy_timeout=250")
rows = conn.execute(
    """
    SELECT session_id, pid, status, started_at, ended_at,
           provider, model, cwd, workspace_root, updated_at, status_lock
      FROM sessions
     ORDER BY updated_at DESC
     LIMIT 32
    """
).fetchall()
print(json.dumps([dict(row) for row in rows]))
conn.close()
