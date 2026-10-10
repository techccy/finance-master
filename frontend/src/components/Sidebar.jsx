import React from 'react'
import { TYPE_LABEL } from '../api.js'
import { T } from '../theme.js'

export default function Sidebar({ list, selected, onToggle, onRemove, onRefresh, syncing, isAdmin,
  isMobile, open, onClose, username, onOpenDetail, onShowToken, onChangePassword, onLogout }) {

  const body = (
    <>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}` }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>📌 观测列表</div>
        <div style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>勾选参与对比，数据每日收盘后自动更新</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ padding: 20, fontSize: 13, color: T.faint }}>列表为空，点 🔍 搜索添加标的</div>}
        {list.map(it => (
          <div key={it.code} onClick={() => isMobile && onToggle(it.code)}
            style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(it.code)} onChange={() => onToggle(it.code)}
              onClick={e => e.stopPropagation()}
              style={{ marginRight: 8, accentColor: T.accent, width: 17, height: 17 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span onClick={e => { e.stopPropagation(); onOpenDetail(it) }} style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}
                  title="查看详情">{it.name}</span>
                <span onClick={e => { e.stopPropagation(); onOpenDetail(it) }}
                  style={{ fontSize: 10.5, color: T.accent, border: `1px solid ${T.accent}55`, borderRadius: 5, padding: '0 5px', cursor: 'pointer', flexShrink: 0 }}>详情</span>
              </div>
              <div style={{ color: T.faint, fontSize: 11.5 }}>{it.code} · {TYPE_LABEL[it.type]}{it.last_date ? ` · 更新 ${it.last_date}` : ' · 待同步'}</div>
            </div>
            <span onClick={e => { e.stopPropagation(); onRemove(it.code) }} style={{ color: T.up, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 12, borderTop: `1px solid ${T.borderSoft}` }}>
        {isAdmin ? (
          <button onClick={onRefresh} style={{
            width: '100%', padding: '9px 0', borderRadius: 8, border: `1px solid ${T.border}`,
            background: T.panel2, color: T.text, cursor: 'pointer', fontSize: 13,
          }}>
            {syncing ? '后台刷新中…' : '立即刷新数据'}
          </button>
        ) : (
          <div style={{ fontSize: 12, color: T.faint, textAlign: 'center' }}>数据每日收盘后自动更新</div>
        )}
        {isMobile && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, fontSize: 13 }}>
            <span style={{ color: T.muted }}>{isAdmin ? '🛡️' : '👤'} {username}</span>
            <span style={{ display: 'flex', gap: 12 }}>
              <span onClick={onShowToken} style={{ color: T.accent, cursor: 'pointer' }}>Token</span>
              <span onClick={onChangePassword} style={{ color: T.accent, cursor: 'pointer' }}>改密码</span>
              <span onClick={onLogout} style={{ color: T.faint, cursor: 'pointer' }}>退出</span>
            </span>
          </div>
        )}
      </div>
    </>
  )

  if (!isMobile) {
    return (
      <aside style={{ width: 300, background: T.panel, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' }}>
        {body}
      </aside>
    )
  }

  return (
    <>
      {open && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, zIndex: 140, background: T.overlay,
          animation: 'fadeIn .2s ease-out',
        }} />
      )}
      <aside style={{
        position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 150, width: 'min(320px, 84vw)',
        background: T.panel, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column',
        transform: open ? 'translateX(0)' : 'translateX(-105%)',
        visibility: open ? 'visible' : 'hidden',
        transition: 'transform .25s ease, visibility .25s',
        boxShadow: open ? T.shadow : 'none',
      }}>
        {body}
      </aside>
    </>
  )
}
