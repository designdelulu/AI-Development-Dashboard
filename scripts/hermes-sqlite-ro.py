#!/usr/bin/env python3
"""Read only safe, structural Hermes metadata; never query messages or FTS."""
import json
import sqlite3
import sys

db_path = sys.argv[1] if len(sys.argv) > 1 else ""
operation = sys.argv[2] if len(sys.argv) > 2 else "history"
limit = max(1, min(int(sys.argv[3]) if len(sys.argv) > 3 else 2000, 2000))

def table_exists(conn, name):
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (name,)).fetchone() is not None

try:
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=0.6)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only=ON")
    if not table_exists(conn, "sessions"):
        print(json.dumps({"supported": False, "sessions": [], "modelUsage": [], "turnLeases": []}))
        raise SystemExit(0)
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)")}
    required = {"id", "source", "model", "started_at", "ended_at", "input_tokens", "output_tokens"}
    if not required.issubset(columns):
        print(json.dumps({"supported": False, "sessions": [], "modelUsage": [], "turnLeases": []}))
        raise SystemExit(0)
    safe_where = "COALESCE(source, '') != 'tool' AND COALESCE(hidden, 0) = 0"
    session_columns = "id, source, model, parent_session_id, started_at, ended_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, cwd, git_repo_root, billing_provider, last_activity_at, api_call_count, tool_call_count, message_count"
    if operation == "live":
        leases = []
        if table_exists(conn, "session_turn_leases"):
            leases = [dict(row) for row in conn.execute("SELECT conversation_id, acquired_at, expires_at FROM session_turn_leases WHERE expires_at > strftime('%s','now')")]
        ids = [row["conversation_id"] for row in leases if row["conversation_id"]]
        sessions = []
        if ids:
            placeholders = ",".join("?" for _ in ids)
            sessions = [dict(row) for row in conn.execute(f"SELECT {session_columns} FROM sessions WHERE id IN ({placeholders}) AND {safe_where}", ids)]
        print(json.dumps({"supported": True, "sessions": sessions, "modelUsage": [], "turnLeases": leases}))
    else:
        sessions = [dict(row) for row in conn.execute(f"SELECT {session_columns} FROM sessions WHERE {safe_where} AND (COALESCE(message_count,0) > 0 OR COALESCE(api_call_count,0) > 0 OR COALESCE(input_tokens,0) > 0 OR COALESCE(output_tokens,0) > 0 OR COALESCE(cache_read_tokens,0) > 0 OR COALESCE(cache_write_tokens,0) > 0 OR COALESCE(reasoning_tokens,0) > 0) ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT ?", (limit,))]
        usage = []
        if table_exists(conn, "session_model_usage"):
            usage_columns = {row[1] for row in conn.execute("PRAGMA table_info(session_model_usage)")}
            required_usage = {"session_id", "model", "input_tokens", "output_tokens", "last_seen"}
            if required_usage.issubset(usage_columns):
                usage = [dict(row) for row in conn.execute(f"SELECT u.session_id, u.model, u.billing_provider, u.input_tokens, u.output_tokens, u.cache_read_tokens, u.cache_write_tokens, u.reasoning_tokens, u.first_seen, u.last_seen FROM session_model_usage u JOIN sessions s ON s.id = u.session_id WHERE {safe_where.replace('source', 's.source').replace('hidden', 's.hidden')} ORDER BY u.last_seen DESC LIMIT ?", (limit,))]
        print(json.dumps({"supported": True, "sessions": sessions, "modelUsage": usage, "turnLeases": []}))
except Exception:
    print(json.dumps({"supported": False, "sessions": [], "modelUsage": [], "turnLeases": []}))
