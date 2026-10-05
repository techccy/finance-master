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

app = FastAPI(title="观测对比平台")
_cors_origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=_cors_origins, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])


# ---------------- 认证 ----------------

def current_user(request: Request):
    user = auth.get_session_user(request.cookies.get(auth.COOKIE_NAME, ""))
    if not user:
        raise HTTPException(401, "未登录")
    return user


def require_admin(user=Depends(current_user)):
    if not user["is_admin"]:
        raise HTTPException(403, "需要管理员权限")
    return user


def _set_session_cookie(resp: Response, token: str):
    resp.set_cookie(auth.COOKIE_NAME, token, max_age=auth.SESSION_TTL_DAYS * 86400,
                    httponly=True, samesite="lax", path="/")


def ensure_admin():
    """首次启动自动创建管理员；处理旧版 watchlist 迁移"""
    with db() as conn:
        row = conn.execute("SELECT id FROM users ORDER BY id LIMIT 1").fetchone()
    if row:
        finalize_migration(row["id"])
        return
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD") or secrets.token_urlsafe(10)
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
def api_change_password(item: PasswordItem, user=Depends(current_user)):
    if len(item.new_password) < 4:
        raise HTTPException(400, "新密码至少 4 位")
    with db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()
        if not row or not auth.verify_password(item.old_password, row["password_hash"]):
            raise HTTPException(400, "原密码错误")
        conn.execute("UPDATE users SET password_hash=? WHERE id=?",
                     (auth.hash_password(item.new_password), user["id"]))
    return {"ok": True}


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
    """仅当没有任何用户再看这些标的时，才清理行情数据"""
    if not codes:
        return
    with db() as conn:
        types = dict(conn.execute("SELECT DISTINCT code,type FROM watchlist WHERE code IN (%s)"
                                  % ",".join("?" * len(codes)), codes).fetchall())
        orphans = [c for c in codes if c not in types]
        for c in orphans:
            for t in _DATA_TABLES.get(types.get(c, ""), _DATA_TABLES["stock"] + _DATA_TABLES["etf"] + _DATA_TABLES["fund"]):
                conn.execute(f"DELETE FROM {t} WHERE code=?", (c,))


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
def api_watchlist_del(code: str, user=Depends(current_user)):
    with db() as conn:
        row = conn.execute("SELECT type FROM watchlist WHERE user_id=? AND code=?",
                           (user["id"], code)).fetchone()
        if not row:
            raise HTTPException(404, "自选中不存在该标的")
        conn.execute("DELETE FROM watchlist WHERE user_id=? AND code=?", (user["id"], code))
    _purge_if_orphaned([code])
    return {"ok": True}


def _require_watched(conn, user, code: str):
    if not conn.execute("SELECT 1 FROM watchlist WHERE user_id=? AND code=?",
                        (user["id"], code)).fetchone():
        raise HTTPException(403, "只能查询自己自选内的标的")


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


@app.get("/api/valuation")
def api_valuation(code: str, user=Depends(current_user)):
    with db() as conn:
        _require_watched(conn, user, code)
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


@app.get("/api/fund_rank")
def api_fund_rank(code: str, user=Depends(current_user)):
    with db() as conn:
        _require_watched(conn, user, code)
        rows = conn.execute("SELECT date,rank FROM fund_rank WHERE code=? ORDER BY date", (code,)).fetchall()
    if not rows:
        raise HTTPException(404, f"{code} 无排名数据")
    last = rows[-1]
    return {"code": code, "date": last["date"], "rank": last["rank"],
            "trend": [[r["date"], r["rank"]] for r in rows[-250:]]}


@app.get("/api/overlap")
def api_overlap(codes: str, user=Depends(current_user)):
    """多只基金前十大持仓重叠度：两只共同持有部分取较小权重求和"""
    code_list = [c.strip() for c in codes.split(",") if c.strip()]
    if len(code_list) < 2:
        raise HTTPException(400, "至少需要 2 只基金")
    with db() as conn:
        for c in code_list:
            _require_watched(conn, user, c)
        names = {r["code"]: r["name"] for r in
                 conn.execute("SELECT code,name FROM watchlist WHERE user_id=?",
                              (user["id"],)).fetchall()}
        funds = []
        for c in code_list:
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
    sched.start()
    _bg_refresh()
    log.info("启动完成，已触发首次数据同步")


# 静态托管前端构建产物
_DIST = Path(__file__).resolve().parent.parent / "static"
if _DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_DIST / "assets"), name="assets")

    @app.get("/")
    def index():
        return FileResponse(_DIST / "index.html")
