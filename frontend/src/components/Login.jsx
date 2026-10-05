import React, { useState } from 'react'
import { api } from '../api.js'

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
    <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f2f4f8' }}>
      <form onSubmit={submit} style={{ width: 340, background: '#fff', borderRadius: 14, padding: '34px 32px', boxShadow: '0 10px 40px rgba(0,0,0,.08)' }}>
        <div style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>📈 观测对比平台</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 22 }}>登录后查看你的自选</div>
        <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 6 }}>用户名</label>
        <input value={username} onChange={e => setUsername(e.target.value)} autoFocus
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14, marginBottom: 14 }} />
        <label style={{ display: 'block', fontSize: 13, color: '#555', marginBottom: 6 }}>密码</label>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14, marginBottom: 16 }} />
        {err && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <button disabled={loading} style={{ width: '100%', padding: '11px 0', borderRadius: 8, border: 'none', background: '#1f6feb', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}
