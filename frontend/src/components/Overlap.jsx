import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function Overlap({ watchlist }) {
  const funds = watchlist.filter(w => w.type === 'fund')
  const [sel, setSel] = useState([])
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { setSel(s => s.filter(c => funds.some(f => f.code === c))) }, [funds.length])

  const analyze = async () => {
    setErr(''); setData(null)
    try { setData(await api(`/overlap?codes=${sel.join(',')}`)) }
    catch (e) { setErr(e.message) }
  }

  if (funds.length < 2)
    return <div style={{ padding: 40, textAlign: 'center', color: T.faint }}>持仓重叠需要至少 2 只场外基金，请按 ⌘K 搜索添加</div>

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {funds.map(f => (
          <button key={f.code} onClick={() => setSel(s => s.includes(f.code) ? s.filter(c => c !== f.code) : [...s, f.code])}
            style={{
              padding: '6px 14px', borderRadius: 999, border: 'none', cursor: 'pointer', fontSize: 13,
              background: sel.includes(f.code) ? T.accent : T.panel, color: sel.includes(f.code) ? T.accentText : T.muted,
              fontWeight: sel.includes(f.code) ? 600 : 400,
            }}>{f.name}</button>
        ))}
        <button onClick={analyze} disabled={sel.length < 2} style={{
          padding: '7px 20px', borderRadius: 8, border: 'none', cursor: sel.length < 2 ? 'not-allowed' : 'pointer',
          background: sel.length < 2 ? T.panel2 : T.accent, color: sel.length < 2 ? T.faint : T.accentText,
          fontWeight: 600, fontSize: 13,
        }}>分析重叠</button>
        <span style={{ fontSize: 12.5, color: T.faint }}>基于最近季报股票持仓明细，重叠度 = 共同持仓取较小权重求和</span>
      </div>

      {err && <div style={{ padding: 14, color: T.up }}>{err}</div>}

      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.pairs.map(p => (
            <div key={p.a + p.b} style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <div style={{ fontWeight: 700 }}>{p.a_name} × {p.b_name}</div>
                <div style={{ fontSize: 13 }}>季报口径 {p.quarters} · 重叠度 <b style={{ color: p.overlap >= 40 ? T.up : p.overlap >= 20 ? '#FB923C' : T.down, fontSize: 16 }}>{p.overlap}%</b></div>
              </div>
              {p.common.length === 0 ? (
                <div style={{ color: T.faint, fontSize: 13 }}>两只基金最近季报没有共同持仓</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr style={{ color: T.muted, borderBottom: `1px solid ${T.border}` }}>
                    <th style={{ textAlign: 'left', padding: '6px' }}>共同持仓</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>{p.a_name}</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>{p.b_name}</th>
                    <th style={{ textAlign: 'right', padding: '6px' }}>计入重叠</th>
                  </tr></thead>
                  <tbody>
                    {p.common.map(h => (
                      <tr key={h.name} style={{ borderBottom: `1px solid ${T.borderSoft}` }}>
                        <td style={{ padding: '7px 6px' }}>{h.name}</td>
                        <td style={{ textAlign: 'right', padding: '7px 6px' }}>{h.a}%</td>
                        <td style={{ textAlign: 'right', padding: '7px 6px' }}>{h.b}%</td>
                        <td style={{ textAlign: 'right', padding: '7px 6px', fontWeight: 600 }}>{Math.min(h.a, h.b)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
          <div style={{ background: T.panel, borderRadius: 12, border: `1px solid ${T.border}`, padding: '14px 18px' }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>各基金最新季报股票持仓</div>
            {data.funds.map(f => (
              <div key={f.code} style={{ marginBottom: 10, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>{f.name} <span style={{ color: T.faint, fontWeight: 400 }}>（{f.quarter.replace('股票投资明细', '')}）</span></div>
                <div style={{ color: T.muted }}>{f.holdings.map(h => `${h.name} ${h.ratio}%`).join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
