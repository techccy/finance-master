// design-os 风格暗色 token（warm stone dark + lime accent）
export const T = {
  bg: '#1C1917',          // stone-900 页面背景
  panel: '#292524',       // stone-800 卡片/面板
  panel2: '#33302C',      // stone-700 悬浮/次级面板
  border: '#44403C',      // stone-600 边框
  borderSoft: '#3B3834',  // 更弱分割线
  text: '#FAFAF9',        // stone-50 主文字
  muted: '#A8A29E',       // stone-400 次文字
  faint: '#78716C',       // stone-500 弱文字
  accent: '#84CC16',      // lime-500 强调
  accentBright: '#A3E635',// lime-400
  accentText: '#1C1917',  // lime 底上的深色文字
  up: '#F87171',          // 涨（中国市场红涨）
  down: '#4ADE80',        // 跌（绿跌）
  flat: '#A8A29E',
  overlay: 'rgba(10, 9, 8, 0.75)',
  shadow: '0 12px 48px rgba(0,0,0,.45)',
}

// 图表系列色（design-os chart colors 适配暗底）
export const PALETTE = ['#A3E635', '#38BDF8', '#F472B6', '#FBBF24', '#34D399', '#A78BFA', '#FB7185', '#60A5FA']

export const TYPE_COLOR = { stock: '#F87171', etf: '#FB923C', fund: '#60A5FA' }

// ECharts 暗色公共配置
export const chartDark = {
  textStyle: { color: T.muted },
  tooltip: {
    backgroundColor: T.panel2, borderColor: T.border,
    textStyle: { color: T.text, fontSize: 12.5 },
  },
  legend: { textStyle: { color: T.muted } },
}

export const fmtPct = v => (v == null ? '-' : (v > 0 ? '+' : '') + v.toFixed(2) + '%')
export const cellColor = v => (v == null ? T.muted : v > 0 ? T.up : v < 0 ? T.down : T.muted)
