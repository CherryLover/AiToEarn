/**
 * ProjectChatPanel - 项目详情页右侧常驻的 AI 对话
 *
 * 想法多半是聊出来的：先说个模糊的念头，AI 问两句，补点材料，才谈得上提炼方向。
 * 所以这里不是弹窗，是一条跟着项目走的长会话——切标签页不断，关掉再打开还在。
 *
 * 会话、消息、工具调用全部复用 `@/components/Chat` 和 `@/store/agent`，
 * 这个文件只负责外壳、会话切换，以及把项目名交给底下的组件。
 */
'use client'

import type { IDisplayMessage, IWorkflowStep } from '@/store/agent'
import { History, MessageSquarePlus, PanelRightClose, Sparkles } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTransClient } from '@/app/i18n/client'
import { ChatInput } from '@/components/Chat/ChatInput'
import { ChatMessage } from '@/components/Chat/ChatMessage'
import { useChatState, useScrollControl } from '@/components/Chat/hooks'
import { ProjectScopeProvider } from '@/components/Chat/ProjectScopeContext'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { useAgentStore } from '@/store/agent'
import { cn } from '@/utils/className'
import { toast } from '@/utils/ui/toast'
import { ProjectChatHistory } from './ProjectChatHistory'
import {
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  useChatPanelWidth,
} from './useChatPanelWidth'
import { useProjectChatSession } from './useProjectChatSession'

/** 空会话时用的常量空数组，避免每次渲染都造新引用 */
const EMPTY_MESSAGES: IDisplayMessage[] = []
const EMPTY_STEPS: IWorkflowStep[] = []

/** 别处塞进来的一句话（比如「让 AI 提炼方向」），换一个 at 就发一次 */
export interface ProjectChatPrompt {
  text: string
  at: number
}

interface ProjectChatPanelProps {
  /** 项目英文名，Agent 靠它锁定工作目录，会话也归到这个名下 */
  projectName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 外面塞进来的提示词，发完会回调 onPromptConsumed */
  pendingPrompt: ProjectChatPrompt | null
  onPromptConsumed: () => void
  /** 一轮跑完（不管成没成）通知外面去刷数据 */
  onTaskFinished: () => void
}

export function ProjectChatPanel(props: ProjectChatPanelProps) {
  const { projectName, open, onOpenChange, pendingPrompt, onPromptConsumed, onTaskFinished } = props
  const { t } = useTransClient('projects')

  const session = useProjectChatSession(projectName)
  const panelWidth = useChatPanelWidth()
  const { createTask, continueTask, stopTask } = useAgentStore()

  const [inputValue, setInputValue] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyToken, setHistoryToken] = useState(0)

  // 没有会话时用 'new'：useChatState 认这个值，会去读**当前活跃任务**的消息，
  // 这样刚发出第一条、真实 taskId 还没回来的时候，界面上也立刻有东西。
  //
  // 但「当前活跃任务」是全局的，可能是上一条会话、也可能是别的页面留下的。
  // 所以空会话状态下只认这一轮自己发出去的，靠 hasSent 兜住，
  // 否则点了「开一条新的」上一条的消息还赖在面板里，看着像没新开成。
  const chatTaskId = session.taskId || 'new'

  const {
    displayMessages: rawMessages,
    workflowSteps: rawWorkflowSteps,
    isLoading,
    isGenerating,
  } = useChatState({
    taskId: chatTaskId,
    t: t as (key: string) => string,
  })

  // 这一轮空会话里有没有真发过消息
  const [hasSent, setHasSent] = useState(false)
  // 换会话（新开、从历史切、认领到真实 ID）就重置
  useEffect(() => {
    setHasSent(false)
  }, [session.taskId])

  const isBlankSession = !session.taskId && !hasSent
  const displayMessages = isBlankSession ? EMPTY_MESSAGES : rawMessages
  const workflowSteps = isBlankSession ? EMPTY_STEPS : rawWorkflowSteps

  const {
    containerRef,
    bottomRef,
    isNearBottom,
    scrollToBottom,
    handleScroll,
    onContentReady,
  } = useScrollControl()

  const busy = isGenerating || isSending

  // 首次有内容时滚到底
  useEffect(() => {
    if (!isLoading && displayMessages.length > 0)
      onContentReady()
  }, [isLoading, displayMessages.length, onContentReady])

  // 人在底部附近才跟着滚，正在往回翻的时候别打断
  useEffect(() => {
    if (isNearBottom)
      scrollToBottom()
  }, [displayMessages, workflowSteps, isNearBottom, scrollToBottom])

  // 一轮从「在跑」变成「跑完」时通知外面刷数据。
  // 用 ref 记上一轮的值，避免每次渲染都触发
  const wasBusyRef = useRef(false)
  useEffect(() => {
    if (wasBusyRef.current && !busy)
      onTaskFinished()

    wasBusyRef.current = busy
  }, [busy, onTaskFinished])

  /** 发一条消息：有会话就接着聊，没有就新建一条 */
  const send = useCallback(async (prompt: string) => {
    const text = prompt.trim()
    if (!text || busy)
      return

    setIsSending(true)
    setHasSent(true)
    scrollToBottom(true)

    try {
      if (session.taskId) {
        await continueTask({
          prompt: text,
          projectName,
          taskId: session.taskId,
          t: t as (key: string) => string,
        })
      }
      else {
        await createTask({
          prompt: text,
          projectName,
          t: t as (key: string) => string,
          onTaskIdReady: session.adopt,
        })
      }
    }
    catch (error) {
      console.error('Project chat send failed:', error)
      toast.error(t('chat.sendFailed'))
    }
    finally {
      setIsSending(false)
    }
  }, [busy, continueTask, createTask, projectName, scrollToBottom, session.adopt, session.taskId, t])

  const handleSend = useCallback(() => {
    const text = inputValue
    setInputValue('')
    void send(text)
  }, [inputValue, send])

  const handleStop = useCallback(() => {
    stopTask()
    setIsSending(false)
  }, [stopTask])

  // 外面塞进来的提示词：面板打开且不忙的时候发出去。
  // 记住已经处理过的那个 at，防止重渲染时重复发送
  const consumedAtRef = useRef(0)
  useEffect(() => {
    if (!pendingPrompt || !open || busy || session.isResolving)
      return

    if (consumedAtRef.current === pendingPrompt.at)
      return

    consumedAtRef.current = pendingPrompt.at
    onPromptConsumed()
    void send(pendingPrompt.text)
  }, [pendingPrompt, open, busy, session.isResolving, onPromptConsumed, send])

  const handleStartNew = useCallback(() => {
    if (busy) {
      toast.info(t('chat.busyTip'))
      return
    }
    session.startNew()
    setHistoryOpen(false)
  }, [busy, session, t])

  const handleSelectHistory = useCallback((taskId: string) => {
    session.select(taskId)
    setHistoryOpen(false)
  }, [session])

  if (!open)
    return null

  return (
    <>
      {/* 窄屏时面板是盖上来的，给个背景遮罩，点一下关掉 */}
      <div
        className="fixed inset-0 z-40 bg-black/40 xl:hidden"
        onClick={() => onOpenChange(false)}
        aria-hidden
      />

      <aside
        // 宽度只在宽屏生效：窄屏是盖上来的抽屉，占满宽度，没什么可调的。
        // 所以断点交给 CSS，这里只把值以变量形式给出去
        style={{ '--chat-panel-width': `${panelWidth.width}px` } as React.CSSProperties}
        className={cn(
          // 窄屏：盖在右边；宽屏：变成正常的一列，把主体内容挤窄，不遮挡
          'fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-background shadow-xl',
          // 宽屏用 relative 而不是 static：拖拽手柄是绝对定位的，
          // static 不是定位上下文，手柄会跑去贴 body 的左边缘
          'xl:relative xl:z-auto xl:h-full xl:w-[var(--chat-panel-width)] xl:max-w-none xl:shrink-0 xl:shadow-none',
        )}
      >
        {/* 拖左边框改宽度。拖动时在 body 上挂 select-none，否则会把页面文字一路选中 */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('chat.resize')}
          aria-valuenow={panelWidth.width}
          aria-valuemin={MIN_CHAT_PANEL_WIDTH}
          aria-valuemax={MAX_CHAT_PANEL_WIDTH}
          tabIndex={0}
          title={t('chat.resizeHint')}
          onPointerDown={panelWidth.startResize}
          onDoubleClick={panelWidth.reset}
          onKeyDown={(event) => {
            // 键盘也能调：光靠拖，只用键盘的人改不了
            if (event.key === 'ArrowLeft') {
              event.preventDefault()
              panelWidth.nudge(event.shiftKey ? 64 : 16)
            }
            else if (event.key === 'ArrowRight') {
              event.preventDefault()
              panelWidth.nudge(event.shiftKey ? -64 : -16)
            }
            else if (event.key === 'Home') {
              event.preventDefault()
              panelWidth.reset()
            }
          }}
          className={cn(
            // 命中区域比看得见的那条线宽，不然很难对准
            'absolute inset-y-0 left-0 z-10 hidden w-2 -translate-x-1/2 cursor-col-resize xl:block',
            'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:bg-transparent after:transition-colors',
            'hover:after:bg-primary/40 focus-visible:outline-none focus-visible:after:bg-primary',
            panelWidth.isResizing && 'after:bg-primary',
          )}
        />
        <header className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2.5">
          <Sparkles className="size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{t('chat.title')}</p>
            <p className="truncate font-mono text-[11px] text-muted-foreground">{projectName}</p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            title={t('chat.startNew')}
            aria-label={t('chat.startNew')}
            onClick={handleStartNew}
          >
            <MessageSquarePlus className="size-4" />
          </Button>

          <Popover
            open={historyOpen}
            onOpenChange={(next) => {
              setHistoryOpen(next)
              if (next)
                setHistoryToken(token => token + 1)
            }}
          >
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" title={t('chat.history.title')} aria-label={t('chat.history.title')}>
                <History className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-0">
              <p className="border-b border-border px-3 py-2 text-xs font-medium text-foreground">
                {t('chat.history.title')}
              </p>
              <ProjectChatHistory
                projectName={projectName}
                currentTaskId={session.taskId}
                reloadToken={historyToken}
                onSelect={handleSelectHistory}
              />
            </PopoverContent>
          </Popover>

          <Button
            variant="ghost"
            size="icon"
            title={t('chat.close')}
            aria-label={t('chat.close')}
            onClick={() => onOpenChange(false)}
          >
            <PanelRightClose className="size-4" />
          </Button>
        </header>

        {/* 项目名交给底下的工具调用展示，用来把绝对路径收成项目内相对路径 */}
        <ProjectScopeProvider projectName={projectName}>
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
          >
            {session.isResolving || (isLoading && session.taskId)
              ? (
                  <div className="space-y-3">
                    <Skeleton className="h-16 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
                )
              : displayMessages.length === 0
                ? (
                    <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                      <Sparkles className="size-6 text-muted-foreground" />
                      <p className="mt-3 text-sm text-foreground">{t('chat.empty.title')}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                        {t('chat.empty.desc')}
                      </p>
                    </div>
                  )
                : (
                    <div className="flex flex-col gap-4">
                      {displayMessages.map((message, index) => {
                        const isLastAssistant
                          = message.role === 'assistant' && index === displayMessages.length - 1

                        return (
                          <ChatMessage
                            key={message.id}
                            role={message.role === 'user' ? 'user' : 'assistant'}
                            content={message.content}
                            medias={message.medias}
                            status={message.status}
                            errorMessage={message.errorMessage}
                            createdAt={message.createdAt}
                            steps={message.steps}
                            workflowSteps={isLastAssistant && busy ? workflowSteps : undefined}
                            actions={message.actions}
                            publishFlows={message.publishFlows}
                            isGenerating={isLastAssistant && busy}
                          />
                        )
                      })}

                      {/* 已经发出去但 AI 还没开口时，先占一条，免得看着像没反应 */}
                      {busy && displayMessages.every(message => message.role === 'user') && (
                        <ChatMessage
                          role="assistant"
                          content=""
                          status="streaming"
                          workflowSteps={workflowSteps}
                          isGenerating
                        />
                      )}

                      <div ref={bottomRef} />
                    </div>
                  )}
          </div>
        </ProjectScopeProvider>

        <div className="shrink-0 border-t border-border p-3">
          <ChatInput
            mode="compact"
            value={inputValue}
            onChange={setInputValue}
            onSend={handleSend}
            onStop={handleStop}
            isGenerating={busy}
            placeholder={t('chat.placeholder')}
          />
        </div>
      </aside>
    </>
  )
}
