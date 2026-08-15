#!/usr/bin/env python3
"""Read-only SQLite JSON helper. SQL on stdin, db path as argv[1]. Never writes."""
import json
import sqlite3
import sys

db = sys.argv[1]
sql = sys.stdin.read()
uri = "file:" + db + "?mode=ro&immutable=1"
conn = sqlite3.connect(uri, uri=True, timeout=1.0)
conn.row_factory = sqlite3.Row
conn.execute("PRAGMA query_only=ON")
rows = conn.execute(sql).fetchall()
print(json.dumps([dict(row) for row in rows]))
conn.close()
