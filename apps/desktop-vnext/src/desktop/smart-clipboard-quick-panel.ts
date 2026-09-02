import { BrowserWindow, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import type { DesktopSurfaceHostDefinition } from '../core/desktop-surface-manager.js'
import type { DesktopSurfaceDefinition } from '../core/desktop-surface-contract.js'
import type { NavigationActions } from './window-policy.js'
import { installNavigationPolicy } from './window-policy.js'
import { hardenedWebPreferences } from './window-options.js'

export const SMART_CLIPBOARD_SURFACE_ID = 'smart-clipboard.quick-retrieval'

/** Quick Panel 主列表固定宽度，预览面板在此基础上向一侧扩展。 */
const MAIN_PANEL_WIDTH = 480
/** 预览面板宽度，必须与布局返回的 placement 一致。 */
const PREVIEW_WIDTH = 256
/** 搜索栏固定高度。 */
const SEARCH_HEIGHT = 42
/** 单条历史记录行高。 */
const ROW_HEIGHT = 42
/** 底部状态栏固定高度。 */
const FOOTER_HEIGHT = 28
/** 支持的最小历史行数。 */
const MIN_ROWS = 3
/** 支持的最大历史行数。 */
const MAX_ROWS = 8
/** 光标与浮层之间的间距。 */
const POSITION_GAP = 12
/** 浮层距工作区边缘的最小安全距离。 */
const WORK_AREA_EDGE = 8

export interface SmartClipboardQuickPanelLayout {
  /** Quick Panel 显示的历史行数。 */
  readonly rows: number
  /** 是否展开右侧预览。 */
  readonly previewOpen: boolean
}

interface QuickPanelState {
  mainX: number
  y: number
  workArea: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  rows: number
  previewOpen: boolean
  placement: 'left' | 'right'
}

const states = new WeakMap<BrowserWindow, QuickPanelState>()

/** Desktop Surface 注册描述；Core 统一创建和管理窗口实例。 */
export function createSmartClipboardQuickPanelSurface(actions: NavigationActions): {
  readonly definition: DesktopSurfaceDefinition
  readonly host: DesktopSurfaceHostDefinition
} {
  return {
    definition: {
      id: SMART_CLIPBOARD_SURFACE_ID,
      kind: 'clipboard.quick-retrieval',
      content: { type: 'plugin-view', viewId: 'smart-clipboard.quick-retrieval', contract: 1 },
      window: {
        anchor: 'cursor',
        placement: 'adjacent',
        preferredSize: { width: MAIN_PANEL_WIDTH, height: panelHeight(MAX_ROWS) },
        focus: 'activate',
        topmost: true,
      },
    },
    host: {
      window: {
        title: 'Smart Clipboard',
        width: MAIN_PANEL_WIDTH,
        height: panelHeight(MAX_ROWS),
        minWidth: MAIN_PANEL_WIDTH,
        minHeight: panelHeight(MIN_ROWS),
        maxWidth: MAIN_PANEL_WIDTH + PREVIEW_WIDTH,
        maxHeight: panelHeight(MAX_ROWS),
        show: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        frame: false,
        resizable: false,
        backgroundColor: '#202124',
        webPreferences: {
          ...hardenedWebPreferences(),
          preload: fileURLToPath(new URL('./smart-clipboard-preload.cjs', import.meta.url)),
        },
      },
      eagerLoad: true,
      hideOnBlur: true,
      load: async (window) => {
        installNavigationPolicy(window, actions)
        const renderer = fileURLToPath(new URL('../quick-retrieval/index.html', import.meta.url))
        await window.loadFile(renderer)
      },
      position: (window) => { positionSmartClipboardQuickPanel(window) },
      onShown: (window) => { window.webContents.send('hermit:smart-clipboard:show') },
    },
  }
}

/** 只计算窗口位置和布局状态，显示由 Desktop Surface Manager 统一完成。 */
export function positionSmartClipboardQuickPanel(window: BrowserWindow): void {
  if (window.isDestroyed()) return
  const cursor = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursor)
  const bounds = display.workArea
  const height = panelHeight(MAX_ROWS)
  const rightX = cursor.x + POSITION_GAP
  const leftX = cursor.x - POSITION_GAP - MAIN_PANEL_WIDTH
  const x = rightX + MAIN_PANEL_WIDTH <= bounds.x + bounds.width - WORK_AREA_EDGE
    ? rightX
    : leftX >= bounds.x + WORK_AREA_EDGE
      ? leftX
      : clamp(rightX, bounds.x + WORK_AREA_EDGE, bounds.x + bounds.width - MAIN_PANEL_WIDTH - WORK_AREA_EDGE)
  const y = clamp(cursor.y + POSITION_GAP, bounds.y + WORK_AREA_EDGE, bounds.y + bounds.height - height - WORK_AREA_EDGE)
  states.set(window, { mainX: x, y, workArea: bounds, rows: MAX_ROWS, previewOpen: false, placement: 'right' })
  window.setBounds({ x, y, width: MAIN_PANEL_WIDTH, height }, false)
}

/** 根据行数和预览开关调整窗口尺寸，返回预览位于主列表左侧还是右侧。 */
export function configureSmartClipboardQuickPanel(window: BrowserWindow, input: SmartClipboardQuickPanelLayout): { readonly placement: 'left' | 'right' } {
  if (window.isDestroyed()) return { placement: 'right' }
  const state = states.get(window)
  if (state === undefined) return { placement: 'right' }
  state.rows = clamp(Math.round(input.rows), MIN_ROWS, MAX_ROWS)
  state.previewOpen = input.previewOpen
  const height = panelHeight(state.rows)
  if (!state.previewOpen) {
    state.placement = 'right'
    window.setBounds({ x: state.mainX, y: state.y, width: MAIN_PANEL_WIDTH, height }, false)
    return { placement: state.placement }
  }

  const totalWidth = MAIN_PANEL_WIDTH + PREVIEW_WIDTH
  const rightAvailable = state.workArea.x + state.workArea.width - state.mainX - MAIN_PANEL_WIDTH
  const leftAvailable = state.mainX - state.workArea.x
  const rightFits = rightAvailable >= PREVIEW_WIDTH + WORK_AREA_EDGE
  const leftFits = leftAvailable >= PREVIEW_WIDTH + WORK_AREA_EDGE
  state.placement = rightFits || !leftFits && rightAvailable >= leftAvailable ? 'right' : 'left'
  const preferredX = state.placement === 'right' ? state.mainX : state.mainX - PREVIEW_WIDTH
  const x = clamp(preferredX, state.workArea.x + WORK_AREA_EDGE, state.workArea.x + state.workArea.width - totalWidth - WORK_AREA_EDGE)
  window.setBounds({ x, y: state.y, width: totalWidth, height }, false)
  return { placement: state.placement }
}

/** 计算受支持行数对应的稳定窗口高度。 */
export function quickPanelHeightForRows(rows: number): number {
  return panelHeight(clamp(Math.round(rows), MIN_ROWS, MAX_ROWS))
}

/** 计算搜索栏、列表和底栏共同占用的窗口高度。 */
function panelHeight(rows: number): number {
  return SEARCH_HEIGHT + ROW_HEIGHT * rows + FOOTER_HEIGHT
}

/** 将布局尺寸限制在工作区允许范围内。 */
function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum))
}
