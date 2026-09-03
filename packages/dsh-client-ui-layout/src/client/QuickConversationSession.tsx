import { useEffect, useRef, useState } from 'react'
import type { ConversationSnapshot, PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { ContentBlock } from '@deepseek-ai/dsh-client-connection/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconCloseOutline16, IconNewChatOutline16, IconRightUpOutline16, IconSendOutline16, MarkdownText, MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import { getDesktopSurfaceClient } from './contract.ts'
import { APPROVAL_COMPANION_SIZE, CONVERSATION_QUICK_CHAT_SIZE, CONVERSATION_QUICK_COMPOSER_SIZE } from './quick-surface-constants.ts'
import css from './QuickSurface.module.css'

type QuickSessionProps = PropsRuntime<'conversation.quick.session'>

const QUICK_SURFACE = 'conversation.quick'
const APPROVAL_SURFACE = 'approval.companion'

export function QuickConversationSession({
  sessionId,
  useSession,
  useInput,
  inputActions,
}: QuickSessionProps) {
  const surface = new URLSearchParams(window.location.search).get('hermitSurface')
  const snapshot = useSession((state) => state)
  const input = useInput((state) => state)
  const desktopSurface = getDesktopSurfaceClient()
  const approval = snapshot?.pending.find((item) => item.kind === 'approval')
  const chat = snapshot !== undefined && (
    snapshot.blank === false
    || snapshot.running
    || snapshot.partial !== null
    || snapshot.chat.legacy.nodes.length > 0
  )

  useEffect(() => {
    if (desktopSurface === undefined) return
    if (surface === APPROVAL_SURFACE) {
      void desktopSurface.resize(APPROVAL_SURFACE, APPROVAL_COMPANION_SIZE)
      return
    }
    void desktopSurface.resize(QUICK_SURFACE, chat ? CONVERSATION_QUICK_CHAT_SIZE : CONVERSATION_QUICK_COMPOSER_SIZE)
  }, [chat, desktopSurface, surface])

  useEffect(() => {
    if (surface !== QUICK_SURFACE || desktopSurface === undefined || sessionId === undefined) return
    if (approval === undefined) return
    void desktopSurface.open(APPROVAL_SURFACE, {
      preferredSize: APPROVAL_COMPANION_SIZE,
      session: { type: 'existing', sessionId },
    })
  }, [approval?.key, desktopSurface, sessionId, surface])

  useEffect(() => {
    if (surface !== APPROVAL_SURFACE || desktopSurface === undefined || approval !== undefined) return
    void desktopSurface.close(APPROVAL_SURFACE)
  }, [approval, desktopSurface, surface])

  useEffect(() => {
    if (surface !== QUICK_SURFACE || desktopSurface === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      void desktopSurface.close(QUICK_SURFACE)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [desktopSurface, surface])

  if (surface === APPROVAL_SURFACE) {
    return <ApprovalCompanion approval={approval} desktopSurface={desktopSurface} />
  }
  if (surface !== QUICK_SURFACE) return null
  return (
    <section className={css.surface} data-quick-session data-quick-state={chat ? 'chat' : 'composer'} data-hermit-drag-region>
      {chat && sessionId !== undefined
        ? <QuickHeader sessionId={sessionId} desktopSurface={desktopSurface} />
        : <div className={css.dragRegion} data-hermit-drag-region />}
      {chat && <QuickTranscript snapshot={snapshot} />}
      <QuickComposer draft={input?.draft ?? ''} inputActions={inputActions} chat={chat} />
      <div className={css.disclaimer}>内容由 AI 生成，仅供参考</div>
    </section>
  )
}

function QuickHeader({ sessionId, desktopSurface }: { sessionId: string; desktopSurface: ReturnType<typeof getDesktopSurfaceClient> }) {
  const startNew = (): void => {
    if (desktopSurface === undefined) return
    void desktopSurface.open(QUICK_SURFACE, {
      preferredSize: CONVERSATION_QUICK_COMPOSER_SIZE,
      session: { type: 'new-on-submit' },
    })
  }
  const openMain = (): void => {
    if (desktopSurface === undefined) return
    void desktopSurface.openMainSession(sessionId).then((result) => {
      if (result.status === 'opened') void desktopSurface.close(QUICK_SURFACE)
    })
  }
  return (
    <header className={css.header} data-hermit-drag-region>
      <div className={css.headerActions} data-hermit-no-drag>
        <Button type="button" variant="ghost" size="sm" icon={<IconNewChatOutline16 size={18} />} aria-label="新建对话" title="新建对话" data-quick-new-chat onClick={startNew} />
        <Button type="button" variant="ghost" size="sm" icon={<IconRightUpOutline16 size={18} />} aria-label="打开主窗口" title="打开主窗口" data-quick-open-main onClick={openMain} />
      </div>
    </header>
  )
}

function QuickTranscript({ snapshot }: { snapshot: ConversationSnapshot | undefined }) {
  const nodes = snapshot?.chat.legacy.nodes ?? []
  return (
    <div className={css.transcript} data-quick-chat>
      {nodes.map((node) => {
        const text = node.kind === 'assistant'
          ? node.blocks.filter((block) => block.kind === 'text' || block.kind === 'reasoning').map((block) => block.text).join('\n')
          : 'content' in node ? extractText(node.content) : ''
        if (text === '') return null
        return (
          <article className={node.kind === 'user' || node.kind === 'steering' ? css.userMessage : css.assistantMessage} key={`${node.kind}:${node.seq}`}>
            {node.kind === 'assistant' ? <MarkdownText text={text} /> : <MessageText text={text} />}
          </article>
        )
      })}
      {snapshot?.partial !== null && snapshot?.partial !== undefined && (
        <article className={css.assistantMessage} data-quick-streaming>
          <MarkdownText text={snapshot.partial.blocks.filter((block) => block.kind === 'text' || block.kind === 'reasoning').map((block) => block.text).join('\n')} streaming />
        </article>
      )}
    </div>
  )
}

function QuickComposer({ draft, inputActions, chat }: { draft: string; inputActions: QuickSessionProps['inputActions']; chat: boolean }) {
  const [focused, setFocused] = useState(false)
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const submit = (): void => {
    if (inputActions === undefined || draft.trim() === '') return
    inputActions.submit()
  }
  return (
    <div className={css.composer} data-quick-composer data-focused={focused || undefined} data-hermit-no-drag>
      <textarea
        ref={ref}
        value={draft}
        onChange={(event) => inputActions?.setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        placeholder="发送消息"
        aria-label="发送消息"
        rows={chat ? 2 : 1}
        autoFocus
      />
      <div className={css.composerFooter}>
        <span className={css.composerHint}>{chat ? '继续对话' : '输入问题开始'}</span>
        <Button type="button" variant="primary" size="sm" icon={<IconSendOutline16 size={16} />} aria-label="发送" title="发送" data-quick-send disabled={inputActions === undefined || draft.trim() === ''} onClick={submit} />
      </div>
    </div>
  )
}

function ApprovalCompanion({ approval, desktopSurface }: { approval: PendingWait<'approval'> | undefined; desktopSurface: ReturnType<typeof getDesktopSurfaceClient> }) {
  const [busy, setBusy] = useState(false)
  const answered = useRef(false)
  const answer = async (outcome: 'allowed-once' | 'rejected'): Promise<void> => {
    if (approval === undefined || answered.current || busy) return
    answered.current = true
    setBusy(true)
    try {
      const receipt = await approval.respond({
        ok: true,
        value: { sessionId: approval.sessionId, approvalId: approval.payload.approvalId, outcome },
      })
      if (!receipt.accepted) throw new Error(receipt.reason)
      await desktopSurface?.close(APPROVAL_SURFACE)
    } catch (error) {
      answered.current = false
      setBusy(false)
      console.error(`审批响应失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  useEffect(() => {
    if (approval === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      void answer('rejected')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [approval?.key, busy])
  if (approval === undefined) return null
  return (
    <section className={css.surface} data-approval-companion data-hermit-drag-region>
      <div className={css.approvalHeader}>
        <span>需要确认</span>
        <Button type="button" variant="ghost" size="sm" icon={<IconCloseOutline16 size={16} />} aria-label="拒绝并关闭" title="拒绝并关闭" data-hermit-no-drag disabled={busy} onClick={() => { void answer('rejected') }} />
      </div>
      <h1>{approval.payload.toolName}</h1>
      <p>{approval.payload.reason ?? '此操作需要你的确认。'}</p>
      {approval.payload.callId !== undefined && <code>{approval.payload.callId}</code>}
      <div className={css.approvalActions} data-hermit-no-drag>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { void answer('rejected') }}>拒绝</Button>
        <Button type="button" variant="primary" size="sm" disabled={busy} onClick={() => { void answer('allowed-once') }}>允许一次</Button>
      </div>
    </section>
  )
}

function extractText(blocks: readonly ContentBlock[]): string {
  return blocks.filter((block): block is Extract<ContentBlock, { type: 'text' }> => block.type === 'text').map((block) => block.text).join('\n')
}
