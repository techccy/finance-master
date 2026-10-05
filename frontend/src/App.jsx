import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Compare from './components/Compare.jsx'
import Overlap from './components/Overlap.jsx'

export default function App() {
  const [watchlist, setWatchlist] = useState([])
  const [selected, setSelected] = useState([])
  const [tab, setTab] = useState('compare')
  const [syncing, setSyncing] = useState(false)

  const loadWatchlist = useCallback(async () => {
    const list = await api('/watchlist')
    setWatchlist(list)
    setSelected(sel => {
      const codes = list.map(x => x.code)
      const kept = sel.filter(c => codes.includes(c))
      return kept.length ? kept : codes.slice(0, 2)
    })
  }, [])

  useEffect(() => { loadWatchlist() }, [loadWatchlist])

  const toggle = (code) =>
    setSelected(sel => sel.includes(code) ? sel.filter(c => c !== code) : [...sel, code])

  const remove = async (code) => {
    await api(`/watchlist/${code}`, { method: 'DELETE' })
    setSelected(sel => sel.filter(c => c !== code))
    loadWatchlist()
  }

  const add = async (item) => {
    await api('/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) })
    setSelected(sel => sel.includes(item.code) ? sel : [...sel, item.code])
    loadWatchlist()
  }

  const refresh = async () => {
    setSyncing(true)
    try { await api('/refresh', { method: 'POST' }); setTimeout(loadWatchlist, 6000) } finally { setTimeout(() => setSyncing(false), 1500) }
  }

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar list={watchlist} selected={selected} onToggle={toggle} onRemove={remove} onAdd={add} onRefresh={refresh} syncing={syncing} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
          {[['compare', '对比分析'], ['overlap', '持仓重叠']].map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '8px 22px', borderRadius: 8, border: '1px solid #d0d5dd', cursor: 'pointer', fontSize: 15,
              background: tab === k ? '#1f6feb' : '#fff', color: tab === k ? '#fff' : '#333', fontWeight: tab === k ? 600 : 400
            }}>{label}</button>
          ))}
        </div>
        {tab === 'compare'
          ? <Compare watchlist={watchlist} selected={selected} />
          : <Overlap watchlist={watchlist} />}
      </main>
    </div>
  )
}
