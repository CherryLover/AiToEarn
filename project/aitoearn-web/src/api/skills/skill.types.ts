/**
 * 自定义 AI 技能接口类型
 * 字段严格对应服务端 SkillVo，不要在此处自行增删字段或改名。
 */

/**
 * Skill 数据结构，对应服务端 SkillVo。
 * 日期字段经 JSON 序列化后为 ISO 字符串。
 */
export interface Skill {
  /** 技能名，同时是磁盘上的目录名 */
  name: string
  /** 一句话说明它干什么、什么时候用。技能靠这句话被匹配到 */
  description: string
  /** 内置的只能看，自定义的能删 */
  builtin: boolean
  /** 自定义技能的最后修改时间；内置的没有 */
  updatedAt?: string
  /**
   * 技能根目录下所有文件的相对路径：posix 分隔、服务端已排序、包含 `SKILL.md`，最多 500 条。
   * 内置和自定义都有。只用来展示结构，**不要拿它拼请求路径**。
   */
  files: string[]
}

/**
 * 技能列表响应。
 */
export interface SkillList {
  list: Skill[]
}

/**
 * 上传参数。
 */
export interface UploadSkillParams {
  file: File
  /** 同名时是否覆盖。默认不覆盖，避免手滑顶掉别人传的 */
  overwrite?: boolean
}
