import React, { useEffect, useState } from 'react'
import { api, startDateOf, RANGE_PRESETS, TYPE_LABEL } from '../api.js'
import { T, fmtPct, cellColor } from '../theme.js'

export default function Leaderboard({ watchlist, isMobile, onOpenDetail }) {
  const [range, setRange] = useState('1y')
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const start = startDateOf(range)

  useEffect(() => {
    let alive = true
    setData(null); setErr('')
    api(`/leaderboard?start=${start}`)
      .then(d => alive && setData(d))
      .catch(e => alive && setErr(e.message))
    return () => { alive = false }
  }, [start])

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>🏆 自选池排行榜</div>
      <div style={{ fontSize: 12.5, color: T.faint, marginBottom: 14 }}>观测列表内按区间收益排名 · 点击行看详情</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {RANGE_PRESETS.map(p => (
          <button key={p.key} onClick={() => setRange(p.key)} style={{
            padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13,
            background: range === p.key ? T.accent : T.panel, color: range === p.key ? T.accentText : T.muted,
            fontWeight: range === p.key ? 600 : 400,
          }}>{p.label}</button>
        ))}
      </div>

      {err && <div style={{ padding: 20, color: T.up }}>加载失败：{err}</div>}
      {!err && !data && <div style={{ padding: 12, color: T.faint }}>加载中…（未同步的标的可能需要几十秒）</div>}
      {data && data.items.length === 0 && (
        <div style={{ padding: 40, textAlign: 'center', color: T.faint }}>自选列表为空，先去搜索添加标的</div>
      )}

      {data && data.items.length > 0 && (
        <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13.5, minWidth: isMobile ? 480 : 0 }}>
            <thead>
              <tr style={{ color: T.muted, borderBottom: `1px solid ${T.border}` }}>
                <th style={{ textAlign: 'center', padding: '9px 8px', fontWeight: 500, width: 44 }}>#</th>
                <th style={{ textAlign: 'left', padding: '9px 10px', fontWeight: 500 }}>标的</th>
                <th style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 500 }}>区间收益</th>
                <th style={{ textAlign: 'right', padding: '9px 8px', fontWeight: 500 }}>最大回撤</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it, i) => (
                <tr key={it.code} onClick={() => !it.stale && onOpenDetail(it)}
                  style={{ borderBottom: `1px solid ${T.borderSoft}`, cursor: it.stale ? 'default' : 'pointer', opacity: it.stale ? 0.55 : 1 }}
                  onMouseEnter={e => { if (!it.stale) e.currentTarget.style.background = T.panel2 }}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                  <td style={{ textAlign: 'center', padding: '10px 8px', color: i < 3 && !it.stale ? T.accent : T.faint, fontWeight: 700 }}>
                    {it.stale ? '…' : i + 1}</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ fontWeight: 600 }}>{it.name}</span>
                    <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 7 }}>{it.code} · {TYPE_LABEL[it.type]}</span>
                    {it.stale && <span style={{ fontSize: 11.5, color: T.faint, marginLeft: 6 }}>（数据未就绪）</span>}
                  </td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: cellColor(it.total_return), fontWeight: 600 }}>
                    {it.total_return != null ? fmtPct(it.total_return) : '-'}</td>
                  <td style={{ textAlign: 'right', padding: '10px 8px', color: T.up }}>
                    {it.max_drawdown != null ? `${it.max_drawdown.toFixed(2)}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
