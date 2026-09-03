import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { QuickSessionOwnerProps } from './contract.ts'

type QuickSurfaceOverlayProps = PropsRuntime<'shell.overlay'> & PropsRenderSlots<'conversation.quick.session'>

/**
 * Surface 渲染器放在 shell overlay 中，让宿主窗口继续使用单棵 DSH runtime 树。
 * 选中 Session 前保留底层工作区；选中后由轻量页面接管 Surface 内容。
 */
export function QuickSurfaceOverlay({ useSessions, renderSlot }: QuickSurfaceOverlayProps) {
  const surface = new URLSearchParams(window.location.search).get('hermitSurface')
  if (surface !== 'conversation.quick' && surface !== 'approval.companion') return null
  const current = useSessions((state) => state.current)
  if (current === undefined) return null
  return (
    <div data-quick-surface-overlay>
      {renderSlot('conversation.quick.session', {} satisfies QuickSessionOwnerProps)}
    </div>
  )
}
