import React, { useEffect, useRef, useState } from 'react'
import * as echarts from 'echarts'
import { api, TYPE_LABEL } from '../api.js'
import { T, chartDark, TYPE_COLOR, fmtPct, cellColor } from '../theme.js'

export default function SearchOverlay({ watchlist, onAdd, onOpenDetail, onClose, isMobile }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [quotes, setQuotes] = useState({})
  const [activeIdx, setActiveIdx] = useState(-1)
  const [preview, setPreview] = useState(null)   // {loading, data, err}
  const [added, setAdded] = useState('')
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const timer = useRef(null)
  const previewToken = useRef(0)

  const watched = new Set(watchlist.map(w => w.code))

  // 防抖搜索
  useEffect(() => {
    if (!q.trim()) { setResults([]); setQuotes({}); setActiveIdx(-1); return }
    clearTimeout(timer.current)
    setSearching(true)
    timer.current = setTimeout(async () => {
      try {
        const r = await api(`/search?q=${encodeURIComponent(q.trim())}`)
        setResults(r)
        setQuotes({})
        setActiveIdx(-1)
        if (r.length) {
          const codes = r.map(x => x.code).join(',')
          const types = r.map(x => x.type).join(',')
          api(`/quote?codes=${codes}&types=${types}`).then(setQuotes).catch(() => {})
        }
      } catch { setResults([]) }
      finally { setSearching(false) }
    }, 350)
    return () => clearTimeout(timer.current)
  }, [q])

  // 聚焦项 → 懒加载预览曲线
  useEffect(() => {
    const it = results[activeIdx]
    previewToken.current += 1
    const token = previewToken.current
    if (!it) { setPreview(null); return }
    setPreview({ loading: true, data: null, err: '' })
    api(`/preview?code=${it.code}&type=${it.type}`)
      .then(d => { if (token === previewToken.current) setPreview({ loading: false, data: d, err: '' }) })
      .catch(e => { if (token === previewToken.current) setPreview({ loading: false, data: null, err: e.message }) })
  }, [activeIdx, results])

  const add = (it) => {
    onAdd(it)
    setAdded(it.code)
    setTimeout(onClose, 650)
  }

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
    if (!results.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => (i + 1) % results.length) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => (i - 1 + results.length) % results.length) }
    if (e.key === 'Enter' && activeIdx >= 0 && !watched.has(results[activeIdx].code)) {
      e.preventDefault(); add(results[activeIdx])
    }
  }

  // 键选时滚动到可见
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  const active = activeIdx >= 0 ? results[activeIdx] : null

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, background: T.overlay,
      backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: isMobile ? '3vh' : '9vh', animation: 'fadeIn .18s ease-out',
    }} onClick={onClose}>
      <div style={{ width: 'min(880px, 92vw)', display: 'flex', flexDirection: 'column', minHeight: 0, ...(isMobile ? { maxHeight: '94vh', overflowY: 'auto' } : {}) }}
        onClick={e => e.stopPropagation()}>
        <input ref={inputRef} autoFocus value={q} onChange={e => setQ(e.target.value)} onKeyDown={onKeyDown}
          placeholder="搜索股票 / ETF / 基金 — 代码、名称或拼音缩写"
          style={{
            width: '100%', boxSizing: 'border-box', padding: '16px 20px', fontSize: isMobile ? 16 : 19, borderRadius: 12,
            border: `1px solid ${T.border}`, background: T.panel, color: T.text, outline: 'none',
            boxShadow: T.shadow,
          }} />
        <div style={{ fontSize: 12, color: T.faint, margin: '8px 4px 0', height: 16 }}>
          {searching ? '搜索中…' : q.trim() && !results.length ? '无结果' :
            q.trim() ? (isMobile ? `${results.length} 个结果` : `${results.length} 个结果 · ↑↓ 选择 · Enter 加入 · Esc 关闭`)
              : (isMobile ? '输入以搜索，点击结果加入列表' : '输入以搜索 · Enter 加入 · Esc 关闭')}
        </div>

        <div style={{ display: 'flex', gap: 14, marginTop: 10, minHeight: 0, alignItems: 'stretch', flexDirection: isMobile ? 'column' : 'row' }}>
          {/* 结果列表 */}
          <div ref={listRef} style={{
            flex: '1 1 52%', maxHeight: isMobile ? '36vh' : '58vh', overflowY: 'auto', background: T.panel,
            border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadow,
          }}>
            {results.map((r, i) => {
              const qt = quotes[r.code]
              const inList = watched.has(r.code) || added === r.code
              return (
                <div key={r.code + r.type} data-idx={i} onMouseEnter={() => setActiveIdx(i)}
                  onClick={() => setActiveIdx(i)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '11px 14px', cursor: 'pointer',
                    borderBottom: `1px solid ${T.borderSoft}`,
                    background: i === activeIdx ? T.panel2 : 'transparent',
                  }}>
                  <span style={{
                    fontSize: 11, padding: '2px 7px', borderRadius: 6, flexShrink: 0,
                    color: TYPE_COLOR[r.type], border: `1px solid ${TYPE_COLOR[r.type]}55`,
                    background: `${TYPE_COLOR[r.type]}14`,
                  }}>{TYPE_LABEL[r.type]}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                    <div style={{ fontSize: 11.5, color: T.faint }}>{r.code}{qt?.date ? ` · ${qt.date}` : ''}</div>
                  </div>
                  {inList ? (
                    <span style={{ fontSize: 12, color: T.accent }}>已在列表 ✓</span>
                  ) : qt && (
                    <span style={{ textAlign: 'right', flexShrink: 0 }}>
                      <span style={{ fontSize: 13.5, fontWeight: 600 }}>{qt.value ?? '-'}</span>
                      <span style={{ fontSize: 12, marginLeft: 7, color: cellColor(qt.change_pct) }}>{fmtPct(qt.change_pct)}</span>
                    </span>
                  )}
                  {i === activeIdx && !inList && (
                    <span onClick={e => { e.stopPropagation(); add(r) }} style={{
                      fontSize: 12, padding: '4px 10px', borderRadius: 7, background: T.accent,
                      color: T.accentText, fontWeight: 600, flexShrink: 0,
                    }}>加入</span>
                  )}
                </div>
              )
            })}
          </div>

          {/* 详情面板 */}
          <div style={{
            flex: '1 1 48%', maxHeight: isMobile ? 'none' : '58vh', overflowY: 'auto', background: T.panel,
            border: `1px solid ${T.border}`, borderRadius: 12, boxShadow: T.shadow, padding: '16px 18px',
          }}>
            {!active && (
              <div style={{ height: '100%', minHeight: isMobile ? 120 : 240, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: T.faint, fontSize: 13, textAlign: 'center' }}>
                <div style={{ fontSize: 28, marginBottom: 10 }}>🔍</div>
                {isMobile ? '点击结果在这里查看走势，确认后加入' : <>↑↓ 或悬停选择标的<br />这里会显示近半年走势，确认后加入</>}
              </div>
            )}
            {active && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ fontSize: 11, padding: '2px 7px', borderRadius: 6, color: TYPE_COLOR[active.type], border: `1px solid ${TYPE_COLOR[active.type]}55` }}>{TYPE_LABEL[active.type]}</span>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{active.name}</span>
                  <span style={{ fontSize: 12.5, color: T.faint }}>{active.code}</span>
                </div>
                {quotes[active.code] && (
                  <div style={{ fontSize: 13.5, margin: '6px 0 12px' }}>
                    最新 {quotes[active.code].date || ''}：
                    <b style={{ fontSize: 16 }}>{quotes[active.code].value ?? '-'}</b>
                    <b style={{ marginLeft: 8, color: cellColor(quotes[active.code].change_pct) }}>{fmtPct(quotes[active.code].change_pct)}</b>
                  </div>
                )}
                {preview?.loading && <div style={{ color: T.faint, fontSize: 13, padding: '20px 0' }}>曲线加载中…</div>}
                {preview?.err && <div style={{ color: T.up, fontSize: 13, padding: '10px 0' }}>曲线获取失败：{preview.err}</div>}
                {preview?.data && <PreviewChart points={preview.data.points} />}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={() => !watched.has(active.code) && add(active)} disabled={watched.has(active.code)}
                    style={{
                      flex: 1, padding: '10px 0', marginTop: 12, borderRadius: 9, border: 'none', cursor: 'pointer',
                      fontSize: 14, fontWeight: 600, background: watched.has(active.code) ? T.panel2 : T.accent,
                      color: watched.has(active.code) ? T.faint : T.accentText,
                    }}>
                    {watched.has(active.code) ? '已在观测列表' : '加入观测列表'}
                  </button>
                  <button onClick={() => { onOpenDetail({ code: active.code, name: active.name, type: active.type }); onClose() }}
                    style={{
                      flex: 1, padding: '10px 0', marginTop: 12, borderRadius: 9, cursor: 'pointer',
                      fontSize: 14, fontWeight: 600, background: T.panel2, color: T.text, border: `1px solid ${T.border}`,
                    }}>
                    查看详情 →
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function PreviewChart({ points }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!ref.current) return
    const c = echarts.init(ref.current)
    const vals = points.map(p => p[1])
    const first = vals[0]
    c.setOption({
      ...chartDark,
      grid: { left: 52, right: 12, top: 14, bottom: 26 },
      xAxis: { type: 'category', data: points.map(p => p[0]), axisLabel: { fontSize: 10, color: T.faint }, axisLine: { lineStyle: { color: T.borderSoft } } },
      yAxis: { type: 'value', scale: true, axisLabel: { fontSize: 10, color: T.faint }, splitLine: { lineStyle: { color: T.borderSoft } } },
      series: [{
        type: 'line', data: vals, showSymbol: false,
        lineStyle: { color: T.accentBright, width: 1.8 },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: 'rgba(163,230,53,.25)' }, { offset: 1, color: 'rgba(163,230,53,0)' } ] } },
        markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: T.faint, type: 'dashed' }, data: [{ yAxis: first }] },
      }],
    })
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(ref.current)
    return () => { ro.disconnect(); c.dispose() }
  }, [points])
  const ret = points.length > 1 ? (points[points.length - 1][1] / points[0][1] - 1) * 100 : null
  return (
    <>
      <div ref={ref} style={{ width: '100%', height: 190 }} />
      {ret != null && (
        <div style={{ fontSize: 12.5, color: T.faint, marginTop: 4 }}>
          近半年区间收益 <b style={{ color: cellColor(ret) }}>{fmtPct(ret)}</b>（基金为复权净值口径）
        </div>
      )}
    </>
  )
}
