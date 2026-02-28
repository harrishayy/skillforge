"""
Database abstraction layer.

Uses Neon PostgreSQL (asyncpg) when DATABASE_URL is set to a postgres:// URI,
otherwise falls back to local SQLite (aiosqlite) for development.

All query functions accept SQLite-style `?` placeholders — they are
automatically converted to `$1, $2, …` when running on PostgreSQL,
so router/service code never needs to change.
"""
import os
import re
import uuid
import time
import aiosqlite
from pathlib import Path
from typing import Any

# ── Configuration ──────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).parent.parent / "skillforge.db"
_pool = None   # asyncpg pool — set by init_db() when DATABASE_URL is postgres://

# ── Schema ─────────────────────────────────────────────────────────────────────

# Split into individual statements for asyncpg compatibility
_CREATE_STATEMENTS = [
    """CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT,
    mode        TEXT NOT NULL CHECK(mode IN ('software', 'hardware')),
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
    id           TEXT PRIMARY KEY,
    step_id      TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    timestamp_ms BIGINT NOT NULL,
    frame_path   TEXT NOT NULL,
    is_key_frame INTEGER DEFAULT 0,
    created_at   BIGINT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS pipeline_logs (
    id          TEXT PRIMARY KEY,
    workflow_id TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
    stage       TEXT NOT NULL,
    message     TEXT,
    progress    INTEGER DEFAULT 0,
    created_at  BIGINT NOT NULL
)""",
    """CREATE TABLE IF NOT EXISTS subtitles (
    id         TEXT PRIMARY KEY,
    step_id    TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
    start_ms   INTEGER NOT NULL,
    end_ms     INTEGER NOT NULL,
    text       TEXT NOT NULL,
    created_at REAL DEFAULT (strftime('%s', 'now') * 1000)
)""",
    "CREATE INDEX IF NOT EXISTS idx_steps_workflow ON steps(workflow_id, step_number)",
    "CREATE INDEX IF NOT EXISTS idx_annotations_step ON annotations(step_id)",
    "CREATE INDEX IF NOT EXISTS idx_click_targets_step ON click_targets(step_id)",
    "CREATE INDEX IF NOT EXISTS idx_step_frames_step ON step_frames(step_id, timestamp_ms)",
    "CREATE INDEX IF NOT EXISTS idx_pipeline_logs_workflow ON pipeline_logs(workflow_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_subtitles_step ON subtitles(step_id, start_ms)",
]

# Keep for aiosqlite executescript (needs a single string)
CREATE_TABLES_SQL = ";\n".join(_CREATE_STATEMENTS) + ";"


# ── Helpers ────────────────────────────────────────────────────────────────────

def _to_pg(sql: str) -> str:
    """Convert SQLite ? placeholders to PostgreSQL $1, $2, … notation."""
    counter = [0]

    def replace(m):
        counter[0] += 1
        return f"${counter[0]}"

    return re.sub(r"\?", replace, sql)


def _is_postgres() -> bool:
    return _pool is not None


# ── Initialisation ─────────────────────────────────────────────────────────────

async def init_db():
    global _pool
    db_url = os.environ.get("DATABASE_URL", "")

    if db_url.startswith(("postgres://", "postgresql://")):
        try:
            import asyncpg
            _pool = await asyncpg.create_pool(db_url, min_size=2, max_size=10, ssl="require")
            async with _pool.acquire() as conn:
                for stmt in _CREATE_STATEMENTS:
                    await conn.execute(stmt)
                await _run_migrations_pg(conn)
            print("[DB] Connected to Neon PostgreSQL")
        except Exception as e:
            print(f"[DB] PostgreSQL connection failed: {e}. Falling back to SQLite.")
            _pool = None
            await _init_sqlite()
    else:
        await _init_sqlite()


async def _run_migrations_pg(conn):
    """Migrate existing Postgres databases to match the current schema."""
    migrations = [
        "ALTER TABLE steps ADD COLUMN IF NOT EXISTS video_path TEXT",
        "ALTER TABLE workflows ADD COLUMN IF NOT EXISTS published INTEGER DEFAULT 0",
        # INTEGER → BIGINT for millisecond timestamps and durations
        "ALTER TABLE workflows ALTER COLUMN duration_ms TYPE BIGINT",
        "ALTER TABLE workflows ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE workflows ALTER COLUMN updated_at TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN start_ms TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN end_ms TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE steps ALTER COLUMN updated_at TYPE BIGINT",
        "ALTER TABLE annotations ALTER COLUMN created_at TYPE BIGINT",
        "ALTER TABLE pipeline_logs ALTER COLUMN created_at TYPE BIGINT",
    ]
    for sql in migrations:
        try:
            await conn.execute(sql)
        except Exception:
            pass


async def _init_sqlite():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.executescript(CREATE_TABLES_SQL)
        # Safe migration for existing databases
        try:
            await db.execute("ALTER TABLE steps ADD COLUMN video_path TEXT")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE workflows ADD COLUMN published INTEGER DEFAULT 0")
        except Exception:
            pass
        # subtitles table — created via CREATE TABLE IF NOT EXISTS above, no migration needed
        await db.commit()
    print(f"[DB] Using SQLite at {DB_PATH}")


# ── Query helpers ──────────────────────────────────────────────────────────────

async def fetchone(query: str, params: tuple = ()) -> dict | None:
    if _is_postgres():
        async with _pool.acquire() as conn:
            row = await conn.fetchrow(_to_pg(query), *params)
            return dict(row) if row else None
    else:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(query, params) as cursor:
                row = await cursor.fetchone()
                return dict(row) if row else None


async def fetchall(query: str, params: tuple = ()) -> list[dict]:
    if _is_postgres():
        async with _pool.acquire() as conn:
            rows = await conn.fetch(_to_pg(query), *params)
            return [dict(r) for r in rows]
    else:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(query, params) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]


async def execute(query: str, params: tuple = ()) -> None:
    if _is_postgres():
        async with _pool.acquire() as conn:
            await conn.execute(_to_pg(query), *params)
    else:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(query, params)
            await db.commit()


async def execute_many(queries: list[tuple[str, tuple]]) -> None:
    if _is_postgres():
        async with _pool.acquire() as conn:
            async with conn.transaction():
                for query, params in queries:
                    await conn.execute(_to_pg(query), *params)
    else:
        async with aiosqlite.connect(DB_PATH) as db:
            for query, params in queries:
                await db.execute(query, params)
            await db.commit()


# ── Utilities ──────────────────────────────────────────────────────────────────

def new_id() -> str:
    return str(uuid.uuid4())


def now_ms() -> int:
    return int(time.time() * 1000)
