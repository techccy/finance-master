export async function api(path, opts) {
  const r = await fetch(`/api${path}`, opts)
  if (!r.ok) {
    let msg = `HTTP ${r.status}`
    try { msg = (await r.json()).detail || msg } catch {}
    throw new Error(msg)
  }
  return r.json()
}

export const TYPE_LABEL = { stock: '股票', etf: 'ETF', fund: '基金' }

export const RANGE_PRESETS = [
  { key: '1m', label: '近1月', days: 30 },
  { key: '3m', label: '近3月', days: 91 },
  { key: '6m', label: '近6月', days: 182 },
  { key: 'ytd', label: '今年来', days: 'ytd' },
  { key: '1y', label: '近1年', days: 365 },
  { key: '3y', label: '近3年', days: 1095 },
]

export function startDateOf(preset) {
  const now = new Date()
  const p = RANGE_PRESETS.find(x => x.key === preset)
  if (p.days === 'ytd') return `${now.getFullYear()}-01-01`
  const d = new Date(now.getTime() - p.days * 86400000)
  return d.toISOString().slice(0, 10)
}
