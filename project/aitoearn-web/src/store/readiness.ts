/**
 * 就绪检查状态
 *
 * 进站在已登录布局里拉**一次** `GET /system/readiness`，结果放这里，
 * **同一次会话不重复拉**（contract-runtime-config 4.2）。引导页保存完调 `refresh()` 手动复检。
 *
 * 三条边界，改之前先读：
 *
 * 1. **不持久化。** 就绪状态是「服务器此刻行不行」，不是用户偏好。存进 localStorage 的后果是：
 *    运维把上游配好了，用户这边横幅还挂着；或者反过来，配置被改坏了网页还显示一切正常。
 * 2. **未登录不拉。** 接口要登录，未登录调用只会拿到 401，白跑一趟还会在控制台留错。
 *    退出登录时调 `reset()`，换个账号进来重新拉。
 * 3. **失败不重试、不报错。** 拉不到就当作「不知道」，`data` 保持 null，横幅不显示。
 *    宁可少说一句，也不要在服务端还没上线这个接口的时候把每个人都拦在横幅后面。
 */

import type { ReadinessVo } from '@/api/system/readiness.types'
import { create } from 'zustand'
import { getSystemReadinessApi } from '@/api/system/readiness.api'
import { ReadinessStatus } from '@/api/system/readiness.types'

/** 加载状态。`failed` 只代表这次没拉到，不代表系统没就绪 */
export type ReadinessLoadState = 'idle' | 'loading' | 'loaded' | 'failed'

interface ReadinessStoreState {
  loadState: ReadinessLoadState
  data: ReadinessVo | null
  /** 本次会话已经自动拉过一次（不管成败），`ensureLoaded` 不再重复触发 */
  fetchedOnce: boolean
  /** 横幅被手动关掉。只在本次会话有效，刷新页面又会出现——配置没修好，就该一直提醒 */
  bannerDismissed: boolean
  /** 进站调这个：拉过就什么都不做 */
  ensureLoaded: () => Promise<void>
  /** 引导页保存完调这个：强制重新拉一次 */
  refresh: () => Promise<ReadinessVo | null>
  dismissBanner: () => void
  /** 退出登录时调，免得把上一个账号的结果带给下一个 */
  reset: () => void
}

/** 同时发起多次时共用同一个请求，别让引导页和横幅各打一次 */
let inflight: Promise<ReadinessVo | null> | null = null

async function loadReadiness(
  set: (partial: Partial<ReadinessStoreState>) => void,
): Promise<ReadinessVo | null> {
  if (inflight)
    return inflight

  set({ loadState: 'loading' })

  inflight = (async () => {
    try {
      const res = await getSystemReadinessApi()
      if (res && res.code === 0 && res.data) {
        set({ loadState: 'loaded', data: res.data, fetchedOnce: true })
        return res.data
      }
      // 401 / 接口还没上线 / 服务端 500，都归到「这次没拉到」。
      // 不改 data：上一次拿到的结果比「什么都不知道」有用。
      set({ loadState: 'failed', fetchedOnce: true })
      return null
    }
    catch {
      set({ loadState: 'failed', fetchedOnce: true })
      return null
    }
    finally {
      inflight = null
    }
  })()

  return inflight
}

export const useReadinessStore = create<ReadinessStoreState>((set, get) => ({
  loadState: 'idle',
  data: null,
  fetchedOnce: false,
  bannerDismissed: false,

  async ensureLoaded() {
    if (get().fetchedOnce || get().loadState === 'loading')
      return
    await loadReadiness(set)
  },

  refresh() {
    return loadReadiness(set)
  },

  dismissBanner() {
    set({ bannerDismissed: true })
  },

  reset() {
    inflight = null
    set({ loadState: 'idle', data: null, fetchedOnce: false, bannerDismissed: false })
  },
}))

/**
 * 有没有 required 项没通过。
 * `data` 为 null（没拉到）时返回 false：**不知道就别吓人**。
 */
export function hasBlockingReadinessIssue(data: ReadinessVo | null): boolean {
  if (!data)
    return false
  return data.items.some(item => item.required && item.status !== ReadinessStatus.Ok)
}
