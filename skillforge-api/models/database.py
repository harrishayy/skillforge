"""
Database layer — Neon PostgreSQL via asyncpg, with SQLite fallback for local dev.

All query functions accept `?` placeholders (converted to `$1, $2, …` for PostgreSQL).

Set DATABASE_URL to a postgres:// or postgresql:// URI for production.
When DATABASE_URL is unset or contains the placeholder, uses local SQLite (skillforge.db).
"""
import os
import re
import uuid
import time
from pathlib import Path

import asyncpg
import aiosqlite

# ── Configuration ──────────────────────────────────────────────────────────────

_pool: asyncpg.Pool | None = None
_use_sqlite = False
_sqlite_path: str = ""

# ── Schema ─────────────────────────────────────────────────────────────────────

_CREATE_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    mode        TEXT NOT NULL CHECK(mode IN ('hardware')),
    status      TEXT NOT NULL DEFAULT 'processing'
                CHECK(status IN ('processing', 'ready', 'failed')),
    video_path  TEXT,
    duration_ms BIGINT,
    total_steps INTEGER DEFAULT 0,
    published   INTEGER DEFAULT 0,
    created_at  BIGINT NOT NULL,
    updated_at  BIGINT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS steps (
    id              TEXT PRIMARY KEY,
    workflow_id     TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    step_number     INTEGER NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    start_ms        BIGINT NOT NULL,
    end_ms          BIGINT NOT NULL,
    key_frame_path  TEXT,
    video_path      TEXT,
    ai_description  TEXT,
    transcript      TEXT,
    note            TEXT,
    sam3_prompt     TEXT,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL,
    UNIQUE(workflow_id, step_number)
)""",
    """CREATE TABLE IF NOT EXISTS annotations (
    id          TEXT PRIMARY KEY,
    step_id     TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK(type IN ('bounding_box', 'arrow', 'highlight', 'text_label')),
    label       TEXT,
    x           REAL,
    y           REAL,
    width       REAL,
    height      REAL,
    from_x      REAL,
    from_y      REAL,
    to_x        REAL,
    to_y        REAL,
    color       TEXT DEFAULT '#3B82F6',
    style       TEXT DEFAULT 'solid',
    created_at  BIGINT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS click_targets (
    id              TEXT PRIMARY KEY,
    step_id         TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    element_text    TEXT,
    element_type    TEXT,
    bbox_x          REAL NOT NULL,
    bbox_y          REAL NOT NULL,
    bbox_width      REAL NOT NULL,
    bbox_height     REAL NOT NULL,
    action          TEXT DEFAULT 'left_click',
    confidence      REAL,
    is_primary      INTEGER DEFAULT 0
)""",
    """CREATE TABLE IF NOT EXISTS step_frames (
    id                 TEXT PRIMARY KEY,
    step_id            TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    timestamp_ms       BIGINT NOT NULL,
    frame_path         TEXT NOT NULL,
    is_key_frame       INTEGER DEFAULT 0,
    object_detected    INTEGER DEFAULT 0,
    object_description TEXT,
    created_at         BIGINT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS pipeline_logs (
    id          TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    stage       TEXT NOT NULL,
    message     TEXT,
    progress    INTEGER DEFAULT 0,
    created_at  BIGINT NOT NULL
)""",
    "CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id, step_number)",
    "CREATE INDEX IF NOT EXISTS idx_annotations_step ON annotations(step_id)",
    "CREATE INDEX IF NOT EXISTS idx_click_targets_step ON click_targets(step_id)",
    "CREATE INDEX IF NOT EXISTS idx_step_frames_step ON step_frames(step_id, timestamp_ms)",
    "CREATE INDEX IF NOT EXISTS idx_pipeline_logs_workflow ON pipeline_logs(workflow_id, created_at)",
]


# ── Helpers ────────────────────────────────────────────────────────────────────

def _to_pg(sql: str) -> str:
    """Convert ? placeholders to PostgreSQL $1, $2, … notation."""
    counter = [0]

    def replace(m):
        counter[0] += 1
        return f"${counter[0]}"

    return re.sub(r"\?", replace, sql)


def _to_sql(sql: str) -> str:
    """Return SQL with correct placeholders for current backend."""
    return sql if _use_sqlite else _to_pg(sql)


def _row_to_dict(row) -> dict | None:
    """Convert asyncpg Record or aiosqlite Row to dict."""
    if row is None:
        return None
    if hasattr(row, "keys"):
        return dict(zip(row.keys(), row))
    return dict(row)


# ── SQLite fallback (local dev) ────────────────────────────────────────────────

def _is_placeholder_db_url(url: str) -> bool:
    """True if DATABASE_URL is unset or contains the Neon placeholder."""
    if not url or not url.strip():
        return True
    if "ep-your-endpoint" in url or "YOUR_PASSWORD" in url:
        return True
    return False


class _SQLitePool:
    """Minimal pool-like interface for aiosqlite, compatible with asyncpg usage."""

    def __init__(self, path: str):
        self.path = path
        self._conn: aiosqlite.Connection | None = None

    async def _get_conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            self._conn = await aiosqlite.connect(self.path)
            self._conn.row_factory = aiosqlite.Row
        return self._conn

    def acquire(self):
        return _SQLiteAcquire(self)

    async def close(self):
        if self._conn:
            await self._conn.close()
            self._conn = None


class _SQLiteAcquire:
    def __init__(self, pool: _SQLitePool):
        self.pool = pool

    async def __aenter__(self):
        self.conn = await self.pool._get_conn()
        return _SQLiteConn(self.conn)

    async def __aexit__(self, *args):
        pass


class _SQLiteConn:
    def __init__(self, conn: aiosqlite.Connection):
        self._conn = conn

    async def execute(self, sql: str, *params):
        await self._conn.execute(sql, params if params else ())

    async def fetchrow(self, sql: str, *params) -> aiosqlite.Row | None:
        cursor = await self._conn.execute(sql, params if params else ())
        row = await cursor.fetchone()
        return row

    async def fetch(self, sql: str, *params) -> list:
        cursor = await self._conn.execute(sql, params if params else ())
        return await cursor.fetchall()

    async def transaction(self):
        return _SQLiteTransaction(self._conn)


class _SQLiteTransaction:
    def __init__(self, conn: aiosqlite.Connection):
        self._conn = conn

    async def __aenter__(self):
        await self._conn.execute("BEGIN")
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            await self._conn.execute("ROLLBACK")
        else:
            await self._conn.execute("COMMIT")


# ── Initialisation ─────────────────────────────────────────────────────────────

async def init_db():
    global _pool, _use_sqlite, _sqlite_path
    db_url = os.environ.get("DATABASE_URL", "").strip()

    if _is_placeholder_db_url(db_url):
        _use_sqlite = True
        base = Path(__file__).resolve().parent.parent
        _sqlite_path = str(base / "skillforge.db")
        _pool = await _init_sqlite(_sqlite_path)
        print("[DB] Using local SQLite (skillforge.db)")
        return

    if not db_url.startswith(("postgres://", "postgresql://")):
        raise RuntimeError(
            "DATABASE_URL must be set to a postgres:// or postgresql:// URI. "
            "For local dev without Neon, leave it unset or use the placeholder."
        )

    _use_sqlite = False
    _pool = await asyncpg.create_pool(
        db_url, min_size=2, max_size=10, ssl="require",
        statement_cache_size=0,
    )
    async with _pool.acquire() as conn:
        for stmt in _CREATE_STATEMENTS:
            await conn.execute(stmt)
        await _run_migrations(conn)
    print("[DB] Connected to Neon PostgreSQL")


async def _init_sqlite(path: str) -> _SQLitePool:
    pool = _SQLitePool(path)
    async with pool.acquire() as conn:
        for stmt in _CREATE_STATEMENTS:
            await conn.execute(stmt)
    return pool


async def _run_migrations(conn):
    """Migrate existing Postgres databases to match the current schema."""
    migrations = [
        "ALTER TABLE steps ADD COLUMN IF NOT EXISTS video_path TEXT",
        "ALTER TABLE steps ADD COLUMN IF NOT EXISTS transcript TEXT",
        "ALTER TABLE steps ADD COLUMN IF NOT EXISTS note TEXT",
        "ALTER TABLE steps ADD COLUMN IF NOT EXISTS sam3_prompt TEXT",
        "ALTER TABLE workflows ADD COLUMN IF NOT EXISTS published INTEGER DEFAULT 0",
        "ALTER TABLE workflows ALTER COLUMN duration_ms TYPE BIGINT",
        "ALTER TABLE workflows ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE workflows ALTER COLUMN updated_at TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN start_ms TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN end_ms TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN updated_at TYPE BIGINT",
        "ALTER TABLE annotations ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE pipeline_logs ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE step_frames ADD COLUMN IF NOT EXISTS object_detected INTEGER DEFAULT 0",
        "ALTER TABLE step_frames ADD COLUMN IF NOT EXISTS object_description TEXT",
    ]
    for sql in migrations:
        try:
            await conn.execute(sql)
        except Exception:
            pass


# ── Query helpers ──────────────────────────────────────────────────────────────

async def fetchone(query: str, params: tuple = ()) -> dict | None:
    sql = _to_sql(query)
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql, *params)
        return _row_to_dict(row)


async def fetchall(query: str, params: tuple = ()) -> list[dict]:
    sql = _to_sql(query)
    async with _pool.acquire() as conn:
        rows = await conn.fetch(sql, *params)
        return [_row_to_dict(r) for r in rows]


async def execute(query: str, params: tuple = ()) -> None:
    sql = _to_sql(query)
    async with _pool.acquire() as conn:
        await conn.execute(sql, *params)


async def execute_many(queries: list[tuple[str, tuple]]) -> None:
    async with _pool.acquire() as conn:
        async with conn.transaction():
            for query, params in queries:
                sql = _to_sql(query)
                await conn.execute(sql, *params)


# ── Utilities ──────────────────────────────────────────────────────────────────

def new_id() -> str:
    return str(uuid.uuid4())


def now_ms() -> int:
    return int(time.time() * 1000)
