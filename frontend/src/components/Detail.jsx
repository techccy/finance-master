import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { api, startDateOf, DETAIL_RANGES, TYPE_LABEL } from '../api.js'
import { T, chartDark, fmtPct, cellColor } from '../theme.js'

export default function Detail({ target, isMobile, watchlist, onAdd, onBack }) {
  const [range, setRange] = useState('1y')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const chartRef = useRef(null)
  const chart = useRef(null)

  const watched = watchlist.some(w => w.code === target.code)
  const start = startDateOf(range)

  useEffect(() => {
    let alive = true
    setData(null); setLoading(true); setErr('')
    api(`/detail?code=${target.code}&type=${target.type}&start=${start}&name=${encodeURIComponent(target.name || '')}`)
      .then(d => alive && setData(d))
      .catch(e => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [target.code, target.type, start])

  useEffect(() => {
    if (!chartRef.current) return
    if (chart.current && chart.current.getDom() !== chartRef.current) {
      chart.current.dispose(); chart.current = null
    }
    if (!chart.current) {
      chart.current = echarts.init(chartRef.current)
      const ro = new ResizeObserver(() => chart.current && chart.current.resize())
      ro.observe(chartRef.current)
      chart._ro = ro
    }
  }, [data])

  useEffect(() => () => { chart._ro && chart._ro.disconnect(); chart.current && chart.current.dispose() }, [])

  useEffect(() => {
    if (!chart.current || !data) return
    const series = [{
      name: `${data.name}(${TYPE_LABEL[data.type]})`,
      type: 'line', showSymbol: false, connectNulls: false,
      data: data.series.map(p => p[1]),
      lineStyle: { color: T.accentBright, width: 2 },
      itemStyle: { color: T.accentBright },
      markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: T.faint, type: 'dashed' }, data: [{ yAxis: 0 }] },
    }]
    if (data.benchmark) {
      series.push({
        name: `${data.benchmark.name}（基准）`,
        type: 'line', showSymbol: false, connectNulls: false,
        data: data.benchmark.series.map(p => p[1]),
        lineStyle: { color: T.faint, width: 1.5, type: 'dashed' },
        itemStyle: { color: T.faint },
      })
    }
    chart.current.setOption({
      ...chartDark,
      tooltip: { ...chartDark.tooltip, trigger: 'axis', valueFormatter: v => v == null ? '-' : fmtPct(v) },
      legend: { ...chartDark.legend, top: 0 },
      grid: isMobile ? { left: 44, right: 14, top: 40, bottom: 26 } : { left: 60, right: 30, top: 40, bottom: 60 },
      xAxis: { type: 'category', data: data.dates, axisLabel: { color: T.faint }, axisLine: { lineStyle: { color: T.borderSoft } } },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%', color: T.faint }, splitLine: { lineStyle: { color: T.borderSoft } } },
      dataZoom: [
        { type: 'inside' },
        ...(!isMobile ? [{ type: 'slider', height: 18, bottom: 12, borderColor: T.border, backgroundColor: T.panel2,
          fillerColor: 'rgba(132,204,22,.18)', handleStyle: { color: T.panel2, borderColor: T.accent },
          dataBackground: { lineStyle: { color: T.border }, areaStyle: { color: T.borderSoft } },
          textStyle: { color: T.faint } }] : []),
      ],
      series,
    }, { lazyUpdate: true })
  }, [data, isMobile])

  const m = data?.metrics
  return (
    <div>
      {/* 头部：返回 + 标的身份 + 实时行情 + 加入自选 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <span onClick={onBack} style={{ color: T.accent, cursor: 'pointer', fontSize: 14, flexShrink: 0 }}>← 返回</span>
        <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
          color: T.text, border: `1px solid ${T.border}`, background: T.panel2 }}>{TYPE_LABEL[target.type]}</span>
        <span style={{ fontWeight: 700, fontSize: 17 }}>{data?.name || target.name || target.code}</span>
        <span style={{ fontSize: 12.5, color: T.faint }}>{target.code}</span>
        {data?.quote && (
          <span style={{ fontSize: 13.5 }}>
            最新 {data.quote.date}：<b style={{ fontSize: 15 }}>{data.quote.value ?? '-'}</b>
            <b style={{ marginLeft: 6, color: cellColor(data.quote.change_pct) }}>{fmtPct(data.quote.change_pct)}</b>
          </span>
        )}
        {!watched && (
          <button onClick={() => onAdd({ code: target.code, name: data?.name || target.name || target.code, type: target.type })}
            style={{ marginLeft: 'auto', padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
              fontSize: 13, fontWeight: 600, background: T.accent, color: T.accentText }}>
            + 加入自选
          </button>
        )}
      </div>

      {/* 区间切换 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {DETAIL_RANGES.map(p => (
          <button key={p.key} onClick={() => setRange(p.key)} style={{
            padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13,
            background: range === p.key ? T.accent : T.panel, color: range === p.key ? T.accentText : T.muted,
            fontWeight: range === p.key ? 600 : 400,
          }}>{p.label}</button>
        ))}
        <span style={{ fontSize: 12.5, color: T.faint, marginLeft: 6 }}>曲线以区间起点为 0%，股票前复权 / 基金分红再投</span>
      </div>

      {err && <div style={{ padding: 20, color: T.up }}>加载失败：{err}</div>}
      {loading && <div style={{ padding: 12, color: T.faint }}>加载中…（首次查询该标的需要后台同步几秒到几十秒）</div>}

      {data && (
        <>
          <div ref={chartRef} style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, height: isMobile ? 300 : 420 }} />
          {target.type === 'fund' && !data.benchmark && (
            <div style={{ fontSize: 12.5, color: T.faint, marginTop: 8 }}>
              该基金业绩比较基准为复合/未收录指数，未绘制基准线（仅支持纯指数基准）
            </div>
          )}

          {/* 指标卡 */}
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px', flex: '1 1 300px', boxSizing: 'border-box' }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>区间指标（{data.start} ~ {data.end}）</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
                <tbody>
                  <tr><td style={tdL}>区间收益</td><td style={{ ...tdR, color: cellColor(m.total_return), fontWeight: 600 }}>{fmtPct(m.total_return)}</td></tr>
                  <tr><td style={tdL}>年化收益</td><td style={{ ...tdR, color: cellColor(m.annualized) }}>{fmtPct(m.annualized)}</td></tr>
                  <tr><td style={tdL}>最大回撤</td><td style={{ ...tdR, color: T.up }}>{m.max_drawdown.toFixed(2)}%</td></tr>
                  {!isMobile && <tr><td style={tdL}>年化波动</td><td style={tdR}>{m.volatility.toFixed(2)}%</td></tr>}
                  {!isMobile && <tr><td style={tdL}>夏普（2% 无风险）</td><td style={tdR}>{m.sharpe.toFixed(2)}</td></tr>}
                  {data.excess != null && (
                    <tr><td style={tdL}>相对基准超额</td><td style={{ ...tdR, color: cellColor(data.excess), fontWeight: 600 }}>{fmtPct(data.excess)}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {data.type === 'fund' && data.rank && <RankCard rank={data.rank} isMobile={isMobile} />}
            {data.type === 'fund' && data.rank_trend && <RankTrendCard trend={data.rank_trend} isMobile={isMobile} />}
            {data.type === 'stock' && data.valuation && <ValuationCard v={data.valuation} />}
          </div>
        </>
      )}
    </div>
  )
}

const tdL = { padding: '7px 4px', color: T.muted, borderBottom: `1px solid ${T.borderSoft}` }
const tdR = { padding: '7px 4px', textAlign: 'right', borderBottom: `1px solid ${T.borderSoft}` }

function RankCard({ rank, isMobile }) {
  return (
    <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px', flex: '1 1 320px', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>同类排名 · {rank.ftype}</div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 8 }}>快照更新 {rank.updated} · 百分位越小越强</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ color: T.muted, borderBottom: `1px solid ${T.border}` }}>
            <th style={{ textAlign: 'left', padding: '5px 4px', fontWeight: 500 }}>周期</th>
            <th style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 500 }}>收益</th>
            <th style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 500 }}>名次</th>
            <th style={{ textAlign: 'right', padding: '5px 4px', fontWeight: 500 }}>百分位</th>
          </tr>
        </thead>
        <tbody>
          {rank.periods.map(p => (
            <tr key={p.key} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
              <td style={{ padding: '6px 4px' }}>{p.label}</td>
              <td style={{ textAlign: 'right', padding: '6px 4px', color: cellColor(p.ret) }}>{fmtPct(p.ret)}</td>
              <td style={{ textAlign: 'right', padding: '6px 4px' }}>{p.rank != null ? `${p.rank} / ${p.cnt}` : '-'}</td>
              <td style={{ textAlign: 'right', padding: '6px 4px', color: pctColor(p.pct), fontWeight: 600 }}>
                {p.pct != null ? `${p.pct}%` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function RankTrendCard({ trend, isMobile }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !trend?.trend) return
    const c = echarts.init(ref.current)
    c.setOption({
      grid: { left: 44, right: 8, top: 8, bottom: 22 },
      xAxis: { type: 'category', data: trend.trend.map(t => t[0]), axisLabel: { fontSize: 9, formatter: v => v.slice(2), color: T.faint }, axisLine: { lineStyle: { color: T.borderSoft } } },
      yAxis: { type: 'value', inverse: true, axisLabel: { fontSize: 9, color: T.faint }, splitLine: { lineStyle: { color: T.borderSoft } } },
      series: [{ type: 'line', data: trend.trend.map(t => t[1]), showSymbol: false, lineStyle: { color: T.accentBright, width: 1.5 } }],
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => { ro.disconnect(); c.dispose() }
  }, [trend])
  return (
    <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px', flex: '1 1 320px', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>近3月名次走势</div>
      <div style={{ fontSize: 12, color: T.faint, marginBottom: 6 }}>截至 {trend.date} · 第 {trend.rank} 名 · 名次越小越好</div>
      <div ref={ref} style={{ width: '100%', height: isMobile ? 120 : 150 }} />
    </div>
  )
}

function ValuationCard({ v }) {
  return (
    <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px', flex: '1 1 300px', boxSizing: 'border-box' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>估值分位</div>
      <div style={{ fontSize: 13.5, lineHeight: 2 }}>
        <div>PE-TTM <b>{v.pe_ttm ?? '-'}</b>，近{v.n_years}年分位 <b style={{ color: pctColor(v.pe_percentile) }}>{v.pe_percentile ?? '-'}%</b></div>
        <div>PB <b>{v.pb ?? '-'}</b>，近{v.n_years}年分位 <b style={{ color: pctColor(v.pb_percentile) }}>{v.pb_percentile ?? '-'}%</b></div>
        <div style={{ fontSize: 12, color: T.faint }}>分位越低越接近历史低位（数据截至 {v.date}）</div>
      </div>
    </div>
  )
}

const pctColor = v => (v == null ? T.muted : v <= 30 ? T.down : v >= 70 ? T.up : '#FB923C')
