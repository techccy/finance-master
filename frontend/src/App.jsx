import React, { useCallback, useEffect, useState } from 'react'
import { api } from './api.js'
import Sidebar from './components/Sidebar.jsx'
import Compare from './components/Compare.jsx'
import Overlap from './components/Overlap.jsx'
import Admin from './components/Admin.jsx'
import Login from './components/Login.jsx'
import PasswordModal from './components/PasswordModal.jsx'
import SearchOverlay from './components/SearchOverlay.jsx'
import { T } from './theme.js'

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
  const [showSearch, setShowSearch] = useState(false)

  useEffect(() => {
    api('/me').then(({ user: u }) => setUser(u ?? undefined)).catch(() => setUser(undefined))
    const onLogout = () => setUser(undefined)
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  // ⌘K / Ctrl+K 唤起全屏搜索
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setShowSearch(s => !s)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: T.bg, color: T.text }}>
      {/* 顶栏：搜索 + tabs + 用户区 */}
      <header style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '10px 20px',
        borderBottom: `1px solid ${T.border}`, background: T.panel, flexShrink: 0,
      }}>
        <div style={{ fontWeight: 700, fontSize: 16, whiteSpace: 'nowrap' }}>📈 观测对比</div>
        <div onClick={() => setShowSearch(true)} style={{
          display: 'flex', alignItems: 'center', gap: 8, width: 340, padding: '7px 12px',
          borderRadius: 9, border: `1px solid ${T.border}`, background: T.bg, color: T.faint,
          fontSize: 13, cursor: 'text', userSelect: 'none',
        }}>
          <span>🔍</span>
          <span style={{ flex: 1 }}>搜索股票 / ETF / 基金…</span>
          <kbd style={{ fontSize: 11, padding: '1px 6px', borderRadius: 5, border: `1px solid ${T.border}`, color: T.faint }}>⌘K</kbd>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} style={{
              padding: '7px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 14,
              background: tab === k ? T.accent : 'transparent', color: tab === k ? T.accentText : T.muted,
              fontWeight: tab === k ? 600 : 400,
            }}>{label}</button>
          ))}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 14, fontSize: 13.5 }}>
          <span style={{ color: T.muted }}>{user.is_admin ? '🛡️' : '👤'} {user.username}</span>
          <span onClick={() => setShowPw(true)} style={{ color: T.accent, cursor: 'pointer' }}>修改密码</span>
          <span onClick={logout} style={{ color: T.faint, cursor: 'pointer' }}>退出</span>
        </div>
      </header>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <Sidebar list={watchlist} selected={selected} onToggle={toggle} onRemove={remove}
          onRefresh={refresh} syncing={syncing} isAdmin={user.is_admin} />
        <main style={{ flex: 1, overflowY: 'auto', padding: '20px 28px' }}>
          {tab === 'compare' && <Compare watchlist={watchlist} selected={selected} />}
          {tab === 'overlap' && <Overlap watchlist={watchlist} />}
          {tab === 'admin' && user.is_admin && <Admin />}
        </main>
      </div>

      {showSearch && <SearchOverlay watchlist={watchlist} onAdd={add} onClose={() => setShowSearch(false)} />}
      {showPw && <PasswordModal onClose={() => setShowPw(false)} />}
    </div>
  )
}
