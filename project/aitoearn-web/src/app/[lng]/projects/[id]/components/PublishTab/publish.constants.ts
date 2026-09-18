/**
 * 发布标签页常量
 * 平台创作后台地址、可选平台、卡片展示参数。
 *
 * 这些地址只是给人点开的链接：页面把内容打包好，人自己去平台发。
 * 这里不存在任何调用平台发布接口的东西，也不要往这里加。
 */

import { DRAFT_PLATFORMS } from '../DraftsTab/drafts.constants'

/**
 * 各平台的创作后台地址，点「打开平台发布页」就去这儿。
 * 平台改地址的时候只改这张表。
 */
export const PLATFORM_CREATOR_URL: Record<string, string> = {
  /** 小红书创作服务平台 */
  xhs: 'https://creator.xiaohongshu.com/publish/publish',
  /** 抖音创作者中心 */
  douyin: 'https://creator.douyin.com/creator-micro/content/upload',
  /** 微信视频号助手 */
  wxSph: 'https://channels.weixin.qq.com/platform/post/create',
  /** 微信公众平台 */
  wxGzh: 'https://mp.weixin.qq.com/',
}

/**
 * 可以打包发布的平台，跟草稿生成那边保持同一张表，
 * value 同时是草稿目录名里的平台段和发布记录里的 platform。
 */
export const PUBLISH_PLATFORMS = DRAFT_PLATFORMS

/** 草稿目录名里的平台段，用来根据选中的草稿自动猜平台 */
export const PLATFORM_VALUES = DRAFT_PLATFORMS.map(item => item.value)

/** 正文超过这个长度才提供折叠/展开 */
export const BODY_COLLAPSE_MIN_LENGTH = 320

/** 复制成功后按钮保持「已复制」的毫秒数 */
export const COPY_FEEDBACK_MS = 2000

/** 批量下载图片时每张之间的间隔毫秒数，避免浏览器把连续下载当成弹窗拦掉 */
export const BATCH_DOWNLOAD_GAP_MS = 400

/**
 * 物料里放图片的目录，「从物料里挑图」就在这儿翻。
 * 挑图只是把图摆到卡片上给人复制 / 下载，不写回草稿，更不会替人发。
 */
export const MEDIA_LIBRARY_DIR = 'media'

/** 挑图时展开 media/ 的层数，够看到按日期分的子目录 */
export const MEDIA_LIBRARY_TREE_DEPTH = 3

/** 挑图对话框最多列这么多张，超了只列前面这些，免得一次把整个图库拉出来 */
export const MEDIA_LIBRARY_MAX_FILES = 200
