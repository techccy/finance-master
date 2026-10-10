"""基金、股票观测对比平台 - 后端服务"""
import logging
import os
import secrets
import sqlite3
import threading
import time
from datetime import date, datetime, timedelta
from pathlib import Path

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import auth, data_fetch, metrics
from .db import db, finalize_migration, init_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("main")

STALE_DAYS = 4          # 行情/净值超过该天数视为过期
HOLDINGS_TTL_DAYS = 30  # 持仓缓存 30 天
ACCESS_TTL_DAYS = 30    # 非自选标的的访问保定期：超期未访问即清理行情数据

app = FastAPI(title="观测对比平台")
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ---------------- 认证 ----------------

def current_user(request: Request):
    """通用鉴权：优先 Bearer API token（Agent 用），其次 session cookie。token = 本人权限"""
    authz = request.headers.get("authorization", "")
    if authz.lower().startswith("bearer "):
        u = auth.get_api_user(authz[7:].strip())
        if u:
            return u
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME, ""))
    if not user:
        raise HTTPException(401, "未登录")
    return user


def current_user_session(request: Request):
    """仅 session cookie 鉴权：改密码 / token 管理 / 管理员接口不接受 API token"""
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME, ""))
    if not user:
        raise HTTPException(401, "未登录")
    return user


def require_admin(user=Depends(current_user_session)):
    if not user["is_admin"]:
        raise HTTPException(403, "需要管理员权限")
    return user


def _set_session_cookie(resp: Response, token: str):
    resp.set_cookie(auth.COOKIE_NAME, token, max_age=auth.SESSION_TTL_DAYS * 86400,
                    httponly=True, samesite="lax", path="/")


def ensure_admin():
    """首次启动自动创建管理员；环境变量指定密码时每次启动同步；处理旧版 watchlist 迁移"""
    env_user = os.environ.get("ADMIN_USERNAME", "admin")
    env_pw = os.environ.get("ADMIN_PASSWORD")
    with db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE is_admin=1 ORDER BY id LIMIT 1"
        ).fetchone() or conn.execute(
            "SELECT id, username, password_hash FROM users ORDER BY id LIMIT 1"
        ).fetchone()
    if row:
        finalize_migration(row["id"])
        # ADMIN_PASSWORD 已设置时，以环境变量为准同步管理员用户名/密码
        # 注意：这会覆盖管理员在页面上修改过的密码
        if env_pw and (row["username"] != env_user
                       or not auth.verify_password(env_pw, row["password_hash"])):
            with db() as conn:
                conn.execute("UPDATE users SET username=?, password_hash=? WHERE id=?",
                             (env_user, auth.hash_password(env_pw), row["id"]))
            auth.purge_user_sessions(row["id"])
            log.info("已按环境变量同步管理员账号 username=%s", env_user)
        return
    username = env_user
    password = env_pw or secrets.token_urlsafe(10)
    with db() as conn:
        cur = conn.execute("INSERT INTO users(username,password_hash,is_admin) VALUES(?,?,1)",
                           (username, auth.hash_password(password)))
        uid = cur.lastrowid
    finalize_migration(uid)
    if os.environ.get("ADMIN_PASSWORD"):
        log.info("已创建管理员账号 username=%s", username)
    else:
        log.warning("首次启动已创建管理员 username=%s password=%s （随机密码，请登录后修改）", username, password)


# ---------------- 工具 ----------------

def touch(code: str):
    """记录标的最近访问日期（刷新自选池同步时也会刷新，非自选标的凭此续期免清理）"""
    try:
        with db() as conn:
            conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)",
                         (f"access:{code}", date.today().isoformat()))
    except Exception:
        pass


def _stale(table: str, code: str) -> bool:
    """该标的数据缺失或超过 STALE_DAYS"""
    with db() as conn:
        last = _max_date(conn, table, code)
    return not last or last < (date.today() - timedelta(days=STALE_DAYS)).isoformat()


def _ensure_synced(code: str, itype: str):
    """按需补数据（详情/估值/排名对任意标的开放后的入口），失败不抛出"""
    try:
        sync_instrument(code, itype)
    except Exception as e:
        log.warning("ensure_synced %s(%s) 失败: %s", code, itype, e)


def _meta_get(key: str) -> str | None:
    with db() as conn:
        row = conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None


def _meta_set(key: str, value: str):
    with db() as conn:
        conn.execute("INSERT OR REPLACE INTO meta(key,value) VALUES(?,?)", (key, value))


def _max_date(conn, table: str, code: str) -> str | None:
    row = conn.execute(f"SELECT MAX(date) AS m FROM {table} WHERE code=?", (code,)).fetchone()
    return row["m"] if row and row["m"] else None


def _upsert_many(conn, sql: str, rows: list[tuple]):
    conn.executemany(sql, rows)


# ---------------- 数据同步 ----------------

def sync_instrument(code: str, itype: str, force: bool = False):
    """同步单个标的的所有数据，接口失败只记日志"""
    touch(code)  # 有数据同步即视为活跃，免于孤儿清理
    now = datetime.now().strftime("%Y-%m-%d")
    with db() as conn:
        if itype in ("stock", "etf"):
            last = _max_date(conn, "kline", code)
            if not force and last and last >= (date.today() - timedelta(days=STALE_DAYS)).isoformat():
                return
        else:
            last = _max_date(conn, "fund_nav", code)
            if not force and last and last >= (date.today() - timedelta(days=STALE_DAYS)).isoformat():
                return

    # 行情 / 净值
    try:
        if itype in ("stock", "etf"):
            rows = data_fetch.fetch_kline(code, itype)
            with db() as conn:
                _upsert_many(conn, "INSERT OR REPLACE INTO kline(code,date,close) VALUES(?,?,?)", [(code, d, c) for d, c in rows])
        else:
            rows = data_fetch.fetch_fund_nav(code)
            with db() as conn:
                _upsert_many(conn, "INSERT OR REPLACE INTO fund_nav(code,date,nav) VALUES(?,?,?)", [(code, d, v) for d, v in rows])
        log.info("sync %s(%s) 行情/净值 %d 条", code, itype, len(rows))
    except Exception as e:
        log.warning("sync %s 行情/净值失败: %s", code, e)

    if itype == "stock":
        # 估值
        fetched = _meta_get(f"valuation:{code}")
        if force or not fetched or (datetime.now() - datetime.fromisoformat(fetched)).days >= STALE_DAYS:
            try:
                rows = data_fetch.fetch_valuation(code)
                with db() as conn:
                    _upsert_many(conn, "INSERT OR REPLACE INTO valuation(code,date,pe_ttm,pb) VALUES(?,?,?,?)",
                                 [(code, d, pe, pb) for d, pe, pb in rows])
                _meta_set(f"valuation:{code}", now)
                log.info("sync %s 估值 %d 条", code, len(rows))
            except Exception as e:
                log.warning("sync %s 估值失败: %s", code, e)

    if itype == "fund":
        # 持仓
        fetched = _meta_get(f"holdings:{code}")
        if force or not fetched or (datetime.now() - datetime.fromisoformat(fetched)).days >= HOLDINGS_TTL_DAYS:
            try:
                quarters = data_fetch.fetch_holdings(code)
                with db() as conn:
                    for q, items in quarters.items():
                        _upsert_many(conn, "INSERT OR REPLACE INTO holdings(code,quarter,stock_code,stock_name,ratio) VALUES(?,?,?,?,?)",
                                     [(code, q, i["code"], i["name"], i["ratio"]) for i in items])
                _meta_set(f"holdings:{code}", now)
                log.info("sync %s 持仓 %d 个季度", code, len(quarters))
            except Exception as e:
                log.warning("sync %s 持仓失败: %s", code, e)
        # 同类排名
        fetched = _meta_get(f"rank:{code}")
        if force or not fetched or (datetime.now() - datetime.fromisoformat(fetched)).days >= STALE_DAYS:
            try:
                rows = data_fetch.fetch_fund_rank(code)
                with db() as conn:
                    _upsert_many(conn, "INSERT OR REPLACE INTO fund_rank(code,date,rank) VALUES(?,?,?)", [(code, d, r) for d, r in rows])
                _meta_set(f"rank:{code}", now)
                log.info("sync %s 排名 %d 条", code, len(rows))
            except Exception as e:
                log.warning("sync %s 排名失败: %s", code, e)


def refresh_all(force: bool = False):
    with db() as conn:
        items = conn.execute("SELECT DISTINCT code,type FROM watchlist").fetchall()
    for it in items:
        sync_instrument(it["code"], it["type"], force=force)
    log.info("refresh_all 完成 (%d 个标的)", len(items))


def _bg_refresh(force: bool = False):
    threading.Thread(target=refresh_all, kwargs={"force": force}, daemon=True).start()


# ---------------- API：认证 ----------------

class LoginItem(BaseModel):
    username: str
    password: str


class PasswordItem(BaseModel):
    old_password: str
    new_password: str


@app.post("/api/login")
def api_login(item: LoginItem, resp: Response):
    with db() as conn:
        row = conn.execute("SELECT id,password_hash FROM users WHERE username=?",
                           (item.username.strip(),)).fetchone()
    if not row or not auth.verify_password(item.password, row["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    token = auth.create_session(row["id"])
    _set_session_cookie(resp, token)
    return {"ok": True}


@app.post("/api/logout")
def api_logout(request: Request, resp: Response):
    token = request.cookies.get(auth.COOKIE_NAME, "")
    if token:
        auth.delete_session(token)
    resp.delete_cookie(auth.COOKIE_NAME, path="/")
    return {"ok": True}


@app.get("/api/me")
def api_me(request: Request):
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME, ""))
    return {"user": user}


@app.post("/api/me/password")
def api_change_password(item: PasswordItem, user=Depends(current_user_session)):
    if len(item.new_password) < 4:
        raise HTTPException(400, "新密码至少 4 位")
    with db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if not row or not auth.verify_password(item.old_password, row["password_hash"]):
            raise HTTPException(400, "原密码错误")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?",
                     (auth.hash_password(item.new_password), user["id"]))
    return {"ok": True}


# ---------------- API：Agent token 管理（仅 session，不接受 token 调用） ----------------

@app.get("/api/me/token")
def api_token_info(user=Depends(current_user_session)):
    return auth.get_api_token_info(user["id"])


@app.post("/api/me/token")
def api_token_create(user=Depends(current_user_session)):
    """生成新 token（旧 token 立即失效），明文只在本次响应返回"""
    return {"token": auth.create_api_token(user["id"])}


# ---------------- API：账号管理（仅管理员） ----------------

class AdminUserCreate(BaseModel):
    username: str
    password: str


class AdminPasswordReset(BaseModel):
    new_password: str


@app.get("/api/admin/users")
def api_admin_users(user=Depends(require_admin)):
    with db() as conn:
        rows = conn.execute(
            "SELECT u.id, u.username, u.is_admin, u.created_at, "
            "(SELECT COUNT(*) FROM watchlist w WHERE w.user_id=u.id) AS watch_count "
            "FROM users u ORDER BY u.id").fetchall()
    return [dict(r) for r in rows]


@app.post("/api/admin/users")
def api_admin_create(item: AdminUserCreate, user=Depends(require_admin)):
    username = item.username.strip()
    if not username:
        raise HTTPException(400, "用户名不能为空")
    if len(item.password) < 4:
        raise HTTPException(400, "密码至少 4 位")
    try:
        with db() as conn:
            conn.execute("INSERT INTO users(username,password_hash,is_admin) VALUES(?,?,0)",
                         (username, auth.hash_password(item.password)))
    except sqlite3.IntegrityError:
        raise HTTPException(400, "用户名已存在")
    return {"ok": True}


@app.post("/api/admin/users/{uid}/password")
def api_admin_reset(uid: int, item: AdminPasswordReset, user=Depends(require_admin)):
    if len(item.new_password) < 4:
        raise HTTPException(400, "密码至少 4 位")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "用户不存在")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?",
                     (auth.hash_password(item.new_password), uid))
    auth.purge_user_sessions(uid)  # 重置密码后强制重新登录
    return {"ok": True}


@app.delete("/api/admin/users/{uid}")
def api_admin_delete(uid: int, user=Depends(require_admin)):
    if uid == user["id"]:
        raise HTTPException(400, "不能删除自己")
    with db() as conn:
        if not conn.execute("SELECT 1 FROM users WHERE id=?", (uid,)).fetchone():
            raise HTTPException(404, "用户不存在")
        codes = [r["code"] for r in conn.execute("SELECT code FROM watchlist WHERE user_id=?", (uid,)).fetchall()]
        conn.execute("DELETE FROM users WHERE id=?", (uid,))  # FK 级联删自选与 session
    _purge_if_orphaned(codes)
    return {"ok": True}


# ---------------- API：自选 ----------------

class WatchItem(BaseModel):
    code: str
    name: str
    type: str  # stock / etf / fund


_DATA_TABLES = {"stock": ["kline", "valuation"], "etf": ["kline"], "fund": ["fund_nav", "holdings", "fund_rank"]}


def _purge_if_orphaned(codes: list[str]):
    """数据清理：仅当既无任何用户自选、又超过保定期未访问时才删除"""
    if not codes:
        return
    cutoff = (date.today() - timedelta(days=ACCESS_TTL_DAYS)).isoformat()
    with db() as conn:
        types = dict(conn.execute("SELECT DISTINCT code,type FROM watchlist WHERE code IN (%s)"
                                  % ",".join("?" * len(codes)), codes).fetchall())
        for c in codes:
            if c in types:
                continue
            row = conn.execute("SELECT value FROM meta WHERE key=?", (f"access:{c}",)).fetchone()
            if row and row["value"] >= cutoff:
                continue
            itype = types.get(c) or _infer_type(conn, c)
            for t in _DATA_TABLES.get(itype, _DATA_TABLES["stock"] + _DATA_TABLES["etf"] + _DATA_TABLES["fund"]):
                conn.execute(f"DELETE FROM {t} WHERE code=?", (c,))
            for key in (f"access:{c}", f"valuation:{c}", f"holdings:{c}", f"rank:{c}", f"bench:{c}"):
                conn.execute("DELETE FROM meta WHERE key=?", (key,))


def _infer_type(conn, code: str) -> str:
    """按残留数据推断标的类型，用于清理"""
    if conn.execute("SELECT 1 FROM fund_nav WHERE code=? LIMIT 1", (code,)).fetchone():
        return "fund"
    if conn.execute("SELECT 1 FROM valuation WHERE code=? LIMIT 1", (code,)).fetchone():
        return "stock"
    return "etf"


def purge_stale_orphans(days: int = ACCESS_TTL_DAYS):
    """每日任务：全库扫描，清理无自选且超期未访问的标的数据"""
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    with db() as conn:
        watched = {r["code"] for r in conn.execute("SELECT DISTINCT code FROM watchlist")}
        codes = set()
        for t in ("kline", "fund_nav"):
            codes |= {r["code"] for r in conn.execute(f"SELECT DISTINCT code FROM {t}")}
    orphans = []
    for c in codes:
        if c in watched:
            continue
        with db() as conn:
            row = conn.execute("SELECT value FROM meta WHERE key=?", (f"access:{c}",)).fetchone()
        if not row or row["value"] < cutoff:
            orphans.append(c)
    if orphans:
        _purge_if_orphaned(orphans)
        log.info("孤儿清理完成：%d 个标的（%s…）", len(orphans), ", ".join(orphans[:5]))


@app.get("/api/watchlist")
def api_watchlist(user=Depends(current_user)):
    with db() as conn:
        rows = conn.execute("SELECT code,name,type FROM watchlist WHERE user_id=? ORDER BY created_at",
                            (user["id"],)).fetchall()
        out = []
        for r in rows:
            if r["type"] == "fund":
                table, col = "fund_nav", "nav"
            else:
                table, col = "kline", "close"
            last = _max_date(conn, table, r["code"])
            val = conn.execute(f"SELECT {col} AS v FROM {table} WHERE code=? AND date=?",
                               (r["code"], last)).fetchone() if last else None
            out.append({"code": r["code"], "name": r["name"], "type": r["type"],
                        "last_date": last, "last_value": val["v"] if val else None})
        return out


@app.get("/api/search")
def api_search(q: str):
    if not q.strip():
        return []
    try:
        return data_fetch.search(q.strip())
    except Exception as e:
        raise HTTPException(502, f"搜索失败: {e}")


@app.get("/api/quote")
def api_quote(codes: str, types: str, user=Depends(current_user)):
    """搜索结果批量实时行情（不写入数据库）"""
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    type_list = [t.strip() for t in types.split(",") if t.strip()]
    if not code_list or len(code_list) != len(type_list):
        raise HTTPException(400, "codes/types 数量不匹配")
    if len(code_list) > 20:
        raise HTTPException(400, "一次最多 20 个标的")
    if any(t not in ("stock", "etf", "fund") for t in type_list):
        raise HTTPException(400, "type 必须是 stock/etf/fund")
    try:
        return data_fetch.fetch_quotes([{"code": c, "type": t} for c, t in zip(code_list, type_list)])
    except Exception as e:
        raise HTTPException(502, f"行情获取失败: {e}")


@app.get("/api/preview")
def api_preview(code: str, type: str, user=Depends(current_user)):
    """搜索预览：单标的近半年净值/价格曲线（不入库）"""
    if type not in ("stock", "etf", "fund"):
        raise HTTPException(400, "type 必须是 stock/etf/fund")
    try:
        pts = data_fetch.fetch_preview(code.strip(), type)
    except Exception as e:
        raise HTTPException(502, f"曲线获取失败: {e}")
    if not pts:
        raise HTTPException(404, f"{code} 无历史数据")
    return {"code": code, "type": type, "points": [[d, v] for d, v in pts]}


@app.post("/api/watchlist")
def api_watchlist_add(item: WatchItem, user=Depends(current_user)):
    if item.type not in ("stock", "etf", "fund"):
        raise HTTPException(400, "type 必须是 stock/etf/fund")
    with db() as conn:
        conn.execute("INSERT OR IGNORE INTO watchlist(user_id,code,name,type) VALUES(?,?,?,?)",
                     (user["id"], item.code, item.name, item.type))
    _bg_refresh()  # 后台补数据，不阻塞
    return {"ok": True}


@app.delete("/api/watchlist/{code}")
def api_watchlist_del(code: str, confirm: bool = False, user=Depends(current_user)):
    if not confirm:
        raise HTTPException(400, "删除自选需携带 confirm=true（防误操作）")
    with db() as conn:
        row = conn.execute("SELECT type FROM watchlist WHERE user_id=? AND code=?",
                           (user["id"], code)).fetchone()
        if not row:
            raise HTTPException(404, "自选中不存在该标的")
        conn.execute("DELETE FROM watchlist WHERE user_id=? AND code=?", (user["id"], code))
    _purge_if_orphaned([code])
    return {"ok": True}


def _series_of(conn, code: str, itype: str) -> list[tuple[str, float]]:
    if itype == "fund":
        rows = conn.execute("SELECT date,nav FROM fund_nav WHERE code=? ORDER BY date", (code,)).fetchall()
        return [(r["date"], r["nav"]) for r in rows]
    rows = conn.execute("SELECT date,close FROM kline WHERE code=? ORDER BY date", (code,)).fetchall()
    return [(r["date"], r["close"]) for r in rows]


@app.get("/api/compare")
def api_compare(codes: str, start: str | None = None, end: str | None = None,
                user=Depends(current_user)):
    """归一化对比：全部以区间起点(前一交易日)为基准 0%"""
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if not code_list:
        raise HTTPException(400, "codes 不能为空")
    if not end:
        end = date.today().isoformat()
    if not start:
        start = (date.today() - timedelta(days=365)).isoformat()

    with db() as conn:
        names = {r["code"]: (r["name"], r["type"]) for r in
                 conn.execute("SELECT code,name,type FROM watchlist WHERE user_id=?",
                              (user["id"],)).fetchall()}
        for c in code_list:
            if c not in names:
                raise HTTPException(403, f"{c} 不在你的自选中，请先添加")
        raw = {}
        for c in code_list:
            itype = names[c][1]
            pts = _series_of(conn, c, itype)
            if not pts:
                raise HTTPException(404, f"{c} 无数据，请稍等后台同步完成后再试")
            raw[c] = (itype, pts)

    rebased, spans = {}, {}
    for c, (itype, pts) in raw.items():
        seg, span = metrics.rebase(pts, start, end)
        if not seg:
            raise HTTPException(404, f"{c} 在区间 [{start}, {end}] 无数据")
        rebased[c] = seg
        spans[c] = span

    # 对齐：日期并集 + 前向填充
    all_dates = sorted({d for seg in rebased.values() for d, _ in seg})
    series = []
    mets = []
    for c, seg in rebased.items():
        name, itype = names.get(c, (c, "stock"))
        m = dict(seg)
        last, pts_out = None, []
        for d in all_dates:
            if d in m:
                last = m[d]
            pts_out.append([d, round((last - 1) * 100, 3) if last is not None else None])
        series.append({"code": c, "name": name, "type": itype, "points": pts_out})
        nav = [v for _, v in seg]
        mets.append({"code": c, "name": name, "type": itype, **metrics.metrics(nav, spans[c])})
    return {"start": start, "end": end, "dates": all_dates, "series": series, "metrics": mets}


def _percentile(values: list[float], cur: float) -> float | None:
    vals = [v for v in values if v is not None]
    if not vals or cur is None:
        return None
    return round(sum(1 for v in vals if v <= cur) / len(vals) * 100, 1)


def _valuation_payload(code: str) -> dict:
    with db() as conn:
        rows = conn.execute("SELECT date,pe_ttm,pb FROM valuation WHERE code=? ORDER BY date", (code,)).fetchall()
    if not rows:
        sync_instrument(code, "stock", force=True)
        with db() as conn:
            rows = conn.execute("SELECT date,pe_ttm,pb FROM valuation WHERE code=? ORDER BY date", (code,)).fetchall()
    if not rows:
        raise HTTPException(404, f"{code} 无估值数据")
    last = rows[-1]
    pe_hist = [r["pe_ttm"] for r in rows]
    pb_hist = [r["pb"] for r in rows]
    return {
        "code": code, "date": last["date"],
        "pe_ttm": last["pe_ttm"], "pe_percentile": _percentile(pe_hist, last["pe_ttm"]),
        "pb": last["pb"], "pb_percentile": _percentile(pb_hist, last["pb"]),
        "n_years": round(len(rows) / 244, 1),
    }


@app.get("/api/valuation")
def api_valuation(code: str, user=Depends(current_user)):
    touch(code)
    return _valuation_payload(code)


@app.get("/api/fund_rank")
def api_fund_rank(code: str, user=Depends(current_user)):
    touch(code)
    with db() as conn:
        rows = conn.execute("SELECT date,rank FROM fund_rank WHERE code=? ORDER BY date", (code,)).fetchall()
    if not rows:
        _ensure_synced(code, "fund")
        with db() as conn:
            rows = conn.execute("SELECT date,rank FROM fund_rank WHERE code=? ORDER BY date", (code,)).fetchall()
    if not rows:
        raise HTTPException(404, f"{code} 无排名数据")
    last = rows[-1]
    return {"code": code, "date": last["date"], "rank": last["rank"],
            "trend": [[r["date"], r["rank"]] for r in rows[-250:]]}


# ---------------- API：详情页 ----------------

def _ensure_index_kline(sym: str):
    """基准指数日K按需入库（存 kline 表，code=腾讯指数代码，如 sh000300）"""
    if not _stale("kline", sym):
        return
    rows = data_fetch.fetch_kline(sym, "etf", sym=sym)
    with db() as conn:
        _upsert_many(conn, "INSERT OR REPLACE INTO kline(code,date,close) VALUES(?,?,?)",
                     [(sym, d, c) for d, c in rows])
    log.info("sync 指数 %s %d 条", sym, len(rows))


def _disp_name(conn, code: str, type: str, fallback: str | None) -> str:
    """展示名：入参 > 自选 > 全市场快照 > 代码"""
    if fallback:
        return fallback
    r = conn.execute("SELECT name FROM watchlist WHERE code=? LIMIT 1", (code,)).fetchone()
    if r:
        return r["name"]
    r = conn.execute("SELECT name FROM market_snapshot WHERE code=?", (code,)).fetchone()
    return r["name"] if r else code


_RANK_PERIODS = [("1m", "近1月"), ("3m", "近3月"), ("6m", "近6月"),
                 ("1y", "近1年"), ("3y", "近3年"), ("ytd", "今年来")]


@app.get("/api/detail")
def api_detail(code: str, type: str, name: str | None = None,
               start: str | None = None, end: str | None = None,
               user=Depends(current_user)):
    """单标的详情：归一化曲线 + 纯指数业绩基准（基金）+ 指标卡"""
    if type not in ("stock", "etf", "fund"):
        raise HTTPException(400, "type 必须是 stock/etf/fund")
    end = end or date.today().isoformat()
    start = start or (date.today() - timedelta(days=365)).isoformat()
    touch(code)
    _ensure_synced(code, type)

    with db() as conn:
        pts = _series_of(conn, code, type)
        disp = _disp_name(conn, code, type, name)
    if not pts:
        raise HTTPException(404, f"{code} 暂无历史数据（同步失败或代码无效）")
    seg, span = metrics.rebase(pts, start, end)
    if not seg:
        raise HTTPException(404, f"{code} 在区间 [{start}, {end}] 无数据")

    points = [[d, round((v - 1) * 100, 3)] for d, v in seg]
    out = {"code": code, "name": disp, "type": type, "start": start, "end": end,
           "dates": [d for d, _ in seg], "series": points,
           "metrics": metrics.metrics([v for _, v in seg], span)}
    try:
        out["quote"] = data_fetch.fetch_quotes([{"code": code, "type": type}]).get(code)
    except Exception:
        out["quote"] = None

    # 业绩基准：仅基金，纯指数口径
    out["benchmark"] = None
    out["excess"] = None
    if type == "fund":
        rb = data_fetch.resolve_benchmark(code)
        if rb:
            sym, bname = rb
            try:
                _ensure_index_kline(sym)
                with db() as conn:
                    bpts = [(r["date"], r["close"]) for r in conn.execute(
                        "SELECT date,close FROM kline WHERE code=? ORDER BY date", (sym,))]
                bseg, _ = metrics.rebase(bpts, start, end)
                if bseg:
                    bm = dict(bseg)
                    last, bpoints = None, []
                    for d in out["dates"]:
                        if d in bm:
                            last = bm[d]
                        bpoints.append([d, round((last - 1) * 100, 3) if last is not None else None])
                    out["benchmark"] = {"name": bname, "series": bpoints}
                    if bpoints[-1][1] is not None:
                        out["excess"] = round(points[-1][1] - bpoints[-1][1], 2)
            except Exception as e:
                log.warning("detail %s 基准曲线失败: %s", code, e)

    # 基金：多周期同类排名（全市场快照口径）+ 近3月名次走势
    out["rank"] = out["rank_trend"] = None
    if type == "fund":
        with db() as conn:
            s = conn.execute("SELECT * FROM market_snapshot WHERE code=?", (code,)).fetchone()
        if s:
            out["rank"] = {"ftype": s["ftype"], "updated": s["updated_at"], "periods": [{
                "key": p, "label": lb, "ret": s[f"r_{p}"],
                "rank": s[f"rank_{p}"], "cnt": s[f"cnt_{p}"],
                "pct": round(s[f"rank_{p}"] * 100 / s[f"cnt_{p}"], 1)
                       if s[f"rank_{p}"] and s[f"cnt_{p}"] else None,
            } for p, lb in _RANK_PERIODS]}
        try:
            out["rank_trend"] = api_fund_rank(code=code, user=user)
        except HTTPException:
            out["rank_trend"] = None

    # 股票：估值分位
    out["valuation"] = None
    if type == "stock":
        try:
            out["valuation"] = _valuation_payload(code)
        except HTTPException:
            out["valuation"] = None
    return out


# ---------------- API：自选池排行榜 ----------------

@app.get("/api/leaderboard")
def api_leaderboard(start: str | None = None, end: str | None = None,
                    user=Depends(current_user)):
    """自选池内按区间收益排名（任意类型标的），附最大回撤"""
    end = end or date.today().isoformat()
    start = start or (date.today() - timedelta(days=365)).isoformat()
    with db() as conn:
        items = conn.execute("SELECT code,name,type FROM watchlist WHERE user_id=? ORDER BY created_at",
                             (user["id"],)).fetchall()
    rows = []
    for it in items:
        touch(it["code"])
        with db() as conn:
            pts = _series_of(conn, it["code"], it["type"])
        if not pts:
            _ensure_synced(it["code"], it["type"])
            with db() as conn:
                pts = _series_of(conn, it["code"], it["type"])
        if not pts:
            rows.append({"code": it["code"], "name": it["name"], "type": it["type"],
                         "total_return": None, "max_drawdown": None, "stale": True})
            continue
        seg, span = metrics.rebase(pts, start, end)
        if not seg:
            rows.append({"code": it["code"], "name": it["name"], "type": it["type"],
                         "total_return": None, "max_drawdown": None, "stale": True})
            continue
        m = metrics.metrics([v for _, v in seg], span)
        rows.append({"code": it["code"], "name": it["name"], "type": it["type"],
                     "total_return": m["total_return"], "max_drawdown": m["max_drawdown"],
                     "stale": False})
    rows.sort(key=lambda r: (r["total_return"] is None, -(r["total_return"] or 0)))
    return {"start": start, "end": end, "items": rows}


# ---------------- API：基金超市 ----------------

_MARKET_SORTS = ("r_1d", "r_1w", "r_1m", "r_3m", "r_6m", "r_1y", "r_3y", "r_ytd")
_MARKET_PERIODS = ("1m", "3m", "6m", "1y", "3y", "ytd")


@app.get("/api/market")
def api_market(fgroup: str | None = None, q: str | None = None, period: str = "1y",
               sort: str | None = None, order: str = "desc",
               min_ret: float | None = None, max_ret: float | None = None,
               pct_max: float | None = None, pct_min: float | None = None,
               page: int = 1, page_size: int = 20, user=Depends(current_user)):
    """基金超市：全市场快照筛选（类型/收益区间/同类排名百分位/搜索/排序）"""
    period = period if period in _MARKET_PERIODS else "1y"
    rcol, kcol, ccol = f"r_{period}", f"rank_{period}", f"cnt_{period}"
    sort = sort if sort in _MARKET_SORTS else rcol
    order = "ASC" if order.lower() == "asc" else "DESC"

    conds, params = [], []
    if fgroup and fgroup.strip():
        conds.append("ftype LIKE ?")
        params.append(f"{fgroup.strip()}%")
    if q and q.strip():
        conds.append("(name LIKE ? OR code LIKE ?)")
        params += [f"%{q.strip()}%", f"{q.strip()}%"]
    if min_ret is not None:
        conds.append(f"{rcol} >= ?")
        params.append(min_ret)
    if max_ret is not None:
        conds.append(f"{rcol} <= ?")
        params.append(max_ret)
    if pct_min is not None:
        conds.append(f"({ccol} > 0 AND {kcol} * 100.0 / {ccol} >= ?)")
        params.append(pct_min)
    if pct_max is not None:
        conds.append(f"({ccol} > 0 AND {kcol} * 100.0 / {ccol} <= ?)")
        params.append(pct_max)
    where = ("WHERE " + " AND ".join(conds)) if conds else ""
    page = max(1, page)
    page_size = min(100, max(5, page_size))

    with db() as conn:
        total = conn.execute(f"SELECT COUNT(*) AS n FROM market_snapshot {where}", params).fetchone()["n"]
        rows = conn.execute(
            f"SELECT code,name,ftype,{rcol} AS period_ret,{kcol} AS rank_n,{ccol} AS cnt_n "
            f"FROM market_snapshot {where} "
            f"ORDER BY {sort} IS NULL, {sort} {order}, code LIMIT ? OFFSET ?",
            params + [page_size, (page - 1) * page_size]).fetchall()
        u = conn.execute("SELECT MAX(updated_at) AS m FROM market_snapshot").fetchone()
    return {"total": total, "page": page, "page_size": page_size, "updated": u["m"],
            "items": [{"code": r["code"], "name": r["name"], "ftype": r["ftype"],
                       "ret": r["period_ret"], "rank": r["rank_n"], "cnt": r["cnt_n"],
                       "pct": round(r["rank_n"] * 100 / r["cnt_n"], 1)
                              if r["rank_n"] and r["cnt_n"] else None} for r in rows]}


def refresh_market():
    """全市场基金业绩快照日更（东财排行接口 2 万条，同类型内自算名次）"""
    try:
        rows = data_fetch.fetch_market_snapshot()
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        with db() as conn:
            conn.execute("DELETE FROM market_snapshot")
            conn.executemany(
                "INSERT OR REPLACE INTO market_snapshot(code,name,ftype,r_1d,r_1w,r_1m,r_3m,r_6m,"
                "r_1y,r_3y,r_ytd,rank_1m,cnt_1m,rank_3m,cnt_3m,rank_6m,cnt_6m,rank_1y,cnt_1y,"
                "rank_3y,cnt_3y,rank_ytd,cnt_ytd,updated_at) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                [(r["code"], r["name"], r["ftype"], r["r_1d"], r["r_1w"], r["r_1m"], r["r_3m"],
                  r["r_6m"], r["r_1y"], r["r_3y"], r["r_ytd"],
                  r["rank_1m"], r["cnt_1m"], r["rank_3m"], r["cnt_3m"], r["rank_6m"], r["cnt_6m"],
                  r["rank_1y"], r["cnt_1y"], r["rank_3y"], r["cnt_3y"], r["rank_ytd"], r["cnt_ytd"],
                  now) for r in rows])
        log.info("全市场快照已刷新：%d 条", len(rows))
    except Exception as e:
        log.warning("全市场快照刷新失败: %s", e)


@app.get("/api/overlap")
def api_overlap(codes: str, user=Depends(current_user)):
    """多只基金前十大持仓重叠度：两只共同持有部分取较小权重求和"""
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if len(code_list) < 2:
        raise HTTPException(400, "至少需要 2 只基金")
    with db() as conn:
        for c in code_list:
            touch(c)
        names = {r["code"]: r["name"] for r in
                 conn.execute("SELECT code,name FROM watchlist WHERE user_id=?",
                              (user["id"],)).fetchall()}
        funds = []
        for c in code_list:
            qs = [r["quarter"] for r in conn.execute(
                "SELECT DISTINCT quarter FROM holdings WHERE code=? ORDER BY quarter DESC", (c,)).fetchall()]
            if not qs:
                _ensure_synced(c, "fund")
                qs = [r["quarter"] for r in conn.execute(
                    "SELECT DISTINCT quarter FROM holdings WHERE code=? ORDER BY quarter DESC", (c,)).fetchall()]
            if not qs:
                raise HTTPException(404, f"{c} 无持仓数据，可能未同步完成或非权益基金")
            latest = qs[0]
            rows = conn.execute(
                "SELECT stock_name,ratio FROM holdings WHERE code=? AND quarter=? ORDER BY ratio DESC",
                (c, latest)).fetchall()
            funds.append({"code": c, "name": names.get(c, c), "quarter": latest,
                          "holdings": [{"name": r["stock_name"], "ratio": r["ratio"]} for r in rows]})

    pairs = []
    for i in range(len(funds)):
        for j in range(i + 1, len(funds)):
            a, b = funds[i], funds[j]
            # 季度不同则以较旧一期的口径为准（可比较性优先）
            qa, qb = a["quarter"], b["quarter"]
            common_names = {h["name"] for h in a["holdings"]} & {h["name"] for h in b["holdings"]}
            ma = {h["name"]: h["ratio"] for h in a["holdings"]}
            mb = {h["name"]: h["ratio"] for h in b["holdings"]}
            common = [{"name": n, "a": ma[n], "b": mb[n]} for n in sorted(common_names, key=lambda n: -min(ma[n], mb[n]))]
            overlap = round(sum(min(ma[n], mb[n]) for n in common_names), 2)
            pairs.append({"a": a["code"], "b": b["code"], "a_name": a["name"], "b_name": b["name"],
                          "quarters": f"{qa} / {qb}", "overlap": overlap, "common": common})
    return {"funds": funds, "pairs": pairs}


@app.post("/api/refresh")
def api_refresh(user=Depends(require_admin)):
    _bg_refresh(force=True)
    return {"ok": True, "msg": "已触发后台强制刷新"}


# ---------------- 启动 ----------------

@app.on_event("startup")
def startup():
    init_db()
    ensure_admin()
    auth.purge_expired_sessions()
    sched = BackgroundScheduler(timezone="Asia/Shanghai")
    sched.add_job(lambda: _bg_refresh(force=False), CronTrigger(day_of_week="mon-fri", hour=18, minute=10))
    sched.add_job(refresh_market, CronTrigger(day_of_week="mon-fri", hour=18, minute=25))
    sched.add_job(purge_stale_orphans, CronTrigger(hour=4, minute=30))
    sched.start()
    _bg_refresh()
    # 全市场快照为空时后台补一次（首次部署/换库）
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) AS n FROM market_snapshot").fetchone()["n"]
    if n == 0:
        threading.Thread(target=refresh_market, daemon=True).start()
    log.info("启动完成，已触发首次数据同步")


# 给 Agent 读的接口文档（无需登录）
_AGENT_DOC = Path(__file__).resolve().parent / "agent.md"


@app.get("/agent.md", include_in_schema=False)
def agent_doc():
    return FileResponse(_AGENT_DOC, media_type="text/markdown; charset=utf-8")


# 静态托管前端构建产物
_DIST = Path(__file__).resolve().parent.parent / "static"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(_DIST / "index.html")
