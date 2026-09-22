/**
 * 运行时覆盖层状态的传递通道
 *
 * `ConfigField` 是递归的，层数不定；把 `overriddenPaths` / `protectedPaths` 一层层当 props 传下去
 * 要改十来个函数签名，还得在每个中转处记得往下带。这种「整棵树都要读、谁都不改」的东西走 context。
 *
 * 没有 Provider 时返回 `emptyConfigOverrideMeta`——老服务端不返回这两个字段时就是这个状态：
 * 没有徽标、没有禁用，页面和之前一模一样。
 */
'use client'

import type { ReactNode } from 'react'
import type { ConfigOverrideMeta } from '../utils/configOverride'
import { createContext, useContext } from 'react'
import { emptyConfigOverrideMeta } from '../utils/configOverride'

const ConfigOverrideContext = createContext<ConfigOverrideMeta>(emptyConfigOverrideMeta)

export function ConfigOverrideProvider({ meta, children }: { meta: ConfigOverrideMeta, children: ReactNode }) {
  return <ConfigOverrideContext.Provider value={meta}>{children}</ConfigOverrideContext.Provider>
}

export function useConfigOverrideMeta() {
  return useContext(ConfigOverrideContext)
}
