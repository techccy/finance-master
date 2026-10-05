import React, { useEffect, useRef, useState } from 'react'
import { api, TYPE_LABEL } from '../api.js'

const badge = { stock: '#c0392b', etf: '#d35400', fund: '#1f6feb' }

export default function Sidebar({ list, selected, onToggle, onRemove, onAdd, onRefresh, syncing, isAdmin }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const timer = useRef(null)

  useEffect(() => {
    if (!q.trim()) { setResults([]); return }
    clearTimeout(timer.current)
    setSearching(true)
    timer.current = setTimeout(async () => {
      try { setResults(await api(`/search?q=${encodeURIComponent(q.trim())}`)) }
      catch { setResults([]) }
      finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [q])

  return (
    <aside style={{ width: 300, background: '#fff', borderRight: '1px solid #e4e7ec', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 16, borderBottom: '1px solid #eef0f3' }}>
        <div style={{ fontWeight: 700, fontSize: 17 }}>📌 观测列表</div>
        <div style={{ fontSize: 12, color: '#888', marginTop: 4 }}>勾选参与对比，数据每日收盘后自动更新</div>
      </div>
      <div style={{ padding: 12, borderBottom: '1px solid #eef0f3', position: 'relative' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索代码 / 名称，如 300750 或 宁德"
          style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 13 }} />
        {(searching || results.length > 0) && (
          <div style={{ position: 'absolute', left: 12, right: 12, top: 52, background: '#fff', border: '1px solid #e4e7ec', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.08)', zIndex: 10, maxHeight: 280, overflowY: 'auto' }}>
            {searching && <div style={{ padding: 10, fontSize: 13, color: '#888' }}>搜索中…</div>}
            {!searching && results.length === 0 && q && <div style={{ padding: 10, fontSize: 13, color: '#888' }}>无结果</div>}
            {results.map(r => (
              <div key={r.code + r.type} onClick={() => { onAdd(r); setQ(''); setResults([]) }}
                style={{ padding: '9px 12px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', fontSize: 13, borderBottom: '1px solid #f4f5f7' }}>
                <span style={{ fontWeight: 600 }}>{r.name}</span>
                <span style={{ color: '#888' }}>{r.code} · {TYPE_LABEL[r.type]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ padding: 20, fontSize: 13, color: '#999' }}>列表为空，先搜索添加标的</div>}
        {list.map(it => (
          <div key={it.code} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: '1px solid #f4f5f7', fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(it.code)} onChange={() => onToggle(it.code)} style={{ marginRight: 8 }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{it.name}</div>
              <div style={{ color: '#999', fontSize: 11.5 }}>{it.code} · {TYPE_LABEL[it.type]}{it.last_date ? ` · 更新 ${it.last_date}` : ' · 待同步'}</div>
            </div>
            <span onClick={() => onRemove(it.code)} style={{ color: '#c0392b', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: '1px solid #eef0f3' }}>
        {isAdmin ? (
          <button onClick={onRefresh} style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: '1px solid #d0d5dd', background: '#f9fafb', cursor: 'pointer', fontSize: 13 }}>
            {syncing ? '后台刷新中…' : '立即刷新数据'}
          </button>
        ) : (
          <div style={{ fontSize: 12, color: '#999', textAlign: 'center' }}>数据每日收盘后自动更新</div>
        )}
      </div>
    </aside>
  )
}
