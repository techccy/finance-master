import React from 'react'
import { TYPE_LABEL } from '../api.js'
import { T } from '../theme.js'

export default function Sidebar({ list, selected, onToggle, onRemove, onRefresh, syncing, isAdmin }) {
  return (
    <aside style={{ width: 300, background: T.panel, borderRight: `1px solid ${T.border}`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${T.borderSoft}` }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>📌 观测列表</div>
        <div style={{ fontSize: 12, color: T.faint, marginTop: 4 }}>勾选参与对比，数据每日收盘后自动更新</div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {list.length === 0 && <div style={{ padding: 20, fontSize: 13, color: T.faint }}>列表为空，按 ⌘K 或点顶栏搜索添加标的</div>}
        {list.map(it => (
          <div key={it.code} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', borderBottom: `1px solid ${T.borderSoft}`, fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(it.code)} onChange={() => onToggle(it.code)}
              style={{ marginRight: 8, accentColor: T.accent }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
              <div style={{ color: T.faint, fontSize: 11.5 }}>{it.code} · {TYPE_LABEL[it.type]}{it.last_date ? ` · 更新 ${it.last_date}` : ' · 待同步'}</div>
            </div>
            <span onClick={() => onRemove(it.code)} style={{ color: T.up, cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</span>
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
      </div>
    </aside>
  )
}
