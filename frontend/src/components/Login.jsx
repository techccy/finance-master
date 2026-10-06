import React, { useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr(''); setLoading(true)
    try {
      await api('/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      const { user } = await api('/me')
      onLogin(user)
    } catch (e2) {
      setErr(e2.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ height: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: T.bg, padding: 16, boxSizing: 'border-box' }}>
      <form onSubmit={submit} style={{ width: 'min(340px, 100%)', background: T.panel, borderRadius: 14, padding: '34px 32px', border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>📈 观测对比平台</div>
        <div style={{ fontSize: 13, color: T.faint, marginBottom: 22 }}>登录后查看你的自选</div>
        <label style={{ display: 'block', fontSize: 13, color: T.muted, marginBottom: 6 }}>用户名</label>
        <input value={username} onChange={e => setUsername(e.target.value)} autoFocus
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 14, marginBottom: 14, outline: 'none' }} />
        <label style={{ display: 'block', fontSize: 13, color: T.muted, marginBottom: 6 }}>密码</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 14, marginBottom: 16, outline: 'none' }} />
        {err && <div style={{ color: T.up, fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button disabled={loading} style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', background: T.accent, color: T.accentText, fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
