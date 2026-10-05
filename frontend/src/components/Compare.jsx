import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { api, startDateOf, RANGE_PRESETS, TYPE_LABEL } from '../api.js'

const PALETTE = ['#1f6feb', '#c0392b', '#e67e22', '#7f8c8d', '#8e44ad', '#16a085', '#d35400', '#2c3e50']

function fmtPct(v) {
  if (v == null) return '-'
  const s = v.toFixed(2) + '%'
  return v > 0 ? `+${s}` : s
}

const cellColor = v => (v == null ? '#333' : v > 0 ? '#c0392b' : v < 0 ? '#1e8e3e' : '#333')

export default function Compare({ watchlist, selected }) {
  const [range, setRange] = useState('1y')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const chartRef = useRef(null)
  const chart = useRef(null)

  const codes = useMemo(() => selected.join(','), [selected])
  const start = startDateOf(range)

  useEffect(() => {
    if (!codes) { setData(null); return }
    let alive = true
    setLoading(true); setErr('')
    api(`/compare?codes=${codes}&start=${start}`)
      .then(d => alive && setData(d))
      .catch(e => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [codes, start])

  useEffect(() => {
    if (!chartRef.current) return
    chart.current = echarts.init(chartRef.current)
    const ro = new ResizeObserver(() => chart.current && chart.current.resize())
    ro.observe(chartRef.current)
    return () => { ro.disconnect(); chart.current && chart.current.dispose() }
  }, [])

  useEffect(() => {
    if (!chart.current || !data) return
    chart.current.setOption({
      color: PALETTE,
      tooltip: { trigger: 'axis', valueFormatter: v => v == null ? '-' : fmtPct(v) },
      legend: { top: 0 },
      grid: { left: 60, right: 30, top: 40, bottom: 60 },
      xAxis: { type: 'category', data: data.dates },
      yAxis: { type: 'value', axisLabel: { formatter: '{value}%' }, splitLine: { lineStyle: { color: '#eef0f3' } } },
      dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 12 }],
      series: data.series.map(s => ({
        name: `${s.name}(${TYPE_LABEL[s.type]})`,
        type: 'line', showSymbol: false, connectNulls: false,
        emphasis: { focus: 'series' },
        data: s.points.map(p => p[1]),
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: '#bbb', type: 'dashed' }, data: [{ yAxis: 0 }] },
      })),
    })
  }, [data])

  const nameOf = code => (watchlist.find(w => w.code === code) || {}).name || code

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {RANGE_PRESETS.map(p => (
          <button key={p.key} onClick={() => setRange(p.key)} style={{
            padding: '6px 14px', borderRadius: 999, border: '1px solid #d0d5dd', cursor: 'pointer', fontSize: 13,
            background: range === p.key ? '#1f6feb' : '#fff', color: range === p.key ? '#fff' : '#444'
          }}>{p.label}</button>
        ))}
        <span style={{ fontSize: 12.5, color: '#888', marginLeft: 6 }}>曲线以区间起点为 0% 基准，股票前复权 / 基金分红再投</span>
      </div>

      {selected.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: '#999' }}>在左侧勾选至少一个标的开始对比</div>}
      {err && <div style={{ padding: 20, color: '#c0392b' }}>加载失败：{err}</div>}
      {loading && <div style={{ padding: 12, color: '#888' }}>加载中…（首次添加标的需要后台同步几十秒）</div>}

      {data && (
        <>
          <div ref={chartRef} style={{ background: '#fff', borderRadius: 12, border: '1px solid #e4e7ec', height: 420 }} />
          <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e4e7ec', marginTop: 16, padding: '14px 18px' }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>区间指标（{data.start} ~ {data.end}）</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5 }}>
              <thead>
                <tr style={{ color: '#666', borderBottom: '1px solid #e4e7ec' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px' }}>标的</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px' }}>区间收益</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px' }}>年化</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px' }}>最大回撤</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px' }}>年化波动</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px' }}>夏普(2%)</th>
                </tr>
              </thead>
              <tbody>
                {data.metrics.map((m, i) => (
                  <tr key={m.code} style={{ borderBottom: '1px solid #f4f5f7' }}>
                    <td style={{ padding: '9px 6px' }}><span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 9, background: PALETTE[i % PALETTE.length], marginRight: 7 }} />{m.name}</td>
                    <td style={{ textAlign: 'right', padding: '9px 6px', color: cellColor(m.total_return), fontWeight: 600 }}>{fmtPct(m.total_return)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 6px', color: cellColor(m.annualized) }}>{fmtPct(m.annualized)}</td>
                    <td style={{ textAlign: 'right', padding: '9px 6px', color: '#c0392b' }}>{m.max_drawdown.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '9px 6px' }}>{m.volatility.toFixed(2)}%</td>
                    <td style={{ textAlign: 'right', padding: '9px 6px' }}>{m.sharpe.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 16, flexWrap: 'wrap' }}>
            {data.metrics.map(m => <InfoPanel key={m.code} metric={m} nameOf={nameOf} />)}
          </div>
        </>
      )}
    </div>
  )
}

function InfoPanel({ metric, nameOf }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true; setInfo(null); setErr('')
    if (metric.type === 'stock') {
      api(`/valuation?code=${metric.code}`).then(d => alive && setInfo(d)).catch(e => alive && setErr(e.message))
    } else if (metric.type === 'fund') {
      api(`/fund_rank?code=${metric.code}`).then(d => alive && setInfo(d)).catch(e => alive && setErr(e.message))
    }
    return () => { alive = false }
  }, [metric.code, metric.type])

  if (metric.type === 'etf') return null
  return (
    <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e4e7ec', padding: '14px 18px', minWidth: 320, flex: 1 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{metric.name} · {metric.type === 'stock' ? '估值分位' : '同类排名'}</div>
      {err && <div style={{ color: '#999', fontSize: 12.5 }}>{err}</div>}
      {!err && !info && <div style={{ color: '#999', fontSize: 12.5 }}>加载中…</div>}
      {info && metric.type === 'stock' && (
        <div style={{ fontSize: 13.5, lineHeight: 2 }}>
          <div>PE-TTM <b>{info.pe_ttm ?? '-'}</b>，近{n(info)}年分位 <b style={{ color: pctColor(info.pe_percentile) }}>{info.pe_percentile ?? '-'}%</b></div>
          <div>PB <b>{info.pb ?? '-'}</b>，近{n(info)}年分位 <b style={{ color: pctColor(info.pb_percentile) }}>{info.pb_percentile ?? '-'}%</b></div>
          <div style={{ fontSize: 12, color: '#999' }}>分位越低越接近历史低位（数据截至 {info.date}）</div>
        </div>
      )}
      {info && metric.type === 'fund' && (
        <div style={{ fontSize: 13.5, lineHeight: 2 }}>
          <div>近3月同类排名 <b style={{ color: '#1f6feb' }}>第 {info.rank} 名</b>（{info.date}）</div>
          <MiniRankTrend trend={info.trend} />
          <div style={{ fontSize: 12, color: '#999' }}>名次越小越好</div>
        </div>
      )}
    </div>
  )
}

const n = info => Math.round((info.n_years || 3) * 10) / 10
const pctColor = v => (v == null ? '#333' : v <= 30 ? '#1e8e3e' : v >= 70 ? '#c0392b' : '#d35400')

function MiniRankTrend({ trend }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current || !trend) return
    const c = echarts.init(ref.current, null, { height: 90 })
    c.setOption({
      grid: { left: 40, right: 8, top: 6, bottom: 20 },
      xAxis: { type: 'category', data: trend.map(t => t[0]), axisLabel: { fontSize: 9, formatter: v => v.slice(2) } },
      yAxis: { type: 'value', inverse: true, axisLabel: { fontSize: 9 } },
      series: [{ type: 'line', data: trend.map(t => t[1]), showSymbol: false, lineStyle: { color: '#1f6feb', width: 1.5 } }],
    })
    return () => c.dispose()
  }, [trend])
  return <div ref={ref} style={{ width: '100%' }} />
}
