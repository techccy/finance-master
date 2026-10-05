"""数据抓取层。

接口选型（2026-10 实测可用性）：
- 股票/ETF 前复权K线: 腾讯 web.ifzq.gtimg.cn（东财 push2his 对 Python TLS 指纹有 WAF 拦截，弃用）
- 场外基金全量净值+日增长率: 天天基金 pingzhongdata（日增长率为分红再投口径，链乘得到复权净值）
- 基金持仓: akshare fund_portfolio_hold_em（东财 F10）
- 股票估值 PE/PB: akshare stock_zh_valuation_baidu（百度股市通，约近3年，用于分位计算）
- 基金同类排名: akshare fund_open_fund_info_em 同类排名走势（原始名次，越小越好）
- 搜索: 本地全量基金名单（东财 fundcode_search.js，日刷新）+ 东财 searchapi 联想（股票/ETF）
- 实时行情: 腾讯 qt.gtimg.cn（股票/ETF）+ 天天基金 fundgz 估值（场外基金）
"""
import json
import logging
import os
import re
import threading
import time
from datetime import datetime, timezone, timedelta

import urllib.request

# 数据源均为国内站点，强制绕过任何系统/环境代理
urllib.request.getproxies = lambda: {}  # 屏蔽 macOS 系统代理与环境变量代理
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

import requests
import warnings

warnings.filterwarnings("ignore")

log = logging.getLogger("data")

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"}
FULL_START = "2015-01-01"
CST = timezone(timedelta(hours=8))


def _tencent_sym(code: str, itype: str) -> str:
    if itype == "etf":
        return ("sh" if code.startswith(("5", "6")) else "sz") + code
    if code.startswith(("6", "9")) or code.startswith("688"):
        return "sh" + code
    return "sz" + code


def fetch_kline(code: str, itype: str) -> list[tuple[str, float]]:
    """腾讯前复权日K，自动分页取全量历史。返回 [(date, qfq_close)] 升序"""
    sym = _tencent_sym(code, itype)
    out: dict[str, float] = {}
    end = datetime.now().strftime("%Y-%m-%d")
    for _ in range(10):  # 最多 10 页 ≈ 15 年
        url = f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={sym},day,{FULL_START},{end},640,qfq"
        r = requests.get(url, headers=UA, timeout=15)
        r.raise_for_status()
        j = r.json()["data"][sym]
        rows = j.get("qfqday") or j.get("day") or []
        if not rows:
            break
        for row in rows:
            out[row[0]] = float(row[2])
        earliest = rows[0][0]
        if earliest <= FULL_START or len(rows) < 640:
            break
        end = earliest  # 向更早分页
    return sorted(out.items())


def fetch_fund_nav(code: str) -> list[tuple[str, float]]:
    """pingzhongdata 单位净值+日增长率 → 链乘复权净值（分红再投口径），起始=1"""
    r = requests.get(f"https://fund.eastmoney.com/pingzhongdata/{code}.js", headers=UA, timeout=20)
    r.raise_for_status()
    m = re.search(r"Data_netWorthTrend\s*=\s*(\[.*?\]);", r.text)
    if not m:
        raise RuntimeError(f"{code} 未找到净值数据")
    arr = json.loads(m.group(1))
    if not arr:
        raise RuntimeError(f"{code} 净值数据为空")
    out, nav = [], 1.0
    for i, p in enumerate(arr):
        if i > 0:
            er = p.get("equityReturn")
            er = 0.0 if er is None else float(er)
            nav *= 1 + er / 100.0
        d = datetime.fromtimestamp(p["x"] / 1000, tz=CST).strftime("%Y-%m-%d")
        out.append((d, round(nav, 6)))
    return out


def fetch_holdings(code: str) -> dict[str, list[dict]]:
    """基金前十大持仓 {quarter: [{code,name,ratio}]}，ratio 为占净值百分比"""
    import akshare as ak
    year = datetime.now().year
    out: dict[str, list[dict]] = {}
    for y in (str(year), str(year - 1)):  # 年初最新季报未出时补上一年
        try:
            df = ak.fund_portfolio_hold_em(symbol=code, date=y)
        except Exception:
            continue
        for rec in df.to_dict("records"):
            try:
                q = str(rec.get("季度", ""))
                out.setdefault(q, []).append({
                    "code": str(rec.get("股票代码") or ""),
                    "name": str(rec.get("股票名称") or ""),
                    "ratio": float(rec.get("占净值比例") or 0),
                })
            except (TypeError, ValueError):
                continue
    out = {q: v for q, v in out.items() if v}
    if not out:
        raise RuntimeError(f"{code} 无持仓数据（可能是债基/货基/QDII）")
    return out


def fetch_valuation(code: str) -> list[tuple[str, float | None, float | None]]:
    """百度股市通 PE(TTM)/PB 历史，按日期合并。约近3年"""
    import akshare as ak

    def _series(indicator):
        df = ak.stock_zh_valuation_baidu(symbol=code, indicator=indicator, period="全部")
        return {str(r["date"]): (float(r["value"]) if r["value"] is not None and str(r["value"]) != "-" else None)
                for _, r in df.iterrows()}

    pe, pb = _series("市盈率(TTM)"), _series("市净率")
    dates = sorted(set(pe) | set(pb))
    return [(d, pe.get(d), pb.get(d)) for d in dates]


def fetch_fund_rank(code: str) -> list[tuple[str, int]]:
    """同类排名（近三月口径，原始名次，越小越好）"""
    import akshare as ak
    df = ak.fund_open_fund_info_em(symbol=code, indicator="同类排名走势")
    out = []
    for rec in df.to_dict("records"):
        d = str(rec.get("报告日期") or "")[:10]
        rank = rec.get("同类型排名-每日近三月排名")
        if not d or rank is None or str(rank).strip() in ("", "-"):
            continue
        out.append((d, int(float(rank))))
    return sorted(out)


# ---------------- 基金全量名单缓存 ----------------

_FUND_LIST_URL = "https://fund.eastmoney.com/js/fundcode_search.js"
_fund_lock = threading.Lock()
_fund_list: list[tuple[str, str, str, str, str]] | None = None
_fund_list_at: float = 0.0
FUND_LIST_TTL = 86400  # 每天刷新一次


def _load_fund_list() -> list[tuple[str, str, str, str, str]]:
    """全量场外基金名单 [(code, 拼音缩写, 名称, 类型, 拼音全拼)]，失败时用旧缓存"""
    global _fund_list, _fund_list_at
    with _fund_lock:
        if _fund_list is not None and time.time() - _fund_list_at < FUND_LIST_TTL:
            return _fund_list
        try:
            r = requests.get(_FUND_LIST_URL, headers=UA, timeout=20)
            r.raise_for_status()
            txt = r.text.strip()
            data = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
            funds = []
            for row in data:
                if not isinstance(row, (list, tuple)) or len(row) < 4:
                    continue
                code, pyab, name, ftype = row[0], row[1], row[2], row[3]
                pyfull = row[4] if len(row) > 4 else pyab
                funds.append((str(code), str(pyab), str(name), str(ftype), str(pyfull)))
            if not funds:
                raise RuntimeError("基金名单解析为空")
            _fund_list, _fund_list_at = funds, time.time()
            log.info("基金全量名单已更新: %d 条", len(funds))
        except Exception as e:
            if _fund_list is None:
                raise
            _fund_list_at = time.time() - FUND_LIST_TTL + 3600  # 1 小时后重试
            log.warning("基金名单刷新失败，沿用旧缓存: %s", e)
    return _fund_list


def _match_funds(q: str, limit: int) -> list[dict]:
    """本地匹配基金：代码前缀 / 名称 / 拼音缩写 / 拼音全拼，按相关度排序"""
    fl = _load_fund_list()
    ql = q.strip().lower()
    if q.strip().isdigit():
        # 纯数字只按代码前缀匹配
        hits = [f for f in fl if f[0].startswith(q.strip())]
        hits.sort(key=lambda f: (f[0], f[2]))
        return [{"code": f[0], "name": f[2], "type": "fund"} for f in hits[:limit]]

    def rank(f: tuple) -> int:
        _, pyab, name, _, pyfull = f
        if name.startswith(q): return 0
        if pyab.lower().startswith(ql): return 1
        if q in name: return 2
        if ql in pyab.lower(): return 3
        if ql in pyfull.lower(): return 4
        return 99

    scored = [(rank(f), f) for f in fl if rank(f) != 99]
    scored.sort(key=lambda x: (x[0], x[1][0]))
    return [{"code": f[0], "name": f[2], "type": "fund"} for _, f in scored[:limit]]


def _suggest_stock_etf(q: str, limit: int) -> list[dict]:
    """东财联想：股票 / 场内 ETF、LOF"""
    url = "https://searchapi.eastmoney.com/api/suggest/get"
    params = {"input": q, "type": "14", "token": "D43BF722C8E33BDC906FB84D85E326E8", "count": str(limit * 2)}
    r = requests.get(url, params=params, headers=UA, timeout=10)
    r.raise_for_status()
    data = (r.json().get("QuotationCodeTable") or {}).get("Data") or []
    out = []
    for item in data:
        name_st = item.get("SecurityTypeName") or ""
        qt = item.get("QuoteID") or ""
        code = item.get("Code") or ""
        if "ETF" in name_st or "LOF" in name_st:
            t = "etf"
        elif qt.startswith(("0.", "1.")) and len(code) == 6 and code.isdigit():
            t = "stock"
        else:
            continue
        rank = 0 if code == q else (1 if code.startswith(q) else 2)
        out.append({"code": code, "name": item.get("Name"), "type": t, "rank": rank})
    return out[:limit]


def search(q: str, limit: int = 10) -> list[dict]:
    """双源搜索：本地全量基金名单（含拼音）+ 东财联想（股票/ETF），按相关度合并"""
    q = q.strip()
    results, seen = [], set()

    try:
        for f in _match_funds(q, limit):
            if f["code"] not in seen:
                seen.add(f["code"])
                results.append(f)
    except Exception as e:
        log.warning("本地基金搜索不可用: %s", e)

    try:
        for s in _suggest_stock_etf(q, limit):
            if s["code"] not in seen:
                seen.add(s["code"])
                results.append({k: s[k] for k in ("code", "name", "type")})
    except Exception as e:
        log.warning("东财联想不可用: %s", e)

    return results[:limit]


# ---------------- 搜索预览：实时行情 + 历史曲线 ----------------

_fund_quote_cache: dict[str, tuple[float, dict]] = {}  # code -> (ts, quote)
FUND_QUOTE_TTL = 120  # 净值日更，短缓存避免连续搜索重复请求


def _fund_quote(code: str) -> dict | None:
    """天天基金 F10 历史净值接口，取最近 1 条（单位净值+日涨跌）"""
    hit = _fund_quote_cache.get(code)
    if hit and time.time() - hit[0] < FUND_QUOTE_TTL:
        return hit[1]
    url = "https://api.fund.eastmoney.com/f10/lsjz"
    headers = {**UA, "Referer": f"http://fundf10.eastmoney.com/jjjz_{code}.html"}
    r = requests.get(url, params={"fundCode": code, "pageIndex": 1, "pageSize": 1}, headers=headers, timeout=10)
    r.raise_for_status()
    rows = ((r.json() or {}).get("Data") or {}).get("LSJZList") or []
    if not rows:
        return None
    row = rows[0]
    dwjz, jzzzl = row.get("DWJZ"), row.get("JZZZL")
    q = {"value": float(dwjz) if dwjz not in (None, "") else None,
         "change_pct": float(jzzzl) if jzzzl not in (None, "") else None,
         "date": row.get("FSRQ") or "", "est": False}
    _fund_quote_cache[code] = (time.time(), q)
    return q


def fetch_quotes(items: list[dict]) -> dict[str, dict]:
    """批量实时行情/净值。items=[{code,type}] → {code: {value, change_pct, date, est}}"""
    out: dict[str, dict] = {}
    syms: dict[str, str] = {}
    for it in items:
        if it["type"] in ("stock", "etf"):
            syms[_tencent_sym(it["code"], it["type"])] = it["code"]
    if syms:
        try:
            r = requests.get("https://qt.gtimg.cn/q=" + ",".join(syms), headers=UA, timeout=10)
            r.encoding = "gbk"
            for sym, body in re.findall(r'v_(\w+)="([^"]*)"', r.text):
                code = syms.get(sym)
                f = body.split("~")
                if not code or len(f) < 5 or not f[3]:
                    continue
                price, prev = float(f[3]), float(f[4] or 0)
                chg = round((price / prev - 1) * 100, 2) if prev > 0 else None
                ts = f[30] if len(f) > 30 else ""
                out[code] = {"value": price, "change_pct": chg,
                             "date": f"{ts[:4]}-{ts[4:6]}-{ts[6:8]}" if len(ts) >= 8 else "", "est": False}
        except Exception as e:
            log.warning("腾讯实时行情失败: %s", e)

    for it in items:
        if it["type"] != "fund" or it["code"] in out:
            continue
        try:
            q = _fund_quote(it["code"])
            if q:
                out[it["code"]] = q
        except Exception:
            continue
    return out


def fetch_preview(code: str, itype: str, n: int = 180) -> list[tuple[str, float]]:
    """搜索预览用历史曲线（不入库），取最近 n 个点"""
    if itype == "fund":
        pts = fetch_fund_nav(code)
    else:
        pts = fetch_kline(code, itype)
    return pts[-n:]
