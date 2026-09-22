import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clampChatPanelWidth,
  DEFAULT_CHAT_PANEL_WIDTH,
  MAX_CHAT_PANEL_WIDTH,
  MIN_CHAT_PANEL_WIDTH,
  readStoredWidth,
  useChatPanelWidth,
} from './useChatPanelWidth'

const STORAGE_KEY = 'projects.detail.chatWidth'

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true })
}

beforeEach(() => {
  window.localStorage.clear()
  setViewport(1600)
  vi.restoreAllMocks()
})

describe('clampChatPanelWidth 收进可用范围', () => {
  it('太窄按下限收住', () => {
    expect(clampChatPanelWidth(100, 1600)).toBe(MIN_CHAT_PANEL_WIDTH)
  })

  it('太宽按上限收住', () => {
    expect(clampChatPanelWidth(5000, 4000)).toBe(MAX_CHAT_PANEL_WIDTH)
  })

  /** 面板是来让位的，拖到把主体内容挤没了就本末倒置 */
  it('不许超过视口的一半', () => {
    expect(clampChatPanelWidth(900, 1400)).toBe(700)
  })

  /** 视口本来就窄的时候，一半比下限还小——这时下限优先，否则面板会被压成零宽 */
  it('视口的一半比下限还小时，下限优先', () => {
    expect(clampChatPanelWidth(500, 600)).toBe(MIN_CHAT_PANEL_WIDTH)
  })

  it('拿不到视口就只用固定上限', () => {
    expect(clampChatPanelWidth(5000)).toBe(MAX_CHAT_PANEL_WIDTH)
  })

  /** 本地存过脏值也不能让页面崩 */
  it('不是数字就回到默认宽度', () => {
    expect(clampChatPanelWidth(Number.NaN, 1600)).toBe(DEFAULT_CHAT_PANEL_WIDTH)
  })
})

describe('readStoredWidth 读本地记住的宽度', () => {
  it('没记过就用默认', () => {
    expect(readStoredWidth()).toBe(DEFAULT_CHAT_PANEL_WIDTH)
  })

  it('记过就用记的那个', () => {
    window.localStorage.setItem(STORAGE_KEY, '520')
    expect(readStoredWidth()).toBe(520)
  })

  /** 换了台小屏幕的机器，上次记的宽度可能已经超出这块屏的一半了 */
  it('记的值超出当前视口能给的范围时收一下', () => {
    window.localStorage.setItem(STORAGE_KEY, '860')
    setViewport(1300)
    expect(readStoredWidth()).toBe(650)
  })

  it('存的是垃圾就回到默认', () => {
    window.localStorage.setItem(STORAGE_KEY, 'wide-please')
    expect(readStoredWidth()).toBe(DEFAULT_CHAT_PANEL_WIDTH)
  })

  /** 无痕模式下读 localStorage 会抛，不能让面板打不开 */
  it('读不了也不抛，回到默认', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readStoredWidth()).toBe(DEFAULT_CHAT_PANEL_WIDTH)
  })
})

describe('useChatPanelWidth 交互', () => {
  it('挂载后补上本地记住的宽度', () => {
    window.localStorage.setItem(STORAGE_KEY, '500')
    const { result } = renderHook(() => useChatPanelWidth())
    expect(result.current.width).toBe(500)
  })

  it('方向键能微调，并且当场记下来', () => {
    const { result } = renderHook(() => useChatPanelWidth())

    act(() => result.current.nudge(16))

    expect(result.current.width).toBe(DEFAULT_CHAT_PANEL_WIDTH + 16)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe(String(DEFAULT_CHAT_PANEL_WIDTH + 16))
  })

  it('恢复默认', () => {
    window.localStorage.setItem(STORAGE_KEY, '700')
    const { result } = renderHook(() => useChatPanelWidth())

    act(() => result.current.reset())

    expect(result.current.width).toBe(DEFAULT_CHAT_PANEL_WIDTH)
  })

  /** 拖动过程中不写 localStorage，松手才写一次 */
  it('拖动时跟着指针走，松手才落盘', () => {
    const { result } = renderHook(() => useChatPanelWidth())

    act(() => {
      result.current.startResize({
        button: 0,
        preventDefault: () => {},
      } as unknown as React.PointerEvent)
    })
    expect(result.current.isResizing).toBe(true)

    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1600 - 600 }))
    })
    expect(result.current.width).toBe(600)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull()

    act(() => {
      window.dispatchEvent(new PointerEvent('pointerup'))
    })
    expect(result.current.isResizing).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('600')
  })

  /** 右键中键不该触发拖拽 */
  it('非左键不开始拖', () => {
    const { result } = renderHook(() => useChatPanelWidth())

    act(() => {
      result.current.startResize({
        button: 2,
        preventDefault: () => {},
      } as unknown as React.PointerEvent)
    })

    expect(result.current.isResizing).toBe(false)
  })

  /** 指针被系统收走（切窗口之类）也要收尾，否则面板会一直跟着鼠标走 */
  it('指针被取消时也收尾', () => {
    const { result } = renderHook(() => useChatPanelWidth())

    act(() => {
      result.current.startResize({
        button: 0,
        preventDefault: () => {},
      } as unknown as React.PointerEvent)
    })
    act(() => {
      window.dispatchEvent(new PointerEvent('pointercancel'))
    })

    expect(result.current.isResizing).toBe(false)

    // 收尾之后再动鼠标，宽度不该再变
    const settled = result.current.width
    act(() => {
      window.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 }))
    })
    expect(result.current.width).toBe(settled)
  })

  /** 窗口被拖窄之后，原来的宽度可能已经超过一半了 */
  it('视口变窄时跟着收', () => {
    window.localStorage.setItem(STORAGE_KEY, '800')
    const { result } = renderHook(() => useChatPanelWidth())
    expect(result.current.width).toBe(800)

    act(() => {
      setViewport(1300)
      window.dispatchEvent(new Event('resize'))
    })

    expect(result.current.width).toBe(650)
  })
})
