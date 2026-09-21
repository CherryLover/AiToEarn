/**
 * 每个平台的采集规格。
 *
 * **规格里只有选择器和正则，没有任何可执行的东西**（contract-collect-xhs）：
 * 插件拿到的是数据，喂给它自己写死的那几个注入函数，不 `eval`、不注入服务端给的脚本。
 * 这条约束决定了规格能从服务端下发——否则派一个工单就等于在用户浏览器里执行任意代码。
 *
 * 小红书这份是拿真页面跑出来的，不是推演的。图标指纹取的是 `svg path` 的 `d` 属性前缀：
 * 实测图标顺序是 浏览 / 评论 / 点赞 / 收藏 / 分享，**按位置读会把赞和评论对调，而且不报错**。
 */
export interface CollectSpec {
  cardSelector: string
  titleSelector: string
  timeSelector: string
  statSelector: string
  metricByIconPrefix: Record<string, string>
  totalCountPattern?: string
  maxScrolls?: number
  scrollSettleMs?: number
}

export interface PlatformCollectProfile {
  platform: string
  entryUrl: string
  /** 卡片上的时间是这个时区的本地时间，页面上不带时区信息 */
  timeZone: string
  spec: CollectSpec
}

const XHS: PlatformCollectProfile = {
  platform: 'xhs',
  entryUrl: 'https://creator.xiaohongshu.com/new/note-manager',
  timeZone: 'Asia/Shanghai',
  spec: {
    cardSelector: '.note-card',
    titleSelector: '.note-card__title',
    timeSelector: '.note-card__time',
    statSelector: '.note-card__stat',
    metricByIconPrefix: {
      'M7.99902 3.83398': 'views',
      'M3.18233 10.985': 'comments',
      'M3.25611 3.91336': 'likes',
      'M10.8848 14.2322': 'collects',
      'M8.28672 5.15797': 'shares',
    },
    totalCountPattern: '^全部\\s*(\\d+)$',
    maxScrolls: 40,
    scrollSettleMs: 1500,
  },
}

const PROFILES: Record<string, PlatformCollectProfile> = {
  [XHS.platform]: XHS,
}

export function findCollectProfile(platform: string): PlatformCollectProfile | undefined {
  return PROFILES[platform]
}

export function listCollectPlatforms(): string[] {
  return Object.keys(PROFILES)
}
