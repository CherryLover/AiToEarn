import { AppException, ResponseCode } from '@yikart/common'
import { isReservedProjectName, isValidProjectName } from '../projects/project-name.util'

/**
 * 方向 slug 的规则和项目英文名完全一致（contract-core.md 第三节）：
 * 3~40 字符，小写字母开头，只含小写字母、数字、连字符，不以连字符结尾，不允许连续连字符，命中保留字拒绝。
 *
 * 唯一的区别是**允许修改**——slug 是 `angles/<slug>.md` 的文件名，改了就要同步改文件名，
 * 这件事在 `AnglesService.update` 里做成事务性的（文件改名失败回滚数据库）。
 *
 * 规则直接复用项目那边的判定函数，只把报错换成 20200 段的方向错误码，
 * 免得两处规则以后走岔。
 */

/** 方向指引文件所在目录，相对项目根 */
export const ANGLE_DIR = 'angles'

/** 方向指引文件的扩展名 */
export const ANGLE_FILE_EXT = '.md'

/** 方向在一条线上最多派生多少层（含起点）。超过说明这条线该收敛了，不是继续往下挖 */
export const MAX_ANGLE_DEPTH = 6

/** 去掉首尾空白，其余原样保留，校验交给 assertAngleSlugUsable */
export function normalizeAngleSlug(slug: string): string {
  return slug.trim()
}

/** 只判断，不抛异常：同步文件时用它跳过不合规的文件名 */
export function isValidAngleSlug(slug: string): boolean {
  return !isReservedProjectName(slug) && isValidProjectName(slug)
}

/** 校验 slug，不合法直接抛业务异常 */
export function assertAngleSlugUsable(slug: string): void {
  if (isReservedProjectName(slug))
    throw new AppException(ResponseCode.AngleSlugReserved)

  if (!isValidProjectName(slug))
    throw new AppException(ResponseCode.AngleSlugInvalid)
}

/** 方向指引文件在项目里的相对路径：`angles/<slug>.md` */
export function angleRelPath(slug: string): string {
  return `${ANGLE_DIR}/${slug}${ANGLE_FILE_EXT}`
}
