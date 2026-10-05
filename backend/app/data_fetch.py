"""数据抓取层。

接口选型（2026-10 实测可用性）：
- 股票/ETF 前复权K线: 腾讯 web.ifzq.gtimg.cn（东财 push2his 对 Python TLS 指纹有 WAF 拦截，弃用）
- 场外基金全量净值+日增长率: 天天基金 pingzhongdata（日增长率为分红再投口径，链乘得到复权净值）
- 基金持仓: akshare fund_portfolio_hold_em（东财 F10）
- 股票估值 PE/PB: akshare stock_zh_valuation_baidu（百度股市通，约近3年，用于分位计算）
- 基金同类排名: akshare fund_open_fund_info_em 同类排名走势（原始名次，越小越好）
- 搜索: 东财 searchapi 联想
"""
import json
import logging
import os
import re
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


def search(q: str, limit: int = 10) -> list[dict]:
    """东财联想搜索：支持代码或名称，覆盖 A股/ETF/场外基金"""
    url = "https://searchapi.eastmoney.com/api/suggest/get"
    params = {"input": q, "type": "14", "token": "D43BF722C8E33BDC906FB84D85E326E8", "count": str(limit * 2)}
    r = requests.get(url, params=params, headers=UA, timeout=10)
    r.raise_for_status()
    data = (r.json().get("QuotationCodeTable") or {}).get("Data") or []

    def classify(item: dict) -> str | None:
        name = item.get("SecurityTypeName") or ""
        qt = item.get("QuoteID") or ""
        code = item.get("Code") or ""
        if "ETF" in name or "LOF" in name:
            return "etf"
        if "基金" in name and ("开放" in name or qt.startswith("0.")):
            return "fund"
        if qt.startswith(("0.", "1.")) and len(code) == 6 and code.isdigit():
            return "stock"
        return None

    seen, out = set(), []
    for item in data:
        t = classify(item)
        if not t:
            continue
        code = item["Code"]
        if code in seen:
            continue
        seen.add(code)
        out.append({"code": code, "name": item["Name"], "type": t})
        if len(out) >= limit:
            break
    return out
