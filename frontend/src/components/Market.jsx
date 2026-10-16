import React, { useEffect, useMemo, useState } from 'react'
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
// 筛选/排序字段（与后端 {field}_min/{field}_max 通配参数、sort 白名单对应）
// 注：蛋卷不提供近1月回撤，dd 组不放 1m（后端 dd_1m 白名单保留，留待自算补齐）
const FIELD_GROUPS = [
  { label: '区间收益', pre: 'r', periods: PERIODS, fmt: p => `${p.label}收益` },
  { label: '最大回撤', pre: 'dd', periods: PERIODS.filter(p => p.key !== '1m'), fmt: p => `${p.label}最大回撤` },
  { label: '同类百分位', pre: 'pct', periods: PERIODS, fmt: p => `${p.label}百分位` },
]
const FIELD_OPTIONS = FIELD_GROUPS.map(g => ({
  label: g.label,
  fields: g.periods.map(p => ({ v: `${g.pre}_${p.key}`, l: g.fmt(p) })),
}))
const FIELD_LABEL = Object.fromEntries(FIELD_OPTIONS.flatMap(g => g.fields.map(f => [f.v, f.l])))
const fieldCat = f => f.split('_')[0]  // r | dd | pct
const pctColor = v => (v == null ? T.muted : v <= 20 ? T.up : v >= 80 ? T.down : '#FB923C')

export default function Market({ isMobile, watchlist, onAdd, onOpenDetail }) {
  const [fgroup, setFgroup] = useState('混合型')
  const [order, setOrder] = useState('desc')
  const [sortField, setSortField] = useState('r_1y')
  const [q, setQ] = useState('')
  // 数值条件行：[{field, min, max}]，空数组 = 无数值筛选
  const [conds, setConds] = useState([])
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const qDebounced = useDebounce(q, 400)
  const condKey = JSON.stringify(conds)

  const watched = useMemo(() => new Set(watchlist.map(w => w.code)), [watchlist])

  useEffect(() => { setPage(1) }, [fgroup, order, sortField, qDebounced, condKey])

  useEffect(() => {
    let alive = true
    setLoading(true); setErr('')
    const params = new URLSearchParams({ sort: sortField, order, page: String(page), page_size: '20' })
    if (fgroup) params.set('fgroup', fgroup)
    if (qDebounced.trim()) params.set('q', qDebounced.trim())
    for (const c of conds) {
      if (c.min !== '') params.set(`${c.field}_min`, c.min)
      if (c.max !== '') params.set(`${c.field}_max`, c.max)
    }
    api(`/market?${params}`)
      .then(d => alive && setData(d))
      .catch(e => alive && setErr(e.message))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [fgroup, order, sortField, qDebounced, condKey, page])

  const addCond = () => setConds(cs => [...cs, { field: 'r_1y', min: '', max: '' }])
  const setCond = (i, patch) => setConds(cs => cs.map((c, j) => j === i ? { ...c, ...patch } : c))
  const delCond = i => setConds(cs => cs.filter((_, j) => j !== i))
  const numOnly = s => s.replace(/[^\d.-]/g, '')

  // 表格列：固定 近1年收益 / 近1年回撤 / 百分位；排序字段同类别时把对应列临时替换为排序字段并高亮
  const cat = fieldCat(sortField)
  const cols = [
    { key: 'r_1y', label: '近1年收益', kind: 'ret' },
    { key: 'dd_1y', label: '近1年回撤', kind: 'dd' },
    { key: 'pct_1y', label: '百分位', kind: 'pct' },
  ].map(c => {
    if (c.key === sortField) return { ...c, hl: true }
    if (cat === fieldCat(c.key)) return { key: sortField, label: FIELD_LABEL[sortField], kind: c.kind, hl: true }
    return c
  })
  const cellOf = (it, c) => {
    const v = it[c.key]
    if (c.kind === 'ret') return { text: fmtPct(v), color: cellColor(v) }
    if (c.kind === 'dd') return { text: v != null ? `-${v}%` : '-', color: v != null ? '#FB923C' : T.muted }
    return { text: v != null ? `${v}%` : '-', color: pctColor(v) }
  }

  const input = { width: 90, padding: '6px 10px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 13, outline: 'none' }
  const select = { ...input, width: 'auto', cursor: 'pointer' }
  const numInput = { ...input, width: 74, textAlign: 'center' }

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>🛒 基金超市</div>
      <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 14 }}>
        全市场 {data ? data.total.toLocaleString() : '…'} 只（按当前筛选） · 快照更新 {data?.updated || '…'} · 点击行看详情
      </div>

      {/* 类型筛选（分类导航，单选芯片） */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {FGROUPS.map(g => (
          <button key={g} onClick={() => setFgroup(g)} style={{
            padding: '6px 13px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13,
            background: fgroup === g ? T.accent : T.panel, color: fgroup === g ? T.accentText : T.muted,
            fontWeight: fgroup === g ? 600 : 400,
          }}>{g || '全部'}</button>
        ))}
      </div>

      {/* 数值条件行 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 4 }}>
        {conds.map((c, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
            <select value={c.field} onChange={e => setCond(i, { field: e.target.value })} style={select}>
              {FIELD_OPTIONS.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.fields.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
                </optgroup>
              ))}
            </select>
            <label style={{ color: T.muted }}>≥ <input value={c.min} onChange={e => setCond(i, { min: numOnly(e.target.value) })} placeholder="%" style={numInput} /></label>
            <label style={{ color: T.muted }}>≤ <input value={c.max} onChange={e => setCond(i, { max: numOnly(e.target.value) })} placeholder="%" style={numInput} /></label>
            <button onClick={() => delCond(i)} title="删除条件"
              style={{ border: 'none', background: 'transparent', color: T.faint, cursor: 'pointer', fontSize: 15, padding: '2px 6px' }}>✕</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14, fontSize: 13 }}>
        <button onClick={addCond}
          style={{ padding: '5px 12px', borderRadius: 8, border: `1px dashed ${T.border}`, background: 'transparent', color: T.accent, cursor: 'pointer', fontSize: 12.5 }}>
          + 添加条件
        </button>
        {conds.length > 5 && <span style={{ color: T.faint, fontSize: 12 }}>条件较多，过严可能筛不出结果</span>}
        <span style={{ color: T.faint }}>|</span>
        <label style={{ color: T.muted }}>排序
          <select value={sortField} onChange={e => setSortField(e.target.value)} style={{ ...select, marginLeft: 6 }}>
            {FIELD_OPTIONS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.fields.map(f => <option key={f.v} value={f.v}>{f.l}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <select value={order} onChange={e => setOrder(e.target.value)} style={select}>
          <option value="desc">从高到低</option>
          <option value="asc">从低到高</option>
        </select>
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
              {cols.map(c => (
                <th key={c.key} style={{
                  textAlign: 'right', padding: '9px 8px', fontWeight: c.hl ? 700 : 500,
                  color: c.hl ? T.text : T.muted,
                }}>{c.label}</th>
              ))}
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
                {cols.map(c => {
                  const { text, color } = cellOf(it, c)
                  return (
                    <td key={c.key} style={{ textAlign: 'right', padding: '9px 8px', color, fontWeight: c.hl ? 700 : 600 }}>{text}</td>
                  )
                })}
                <td style={{ textAlign: 'right', padding: '9px 10px' }}>
                  {!watched.has(it.code) && (
                    <span onClick={e => { e.stopPropagation(); onAdd({ code: it.code, name: it.name, type: 'fund' }) }}
                      style={{ fontSize: 12, padding: '3px 10px', borderRadius: 7, background: T.panel2, color: T.accent, cursor: 'pointer' }}>+自选</span>
                  )}
                </td>
              </tr>
            ))}
            {data && !data.items.length && (
              <tr><td colSpan={3 + cols.length + 1} style={{ padding: 30, textAlign: 'center', color: T.faint }}>无符合条件的基金，放宽筛选试试</td></tr>
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
