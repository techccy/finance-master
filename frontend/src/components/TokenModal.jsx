import React, { useEffect, useState } from 'react'
import { api } from '../api.js'
import { T } from '../theme.js'

export default function TokenModal({ onClose }) {
  const [info, setInfo] = useState(null)          // {exists, created_at}
  const [token, setToken] = useState('')          // 新生成明文（只显示一次）
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api('/me/token').then(setInfo).catch(e => setErr(e.message))
  }, [])

  const generate = async () => {
    setBusy(true); setErr(''); setCopied(false)
    try {
      const { token: t } = await api('/me/token', { method: 'POST' })
      setToken(t)
      setInfo({ exists: true, created_at: new Date().toISOString().slice(0, 16).replace('T', ' ') })
    } catch (e) { setErr(e.message) }
    finally { setBusy(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(token); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch {}
  }

  const overlay = { position: 'fixed', inset: 0, background: T.overlay, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }
  const btn = { padding: '9px 16px', borderRadius: 8, border: 'none', background: T.accent, color: T.accentText, cursor: 'pointer', fontSize: 14, fontWeight: 600 }

  return (
    <div style={overlay} onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ width: 'min(440px, calc(100vw - 32px))', background: T.panel, borderRadius: 12, padding: '26px 26px 22px', border: `1px solid ${T.border}`, boxShadow: T.shadow }}>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 6 }}>Agent API Token</div>
        <div style={{ fontSize: 12.5, color: T.faint, lineHeight: 1.7, marginBottom: 14 }}>
          给 AI Agent（或其他程序）用的访问凭证，权限等同你的账号：可读全部数据、增删自选。
          请求时携带 <code style={{ color: T.accent }}>Authorization: Bearer &lt;token&gt;</code>。
          接口文档：<a href="/agent.md" target="_blank" rel="noreferrer" style={{ color: T.accent }}>/agent.md</a>
        </div>

        {err && <div style={{ color: T.up, fontSize: 13, marginBottom: 10 }}>{err}</div>}

        {!info && !err && <div style={{ color: T.faint, fontSize: 13 }}>加载中…</div>}

        {info && !token && (
          <div style={{ fontSize: 13.5, lineHeight: 1.9 }}>
            <div>{info.exists
              ? <>当前已有 token（创建于 {info.created_at}），重新生成会使旧 token 立即失效。</>
              : '尚未生成 token。'}</div>
            <button onClick={generate} disabled={busy} style={{ ...btn, marginTop: 12, opacity: busy ? 0.6 : 1 }}>
              {busy ? '生成中…' : info.exists ? '重新生成 Token' : '生成 Token'}</button>
          </div>
        )}

        {token && (
          <div>
            <div style={{ fontSize: 12.5, color: '#FB923C', marginBottom: 8 }}>⚠️ 明文只显示这一次，请立即复制保存：</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, padding: '10px 12px', borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, fontSize: 12.5, wordBreak: 'break-all', color: T.text }}>{token}</code>
              <button onClick={copy} style={{ ...btn, flexShrink: 0, background: copied ? T.panel2 : T.accent, color: copied ? T.muted : T.accentText, border: copied ? `1px solid ${T.border}` : 'none' }}>
                {copied ? '已复制 ✓' : '复制'}</button>
            </div>
            <button onClick={onClose} style={{ marginTop: 14, width: '100%', padding: '9px 0', borderRadius: 8, border: `1px solid ${T.border}`, background: T.panel2, color: T.muted, cursor: 'pointer', fontSize: 14 }}>完成</button>
          </div>
        )}
      </div>
    </div>
  )
}
