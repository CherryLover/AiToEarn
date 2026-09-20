/**
 * 配置项搜索
 *
 * 上百个字段分散在十来个分区里，没有搜索基本找不到东西，所以这里做一个跨分区的扁平索引。
 *
 * 两条刻意的设计：
 *
 * 1. **只往对象里钻，数组整块当一个节点**。不然 `ai.models.chat` 这种会被拆成一堆按下标
 *    编号的条目，搜出来全是「#1 #2 #3」，反而更难找。
 * 2. **只拿路径、标签和说明去匹配，不匹配值**。配置里有 apiKey、secret、password，
 *    拿值去匹配等于给了一条「输入前几位就能确认密钥」的旁路。
 */

import type { ConfigPath, ConfigSectionView } from '../types'
import { getConfigFieldDescription, getConfigFieldLabel } from './configFieldMeta'
import { isRecord, joinPath } from './configPath'
import { getConfigSectionValue } from './configSections'

export interface ConfigSearchHit {
  sectionId: string
  sectionLabel: string
  path: ConfigPath
  /** 「渠道配置 / Bilibili」这样的来路，告诉用户这个字段挂在哪 */
  breadcrumb: string
}

export interface ConfigSearchResult {
  hits: ConfigSearchHit[]
  /** 命中总数，可能大于 `hits.length` */
  total: number
  truncated: boolean
}

/** 一次最多渲染这么多命中项，再多页面就没法看了 */
export const CONFIG_SEARCH_HIT_LIMIT = 80

const emptyResult: ConfigSearchResult = { hits: [], total: 0, truncated: false }

function collectNodePaths(value: unknown, path: ConfigPath, push: (path: ConfigPath) => void) {
  if (isRecord(value) && Object.keys(value).length > 0) {
    Object.keys(value).forEach(key => collectNodePaths(value[key], [...path, key], push))
    return
  }

  push(path)
}

function buildSegmentLabels(path: ConfigPath, t: (key: string) => string) {
  return path.map((segment, index) => {
    if (typeof segment === 'number')
      return `#${segment + 1}`
    return getConfigFieldLabel(t, path.slice(0, index + 1), segment)
  })
}

export function searchConfigFields({
  sections,
  config,
  query,
  t,
  descriptions,
  limit = CONFIG_SEARCH_HIT_LIMIT,
}: {
  sections: ConfigSectionView[]
  config: Record<string, unknown> | null
  query: string
  t: (key: string) => string
  descriptions: Record<string, string>
  limit?: number
}): ConfigSearchResult {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!config || tokens.length === 0)
    return emptyResult

  const hits: ConfigSearchHit[] = []
  let total = 0

  sections.forEach((section) => {
    section.paths.forEach((sectionPath) => {
      collectNodePaths(getConfigSectionValue(config, sectionPath), sectionPath, (path) => {
        const labels = buildSegmentLabels(path, t)
        const lastKey = String(path[path.length - 1] ?? section.id)
        const description = getConfigFieldDescription(descriptions, path, lastKey)
        const haystack = `${joinPath(path)} ${labels.join(' ')} ${section.label} ${description}`.toLowerCase()

        if (!tokens.every(token => haystack.includes(token)))
          return

        total += 1
        if (hits.length >= limit)
          return

        hits.push({
          sectionId: section.id,
          sectionLabel: section.label,
          path,
          breadcrumb: [section.label, ...labels.slice(0, -1)].join(' / '),
        })
      })
    })
  })

  return { hits, total, truncated: total > hits.length }
}

/** 按分区把命中项归拢，顺序跟着左侧导航走 */
export function groupSearchHitsBySection(hits: ConfigSearchHit[]) {
  const groups: { sectionId: string, sectionLabel: string, hits: ConfigSearchHit[] }[] = []

  hits.forEach((hit) => {
    const existing = groups.find(group => group.sectionId === hit.sectionId)
    if (existing) {
      existing.hits.push(hit)
      return
    }
    groups.push({ sectionId: hit.sectionId, sectionLabel: hit.sectionLabel, hits: [hit] })
  })

  return groups
}
