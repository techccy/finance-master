import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api, TYPE_LABEL } from '../api.js'
import { T, fmtPct, cellColor } from '../theme.js'

const FGROUPS = ['', '股票型', '混合型', '债券型', '指数型', 'QDII', 'FOF', '货币型']
const PERIODS = [
  { key: '1m', label: '近1月' },
  { key: '3m', label: '近3月' },
  { key: '6m', label: '近6月' },
  { key: '1y', label: '近1年' },
  { key: '3y', label: '近3年' },
  { key: 'ytd', label: '今年来' },
]
const pctColor = v => (v == null ? T.muted : v <= 20 ? T.up : v >= 80 ? T.down : '#FB923C')

export default function Market({ isMobile, watchlist, onAdd, onOpenDetail }) {
  const [fgroup, setFgroup] = useState('混合型')
  const [period, setPeriod] = useState('1y')
  const [order, setOrder] = useState('desc')
  const [q, setQ] = useState('')
  const [minRet, setMinRet] = useState('')
  const [maxRet, setMaxRet] = useState('')
  const [pctMax, setPctMax] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const timer = useRef(null)
  const qDebounced = useDebounce(q, 400)

  const watched = useMemo(() => new Set(watchlist.map(w => w.code)), [watchlist])

  useEffect(() => { setPage(1) }, [fgroup, period, order, qDebounced, minRet, maxRet, pctMax])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    const params = new URLSearchParams({ period, order, page: String(page), page_size: '20' })
    if (fgroup) params.set('fgroup', fgroup)
    if (qDebounced.trim()) params.set('q', qDebounced.trim())
    if (minRet !== '') params.set('min_ret', minRet)
    if (maxRet !== '') params.set('max_ret', maxRet)
    if (pctMax !== '') params.set('pct_max', pctMax)
    api(`/market?${params}`)
      .then(d => alive && setData(d))
      .catch(e => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [fgroup, period, order, qDebounced, minRet, maxRet, pctMax, page])

  const periodLabel = PERIODS.find(p => p.key === period).label

  const input = { width: 90, padding: '6px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, outline: 'none' }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>🛒 基金超市</div>
      <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 14 }}>
        全市场 {data ? data.total.toLocaleString() : '…'} 只（按当前筛选） · 快照更新 {data?.updated || '…'} · 点击行看详情
      </div>

      {/* 筛选栏 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {FGROUPS.map(g => (
          <button key={g} onClick={() => setFgroup(g)} style={{
            padding: '6px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13,
            background: fgroup === g ? T.accent : T.panel, color: fgroup === g ? T.accentText : T.muted,
            fontWeight: fgroup === g ? 600 : 400,
          }}>{g || '全部'}</button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, fontSize: 13 }}>
        <select value={period} onChange={e => setPeriod(e.target.value)}
          style={{ ...input, width: 'auto', cursor: 'pointer' }}>
          {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}收益</option>)}
        </select>
        <select value={order} onChange={e => setOrder(e.target.value)} style={{ ...input, width: 'auto', cursor: 'pointer' }}>
          <option value="desc">从高到低</option>
          <option value="asc">从低到高</option>
        </select>
        <label style={{ color: T.muted }}>收益≥ <input value={minRet} onChange={e => setMinRet(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="%" style={input} /></label>
        <label style={{ color: T.muted }}>≤ <input value={maxRet} onChange={e => setMaxRet(e.target.value.replace(/[^\d.-]/g, ''))} placeholder="%" style={input} /></label>
        <label style={{ color: T.muted }}>排名百分位≤ <input value={pctMax} onChange={e => setPctMax(e.target.value.replace(/[^\d.]/g, ''))} placeholder="20" style={{ ...input, width: 70 }} /></label>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="名称/代码搜索" style={{ ...input, width: 150 }} />
        {loading && <span style={{ color: T.faint }}>加载中…</span>}
        {err && <span style={{ color: T.up }}>{err}</span>}
      </div>

      {/* 列表 */}
      <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: isMobile ? 560 : 0 }}>
          <thead>
            <tr style={{ color: T.muted, borderBottom: `1px solid ${T.border}` }}>
              <th style={{ textAlign: 'left', padding: '9px 10px', fontWeight: 500 }}>名称</th>
              <th style={{ textAlign: 'left', padding: '9px 6px', fontWeight: 500 }}>类型</th>
              <th style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 500 }}>{periodLabel}收益</th>
              <th style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 500 }}>同类名次</th>
              <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}>百分位</th>
              <th style={{ textAlign: 'right', padding: '9px 10px', fontWeight: 500 }}></th>
            </tr>
          </thead>
          <tbody>
            {(data?.items || []).map(it => (
              <tr key={it.code} onClick={() => onOpenDetail({ code: it.code, name: it.name, type: 'fund' })}
                style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.background = T.panel2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td style={{ padding: '9px 10px' }}>
                  <span style={{ fontWeight: 600 }}>{it.name}</span>
                  <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 7 }}>{it.code}</span>
                  {watched.has(it.code) && <span style={{ fontSize: 11, color: T.accent, marginLeft: 6 }}>已自选</span>}
                </td>
                <td style={{ padding: '9px 6px', fontSize: 12, color: T.muted }}>{it.ftype}</td>
                <td style={{ textAlign: 'right', padding: '9px 8px', color: cellColor(it.ret), fontWeight: 600 }}>{fmtPct(it.ret)}</td>
                <td style={{ textAlign: 'right', padding: '9px 8px' }}>{it.rank != null ? `${it.rank} / ${it.cnt}` : '-'}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px', color: pctColor(it.pct), fontWeight: 600 }}>
                  {it.pct != null ? `${it.pct}%` : '-'}</td>
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>
                  {!watched.has(it.code) && (
                    <span onClick={e => { e.stopPropagation(); onAdd({ code: it.code, name: it.name, type: 'fund' }) }}
                      style={{ fontSize: 12, padding: '3px 10px', borderRadius: 7, background: T.panel2, color: T.accent, cursor: 'pointer' }}>+自选</span>
                  )}
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: T.faint }}>无符合条件的基金，放宽筛选试试</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      {data && data.total > data.page_size && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 14, fontSize: 13.5 }}>
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={pgBtn(page <= 1)}>← 上一页</button>
          <span style={{ color: T.muted }}>第 {data.page} / {Math.ceil(data.total / data.page_size)} 页</span>
          <button disabled={page >= Math.ceil(data.total / data.page_size)} onClick={() => setPage(p => p + 1)}
            style={pgBtn(page >= Math.ceil(data.total / data.page_size))}>下一页 →</button>
        </div>
      )}
    </div>
  )
}

const pgBtn = disabled => ({
  padding: '7px 16px', borderRadius: 8, border: `1px solid ${T.border}`, cursor: disabled ? 'default' : 'pointer',
  fontSize: 13, background: T.panel2, color: disabled ? T.faint : T.text, opacity: disabled ? 0.5 : 1,
})

function useDebounce(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
