"""指标计算：全部基于起始=1 的净值序列"""


def returns_from_nav(nav: list[float]) -> list[float]:
    """净值序列 → 相邻日收益率"""
    out = []
    for i in range(1, len(nav)):
        if nav[i - 1] > 0:
            out.append(nav[i] / nav[i - 1] - 1)
    return out


def max_drawdown(nav: list[float]) -> float:
    mdd, peak = 0.0, float("-inf")
    for v in nav:
        peak = max(peak, v)
        if peak > 0:
            mdd = min(mdd, v / peak - 1)
    return mdd  # 负数


def metrics(nav: list[float], days: int) -> dict:
    """nav: 区间内起始=1 的净值序列；days: 区间自然日数"""
    if len(nav) < 2 or days <= 0:
        return {"total_return": 0.0, "annualized": 0.0, "max_drawdown": 0.0, "volatility": 0.0, "sharpe": 0.0}
    total = nav[-1] / nav[0] - 1
    ann = (1 + total) ** (365.0 / days) - 1 if total > -1 else -1.0
    rets = returns_from_nav(nav)
    vol = (sum(r * r for r in rets) / len(rets)) ** 0.5 * (252 ** 0.5)  # 年化波动(均值0假设)
    mean_r = sum(rets) / len(rets) if rets else 0.0
    ann_vol_daily = mean_r * 252  # 近似年化收益(算术)
    sharpe = (ann_vol_daily - 0.02) / vol if vol > 0 else 0.0
    return {
        "total_return": round(total * 100, 2),
        "annualized": round(ann * 100, 2),
        "max_drawdown": round(max_drawdown(nav) * 100, 2),
        "volatility": round(vol * 100, 2),
        "sharpe": round(sharpe, 2),
    }


def rebase(points: list[tuple[str, float]], start_date: str, end_date: str | None = None):
    """切取 [start_date, end_date] 并把首点归一为 1。
    返回 ([(date, ratio)...], 自然日数)；ratio 相对区间首日。"""
    import bisect
    dates = [d for d, _ in points]
    i0 = bisect.bisect_left(dates, start_date)
    if i0 >= len(dates):
        return [], 0
    if i0 > 0:  # 含起点前一交易日作为基期，避免区间首日涨跌被吃掉
        i0 -= 1
    i1 = len(dates)
    if end_date:
        i1 = bisect.bisect_right(dates, end_date)
    seg = points[i0:i1]
    if not seg:
        return [], 0
    base = seg[0][1]
    from datetime import date as _d
    d0 = _d.fromisoformat(seg[0][0])
    d1 = _d.fromisoformat(seg[-1][0])
    span = (d1 - d0).days or 1
    return [(d, round(v / base, 6)) for d, v in seg], span
