import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'

const th = { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e4e7ec', fontSize: 13, color: '#555' }
const td = { padding: '10px 12px', borderBottom: '1px solid #f0f2f5', fontSize: 13.5 }

export default function Admin() {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setUsers(await api('/admin/users'))
  }, [])
  useEffect(() => { load() }, [load])

  const create = async (e) => {
    e.preventDefault()
    setMsg(''); setErr('')
    try {
      await api('/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) })
      setMsg(`已创建账号 ${username.trim()}`)
      setUsername(''); setPassword('')
      load()
    } catch (e2) { setErr(e2.message) }
  }

  const resetPw = async (u) => {
    const np = window.prompt(`为 ${u.username} 设置新密码（至少 4 位）`)
    if (!np) return
    setMsg(''); setErr('')
    try {
      await api(`/admin/users/${u.id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_password: np }) })
      setMsg(`已重置 ${u.username} 的密码，该用户需重新登录`)
    } catch (e2) { setErr(e2.message) }
  }

  const del = async (u) => {
    if (!window.confirm(`确定删除账号 ${u.username}？其自选（${u.watch_count} 条）将被一并删除。`)) return
    setMsg(''); setErr('')
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' })
      setMsg(`已删除 ${u.username}`)
      load()
    } catch (e2) { setErr(e2.message) }
  }

  return (
    <div style={{ maxWidth: 720 }}>
      <h2 style={{ margin: '0 0 16px', fontSize: 19 }}>👤 账号管理</h2>
      {(msg || err) && <div style={{ marginBottom: 12, fontSize: 13.5, color: err ? '#c0392b' : '#1e8e3e' }}>{err || msg}</div>}
      <form onSubmit={create} style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="用户名"
          style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14 }} />
        <input value={password} onChange={e => setPassword(e.target.value)} placeholder="密码（至少 4 位）"
          style={{ flex: 1.4, padding: '9px 12px', borderRadius: 8, border: '1px solid #d0d5dd', fontSize: 14 }} />
        <button style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: '#1f6feb', color: '#fff', fontSize: 14, cursor: 'pointer' }}>新建账号</button>
      </form>
      <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', borderRadius: 10, overflow: 'hidden' }}>
        <thead><tr><th style={th}>用户名</th><th style={th}>角色</th><th style={th}>自选数</th><th style={th}>创建时间</th><th style={th}>操作</th></tr></thead>
        <tbody>
          {users.map(u => (
            <tr key={u.id}>
              <td style={{ ...td, fontWeight: 600 }}>{u.username}</td>
              <td style={td}>{u.is_admin ? '管理员' : '普通用户'}</td>
              <td style={td}>{u.watch_count}</td>
              <td style={{ ...td, color: '#888' }}>{u.created_at}</td>
              <td style={td}>
                <span onClick={() => resetPw(u)} style={{ color: '#1f6feb', cursor: 'pointer', marginRight: 14 }}>重置密码</span>
                {!u.is_admin && <span onClick={() => del(u)} style={{ color: '#c0392b', cursor: 'pointer' }}>删除</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
