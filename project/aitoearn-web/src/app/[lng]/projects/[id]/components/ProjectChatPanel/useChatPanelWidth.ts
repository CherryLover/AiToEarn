/**
 * useChatPanelWidth - 面板宽度：拖边框改，改完记在浏览器本地
 *
 * 宽度是个人偏好，不跟项目走：同一个人在哪个项目都想要一样的宽度，
 * 所以只存一个键，不按项目分。
 *
 * 只在宽屏（≥1280px）生效——窄屏时面板是盖上来的抽屉，占满宽度，没什么可调的。
 * 这里只管算数和存取，断点交给 CSS：宽度以变量形式给出去，className 里用 `xl:` 才套上。
 */
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'projects.detail.chatWidth'

/** 默认 26rem，和改成可拖之前的固定宽度一致 */
export const DEFAULT_CHAT_PANEL_WIDTH = 416

/** 再窄消息就堆成一条线了 */
export const MIN_CHAT_PANEL_WIDTH = 320

/** 绝对上限。另外还有一条按视口算的上限，见 clampChatPanelWidth */
export const MAX_CHAT_PANEL_WIDTH = 880

/**
 * 把宽度收进可用范围。
 *
 * 除了固定上下限，还不许超过视口的一半：面板是来让位的，
 * 拖到把主体内容挤没了就本末倒置了。视口拿不到（服务端渲染）就只用固定上限。
 */
export function clampChatPanelWidth(width: number, viewportWidth?: number): number {
  if (!Number.isFinite(width))
    return DEFAULT_CHAT_PANEL_WIDTH

  let max = MAX_CHAT_PANEL_WIDTH
  if (typeof viewportWidth === 'number' && viewportWidth > 0)
    max = Math.min(max, Math.max(MIN_CHAT_PANEL_WIDTH, Math.round(viewportWidth / 2)))

  return Math.round(Math.min(max, Math.max(MIN_CHAT_PANEL_WIDTH, width)))
}

/** 读不到（无痕模式、被禁用、存过脏值）就用默认宽度 */
export function readStoredWidth(): number {
  if (typeof window === 'undefined')
    return DEFAULT_CHAT_PANEL_WIDTH

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw)
      return DEFAULT_CHAT_PANEL_WIDTH

    return clampChatPanelWidth(Number(raw), window.innerWidth)
  }
  catch {
    return DEFAULT_CHAT_PANEL_WIDTH
  }
}

/** 写不进去只是下次进来回到默认宽度，不提示、不打断 */
function writeStoredWidth(width: number) {
  if (typeof window === 'undefined')
    return

  try {
    window.localStorage.setItem(STORAGE_KEY, String(width))
  }
  catch {
    // 忽略：无痕模式下写入会抛异常
  }
}

export interface ChatPanelWidth {
  /** 当前宽度（px），交给 CSS 变量用 */
  width: number
  /** 是不是正在拖：拖的时候要把选中文字和 iframe 的鼠标事件挡掉 */
  isResizing: boolean
  /** 绑到拖拽手柄的 onPointerDown */
  startResize: (event: React.PointerEvent) => void
  /** 手柄上按方向键微调 */
  nudge: (deltaPx: number) => void
  /** 双击手柄恢复默认宽度 */
  reset: () => void
}

export function useChatPanelWidth(): ChatPanelWidth {
  // 首屏渲染要和服务端一致，所以先用默认值，挂载后再补上本地记住的
  const [width, setWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH)
  const [isResizing, setIsResizing] = useState(false)

  useEffect(() => {
    setWidth(readStoredWidth())
  }, [])

  const apply = useCallback((next: number) => {
    const clamped = clampChatPanelWidth(next, typeof window === 'undefined' ? undefined : window.innerWidth)
    setWidth(clamped)
    return clamped
  }, [])

  // 拖动过程中不写 localStorage：一次拖拽几十上百次移动，松手写一次就够
  const latestRef = useRef(width)
  useEffect(() => {
    latestRef.current = width
  }, [width])

  const startResize = useCallback((event: React.PointerEvent) => {
    // 只认左键/主指针，右键和中键不该触发拖拽
    if (event.button !== 0)
      return

    event.preventDefault()
    setIsResizing(true)

    // 面板贴在右边，所以宽度就是「视口右边缘到指针」的距离
    const onMove = (moveEvent: PointerEvent) => {
      apply(window.innerWidth - moveEvent.clientX)
    }

    const onUp = () => {
      setIsResizing(false)
      writeStoredWidth(latestRef.current)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    // 指针被系统收走（比如切到别的窗口）也要收尾，否则会一直跟着鼠标走
    window.addEventListener('pointercancel', onUp)
  }, [apply])

  const nudge = useCallback((deltaPx: number) => {
    writeStoredWidth(apply(latestRef.current + deltaPx))
  }, [apply])

  const reset = useCallback(() => {
    writeStoredWidth(apply(DEFAULT_CHAT_PANEL_WIDTH))
  }, [apply])

  // 拖动过程中把整页的文字选中和鼠标样式接管掉：
  // 指针会扫过主体内容，不挡住的话拖一下就把半页文字选蓝了
  useEffect(() => {
    if (!isResizing)
      return

    const { body } = document
    const prevUserSelect = body.style.userSelect
    const prevCursor = body.style.cursor
    body.style.userSelect = 'none'
    body.style.cursor = 'col-resize'

    return () => {
      body.style.userSelect = prevUserSelect
      body.style.cursor = prevCursor
    }
  }, [isResizing])

  // 视口变窄时，原来的宽度可能已经超过一半了，跟着收一下
  useEffect(() => {
    const onResize = () => {
      setWidth(current => clampChatPanelWidth(current, window.innerWidth))
    }

    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  return { width, isResizing, startResize, nudge, reset }
}
