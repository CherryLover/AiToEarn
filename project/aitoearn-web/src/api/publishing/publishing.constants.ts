/**
 * 发布登记（PublishedPost）接口常量
 * 与服务端契约保持一致：唯一的发布方式、字段长度、默认分页、业务错误码。
 */

/**
 * 这一轮唯一允许的发布方式：内容打包给人，人自己去平台发。
 * 服务端对 `auto` 直接拒绝（不是悄悄降级成 manual），前端也不提供第二个选项。
 */
export const PUBLISH_MODE_MANUAL = 'manual' as const

/** 帖子链接最长长度，跟服务端 CompletePublishedPostDto 一致 */
export const POST_URL_MAX_LENGTH = 2048

/** 平台侧帖子 id 最长长度 */
export const PLATFORM_POST_ID_MAX_LENGTH = 200

/** 发失败原因最长长度 */
export const PUBLISH_FAIL_REASON_MAX_LENGTH = 500

/** 草稿路径最长长度 */
export const PUBLISH_DRAFT_PATH_MAX_LENGTH = 512

/** 发布记录列表默认每页条数 */
export const PUBLISHED_POST_PAGE_SIZE = 20

/**
 * 发布相关业务错误码，对应服务端 ResponseCode 20500 段。
 * 没收录的码统一退回通用文案，不影响功能。
 */
export const PUBLISHING_ERROR_CODE = {
  /** 发布记录不存在或不属于当前用户 */
  NotFound: 20500,
  /** 这条记录不属于当前项目 */
  ProjectMismatch: 20501,
  /** 草稿路径不合法，必须是 drafts/ 下的目录 */
  DraftPathInvalid: 20502,
  /** 草稿目录或 content.md 不在了 */
  DraftNotFound: 20503,
  /** 草稿文件解析不了 */
  DraftInvalid: 20504,
  /** 草稿标题和正文都是空的，没东西可发 */
  DraftEmpty: 20505,
  /** 这一轮只做手动发布，auto 被拒绝 */
  AutoModeNotSupported: 20506,
  /** 同一条帖子已经登记过了 */
  Duplicate: 20507,
  /** 已经登记为发布成功，不能重复回填 */
  AlreadyCompleted: 20508,
  /** 帖子链接不合法 */
  UrlInvalid: 20509,
  /** 建发布记录或执行工单失败 */
  CreateFailed: 20510,
  /** 当前状态不允许这个操作 */
  StatusInvalid: 20511,
} as const
