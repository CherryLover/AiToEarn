/**
 * 就绪检查闸门
 *
 * 挂在已登录布局里，**不渲染任何东西**。干两件事：进站拉一次就绪检查，
 * 发现有必需项没配好就直接把人送去 `/setup`。
 *
 * 为什么不是横幅了：之前这里挂的是一条横幅，上面写着「AI 提炼方向现在用不了：
 * 上游 AI 还没配」。用户的原话是「这些东西不要直接报出来」——
 * 一个没配完的部署，在主站上解释是哪一项、为什么，对用户没有用，
 * 该配的还是得去配置页配。所以现在不解释，直接跳过去。
 *
 * 四条规矩，改之前先读：
 *
 * 1. **不知道就不跳。** 拉不到结果（接口还没上线、服务没起来）时 `data` 是 null，
 *    `hasBlockingReadinessIssue` 返回 false，这里什么都不做。宁可漏跳一次，
 *    也不要因为一次网络抖动就把所有人锁在配置页上。
 * 2. **未登录不拉。** 接口要登录，未登录调只会拿到 401。退出登录时清掉结果，
 *    免得把上一个账号的状态带给下一个。
 * 3. **有几个路径绝不跳**（见 `SETUP_REDIRECT_SILENT_SEGMENTS`）。漏掉 `/setup`
 *    自己就是一个跳转死循环：进配置页 → 还没配好 → 再跳配置页。
 * 4. **用 `replace` 不用 `push`。** 跳过去之后按浏览器后退不该弹回那个
 *    立刻又会把人送走的页面。
 */

'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { hasBlockingReadinessIssue, useReadinessStore } from '@/store/readiness'
import { useUserStore } from '@/store/user'
import { setupPathFor, shouldRedirectToSetup } from '../../setup.utils'

export function ReadinessGate() {
  const pathname = usePathname()
  const router = useRouter()

  const token = useUserStore(state => state.token)
  const data = useReadinessStore(state => state.data)
  const fetchedOnce = useReadinessStore(state => state.fetchedOnce)
  const ensureLoaded = useReadinessStore(state => state.ensureLoaded)
  const reset = useReadinessStore(state => state.reset)

  useEffect(() => {
    if (!token) {
      // 退出登录（或还没登录）：把上一次的结果清掉，换账号进来重新拉
      if (fetchedOnce)
        reset()
      return
    }
    // 同一次会话只会真的发一次请求，`ensureLoaded` 自己挡住重复
    void ensureLoaded()
  }, [token, fetchedOnce, ensureLoaded, reset])

  useEffect(() => {
    if (!token)
      return
    if (!shouldRedirectToSetup(pathname, hasBlockingReadinessIssue(data)))
      return

    router.replace(setupPathFor(pathname))
  }, [token, data, pathname, router])

  return null
}
