import React, { useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function PasswordModal({ onClose }) {
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [newPw2, setNewPw2] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (newPw !== newPw2) { setErr('两次输入的新密码不一致'); return }
    try {
      await api('/me/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ old_password: oldPw, new_password: newPw }) })
      setOk(true)
      setTimeout(onClose, 900)
    } catch (e2) { setErr(e2.message) }
  }

  const overlay = { position: 'fixed', inset: 0, background: T.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }
  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.bg, color: T.text, fontSize: 14, marginBottom: 12, outline: 'none' }

  return (
    <div style={overlay} onClick={onClose}>
      <form onClick={e => e.stopPropagation()} onSubmit={submit}
        style={{ width: 320, background: T.panel, borderRadius: 12, padding: '26px 26px 22px', border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 16 }}>修改密码</div>
        {ok ? <div style={{ color: T.down, fontSize: 14 }}>已修改 ✓</div> : (
          <>
            <input type="password" value={oldPw} onChange={e => setOldPw(e.target.value)} placeholder="原密码" autoFocus style={input} />
            <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="新密码（至少 4 位）" style={input} />
            <input type="password" value={newPw2} onChange={e => setNewPw2(e.target.value)} placeholder="确认新密码" style={input} />
            {err && <div style={{ color: T.up, fontSize: 13, marginBottom: 10 }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose} style={{ padding: '8px 16px', borderRadius: 8, border: `1px solid ${T.border}`, background: T.panel2, color: T.muted, cursor: 'pointer', fontSize: 14 }}>取消</button>
              <button style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: T.accent, color: T.accentText, cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>确定</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
