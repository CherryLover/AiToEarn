/**
 * 自定义 AI 技能接口
 *
 * 走 `ai/` 前缀：nginx 把 `/api/ai/` 路由到 aitoearn-ai 服务，
 * 技能文件也挂在那个容器里。改前缀等于把请求打到没有这些文件的服务上。
 */

import type { Skill, SkillList, UploadSkillParams } from './skill.types'
import http from '@/utils/request'

/** 列出全部技能：内置的和用户传的一起返回，各自标明来源。 */
export function getSkillListApi(silent = true) {
  return http.get<SkillList>('ai/skills', undefined, silent)
}

/**
 * 上传一个自定义技能。
 * 只收单个 Markdown 文件，服务端按 frontmatter 里的 name 落盘，不看文件名。
 */
export function uploadSkillApi(params: UploadSkillParams, silent = true) {
  const formData = new FormData()
  formData.append('file', params.file)
  if (params.overwrite)
    formData.append('overwrite', 'true')

  return http.post<Skill>('ai/skills', formData, silent)
}

/** 删除一个自定义技能。内置的删不掉，服务端拒绝。 */
export function deleteSkillApi(name: string, silent = true) {
  return http.delete<void>(`ai/skills/${encodeURIComponent(name)}`, undefined, silent)
}
