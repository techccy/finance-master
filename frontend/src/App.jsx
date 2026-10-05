import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Compare from './components/Compare.jsx'
import Overlap from './components/Overlap.jsx'
import Admin from './components/Admin.jsx'
import Login from './components/Login.jsx'
import PasswordModal from './components/PasswordModal.jsx'

const TABS = [
  ['compare', '对比分析'],
  ['overlap', '持仓重叠'],
]

export default function App() {
  const [user, setUser] = useState(null)          // null=未加载, undefined=未登录
  const [watchlist, setWatchlist] = useState([])
  const [selected, setSelected] = useState([])
  const [tab, setTab] = useState('compare')
  const [syncing, setSyncing] = useState(false)
  const [showPw, setShowPw] = useState(false)

  useEffect(() => {
    api('/me').then(({ user: u }) => setUser(u ?? undefined)).catch(() => setUser(undefined))
    const onLogout = () => setUser(undefined)
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  const logout = async () => {
    try { await api('/logout', { method: 'POST' }) } catch {}
    setUser(undefined)
  }

  const loadWatchlist = useCallback(async () => {
    const list = await api('/watchlist')
    setWatchlist(list)
    setSelected(sel => {
      const codes = list.map(x => x.code)
      const kept = sel.filter(c => codes.includes(c))
      return kept.length ? kept : codes.slice(0, 2)
    })
  }, [])

  useEffect(() => {
    if (user) loadWatchlist().catch(() => {})
  }, [user, loadWatchlist])

  if (user === null) return null
  if (!user) return <Login onLogin={setUser} />

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

  const tabs = user.is_admin ? [...TABS, ['admin', '账号管理']] : TABS

  return (
    <div style={{ display: 'flex', height: '100vh' }}>
      <Sidebar list={watchlist} selected={selected} onToggle={toggle} onRemove={remove} onAdd={add}
        onRefresh={refresh} syncing={syncing} isAdmin={user.is_admin} />
      <main style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            {tabs.map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)} style={{
                padding: '8px 22px', borderRadius: 8, border: '1px solid #d0d5dd', cursor: 'pointer', fontSize: 15,
                background: tab === k ? '#1f6feb' : '#fff', color: tab === k ? '#fff' : '#333', fontWeight: tab === k ? 600 : 400
              }}>{label}</button>
            ))}
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, fontSize: 13.5 }}>
            <span style={{ color: '#555' }}>{user.is_admin ? '🛡️' : '👤'} {user.username}</span>
            <span onClick={() => setShowPw(true)} style={{ color: '#1f6feb', cursor: 'pointer' }}>修改密码</span>
            <span onClick={logout} style={{ color: '#888', cursor: 'pointer' }}>退出</span>
          </div>
        </div>
        {tab === 'compare' && <Compare watchlist={watchlist} selected={selected} />}
        {tab === 'overlap' && <Overlap watchlist={watchlist} />}
        {tab === 'admin' && user.is_admin && <Admin />}
      </main>
      {showPw && <PasswordModal onClose={() => setShowPw(false)} />}
    </div>
  )
}
