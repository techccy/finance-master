# 观测对比平台 Agent 接口文档

本站提供基金/股票（A股+ETF/LOF+场外基金）的观测与对比数据。本文档面向 AI Agent，说明如何通过 HTTP API 操作本站。

## 鉴权

所有 `/api/*` 接口需要鉴权，支持两种方式：

1. **API Token（推荐 Agent 使用）**：请求头携带
   `Authorization: Bearer <token>`
   token 由用户在网页端「API Token」弹窗中生成（形如 `wbk_xxxxx`），等同账号本人权限。泄漏时可在网页端重置（旧 token 立即失效）。
2. **Session Cookie**：浏览器登录后的 `session` cookie（Agent 一般用不到）。

未鉴权返回 `401 {"detail":"未登录"}`。

## 权限边界

- token = 本人权限：可读全部数据接口，可**增/删自己的自选**。
- **删除自选必须带 `confirm=true`**，否则返回 400。这是防误操作设计——Agent 在执行删除类动作前应先向用户确认。
- 改密码、账号管理（管理员接口）、强制刷新不支持 token 调用。

## 接口清单

### 搜索
```
GET /api/search?q=白酒
→ [{code, name, type}]   type ∈ stock|etf|fund
```
支持代码前缀、名称、拼音缩写。无需鉴权。

### 自选列表
```
GET /api/watchlist
→ [{code, name, type, last_date, last_value}]
```

### 增加自选
```
POST /api/watchlist
Content-Type: application/json
{"code": "110011", "name": "易方达中小盘混合", "type": "fund"}
→ {"ok": true}
```
添加后后台自动同步历史数据（需几十秒）。

### 删除自选（需 confirm）
```
DELETE /api/watchlist/{code}?confirm=true
→ {"ok": true}
```

### 单标的详情（曲线 + 业绩基准 + 指标）
```
GET /api/detail?code=110011&type=fund&start=2025-01-01&end=2026-10-10&name=易方达蓝筹
→ {
  code, name, type, start, end,
  dates: ["2025-01-02", ...],          // 交易日序列
  series: [["2025-01-02", 0.35], ...], // 归一化收益%，起点=0
  metrics: {total_return, annualized, max_drawdown, volatility, sharpe},  // %
  quote: {value, change_pct, date, est} | null,
  benchmark: {name: "沪深300", series: [[date, pct], ...]} | null,  // 仅基金且基准为纯指数
  excess: 12.34 | null,                // 区间相对基准超额收益（百分点）
  rank: {ftype, updated, periods: [{key, label, ret, rank, cnt, pct}]} | null,  // 基金同类排名
  rank_trend: {...} | null,            // 近3月名次走势
  valuation: {pe_ttm, pe_percentile, pb, pb_percentile, n_years} | null,  // 仅股票
}
```
对任意标的开放（不限于自选），数据按需抓取入库。`name` 可省略。
`type` 必填：股票=`stock`，ETF/LOF=`etf`，场外基金=`fund`。

### 自选池排行榜
```
GET /api/leaderboard?start=2026-01-01
→ {start, end, items: [{code, name, type, total_return, max_drawdown, stale}]}
```
按区间收益降序；`stale=true` 表示数据未就绪（排在末尾）。

### 基金超市（全市场筛选）
```
GET /api/market?fgroup=混合型&q=白酒&period=1y&sort=r_1y&order=desc&min_ret=30&pct_max=20&page=1&page_size=20
→ {total, page, page_size, updated, items: [{code, name, ftype, ret, rank, cnt, pct}]}
```
- `fgroup`：类型前缀过滤，如 `股票型` / `混合型` / `债券型` / `指数型` / `QDII` / `FOF`
- `period` + `sort`：排序周期（1m/3m/6m/1y/3y/ytd），sort 也可为任意收益列
- `min_ret`/`max_ret`：区间收益%过滤；`pct_max`/`pct_min`：同类排名百分位（rank/cnt×100，越小越强）
- 点进单只基金后用 `/api/detail` 查看详情

### 归一化对比（自选内多标的）
```
GET /api/compare?codes=110011,600519&start=2026-01-01
→ {start, end, dates, series: [{code, name, type, points}], metrics: [...]}
```

### 持仓重叠（多只基金）
```
GET /api/overlap?codes=110011,161725
→ {funds: [...], pairs: [{a, b, overlap, common: [...]}]}
```

### 实时行情（批量，≤20 个）
```
GET /api/quote?codes=110011,600519&types=fund,stock
→ {code: {value, change_pct, date, est}}
```

### 估值分位（股票）/ 同类排名走势（基金）
```
GET /api/valuation?code=600519
GET /api/fund_rank?code=110011
```

## 使用约定与注意事项

1. **数据口径**：股票/ETF 为前复权收盘价；场外基金为分红再投复权净值（起点=1）。曲线均为区间起点归 0%。
2. **首次查询冷数据**：详情/对比接口对未入库标的是同步阻塞的（几秒），失败返回 404，可稍后重试。
3. **净值日更**：基金净值在交易日晚间更新，盘中 `quote.est=false` 为昨日净值，勿当作实时估值。
4. **写操作克制**：仅增删自选两处写接口；删除务必先与用户确认。
5. **错误处理**：4xx/5xx 均返回 `{"detail": "错误说明"}`，请读取 `detail` 字段。
6. 请勿高频轮询（数据日更，轮询无意义）；建议按需查询。
