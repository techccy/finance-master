"""SQLite 数据层"""
import os
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "app.db"))

_conn = None


def get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA foreign_keys=ON")
    return _conn


@contextmanager
def db():
    conn = get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise


SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS watchlist (
    user_id INTEGER NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('stock','etf','fund')),
    created_at TEXT DEFAULT (datetime('now','localtime')),
    PRIMARY KEY (user_id, code),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- 股票/ETF 前复权收盘价
CREATE TABLE IF NOT EXISTS kline (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    close REAL NOT NULL,
    PRIMARY KEY (code, date)
);
-- 场外基金复权净值（由累计收益率折算，起始=1）
CREATE TABLE IF NOT EXISTS fund_nav (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    nav REAL NOT NULL,
    PRIMARY KEY (code, date)
);
-- 基金前十大持仓
CREATE TABLE IF NOT EXISTS holdings (
    code TEXT NOT NULL,
    quarter TEXT NOT NULL,
    stock_code TEXT,
    stock_name TEXT NOT NULL,
    ratio REAL NOT NULL,
    PRIMARY KEY (code, quarter, stock_name)
);
-- 股票每日估值（PE-TTM / PB）
CREATE TABLE IF NOT EXISTS valuation (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    pe_ttm REAL,
    pb REAL,
    PRIMARY KEY (code, date)
);
-- 基金同类排名（近三月口径原始名次，越小越靠前）
CREATE TABLE IF NOT EXISTS fund_rank (
    code TEXT NOT NULL,
    date TEXT NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (code, date)
);
-- 全市场基金业绩快照（每日 18:20 刷新；r_* 为区间收益%，rank_*/cnt_* 为同类型内名次/总数）
CREATE TABLE IF NOT EXISTS market_snapshot (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    ftype TEXT NOT NULL,
    r_1d REAL, r_1w REAL, r_1m REAL, r_3m REAL, r_6m REAL,
    r_1y REAL, r_3y REAL, r_ytd REAL,
    rank_1m INTEGER, cnt_1m INTEGER,
    rank_3m INTEGER, cnt_3m INTEGER,
    rank_6m INTEGER, cnt_6m INTEGER,
    rank_1y INTEGER, cnt_1y INTEGER,
    rank_3y INTEGER, cnt_3y INTEGER,
    rank_ytd INTEGER, cnt_ytd INTEGER,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshot_ftype ON market_snapshot(ftype);
-- Agent API token（存 sha256，明文只在创建时返回一次）
CREATE TABLE IF NOT EXISTS api_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
-- 各类数据抓取时间戳 meta：key 如 holdings:110011
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def init_db():
    """建表；若存在旧版单用户 watchlist（无 user_id 列）则重命名留待迁移"""
    with db() as conn:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(watchlist)").fetchall()]
        if cols and "user_id" not in cols:
            conn.execute("DROP TABLE IF EXISTS _watchlist_old")
            conn.execute("ALTER TABLE watchlist RENAME TO _watchlist_old")
        conn.executescript(SCHEMA)


def finalize_migration(admin_id: int):
    """把旧版 watchlist 数据迁移给首个管理员，然后清理旧表"""
    with db() as conn:
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='_watchlist_old'").fetchone()
        if not exists:
            return
        rows = conn.execute("SELECT code,name,type,created_at FROM _watchlist_old").fetchall()
        for r in rows:
            conn.execute("INSERT OR IGNORE INTO watchlist(user_id,code,name,type,created_at) VALUES(?,?,?,?,?)",
                         (admin_id, r["code"], r["name"], r["type"], r["created_at"]))
        conn.execute("DROP TABLE _watchlist_old")
        if rows:
            print(f"[migrate] 已将 {len(rows)} 条旧自选数据迁移给 user#{admin_id}")
