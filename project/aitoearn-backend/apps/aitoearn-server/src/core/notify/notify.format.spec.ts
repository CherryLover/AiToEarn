import { describe, expect, it } from 'vitest'
import {
  draftReadyMessage,
  flattenText,
  joinParts,
  manualPublishMessage,
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  truncateText,
} from './notify.format'

describe('推送文案截断', () => {
  it('没超长的原样返回', () => {
    expect(truncateText('新草稿生成好了', 30)).toBe('新草稿生成好了')
  })

  it('超长的截到上限，末尾补省略号，长度不超过上限', () => {
    const long = '正'.repeat(200)
    const cut = truncateText(long, NOTIFY_BODY_MAX)

    expect(Array.from(cut)).toHaveLength(NOTIFY_BODY_MAX)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.startsWith('正正正')).toBe(true)
  })

  it('标题和正文用的是各自的上限', () => {
    expect(NOTIFY_TITLE_MAX).toBe(30)
    expect(NOTIFY_BODY_MAX).toBe(100)
    expect(Array.from(truncateText('标'.repeat(50), NOTIFY_TITLE_MAX))).toHaveLength(30)
  })

  it('按码点切，不会把 emoji 劈成半个', () => {
    const cut = truncateText('🎉'.repeat(10), 5)

    expect(Array.from(cut)).toHaveLength(5)
    expect(cut).toBe('🎉🎉🎉🎉…')
    expect(cut).not.toContain('�')
  })

  it('换行和连续空白压成一个空格：推送是提醒，不该带排版', () => {
    expect(flattenText('第一行\n\n  第二行\t第三行  ')).toBe('第一行 第二行 第三行')
    expect(truncateText('标题\n正文', 30)).toBe('标题 正文')
  })

  it('上限为 0 或 1 时不越界', () => {
    expect(truncateText('随便什么', 0)).toBe('')
    expect(truncateText('随便什么', 1)).toBe('…')
    expect(truncateText('短', 1)).toBe('短')
  })

  it('拼接时空段直接丢掉，不留下多余分隔符', () => {
    expect(joinParts(['a', '', undefined, null, ' ', 'b'])).toBe('a · b')
    expect(joinParts([])).toBe('')
  })
})

describe('两个推送点的文案', () => {
  it('草稿生成完：项目、方向、平台、标题都在正文里', () => {
    const message = draftReadyMessage({
      projectName: 'fortyweeks',
      angle: 'pain-point',
      platform: 'xhs',
      draftTitle: '导出藏得太深，四步变一步',
    })

    expect(message.title).toBe('✅ 新草稿生成好了')
    expect(message.body).toBe('fortyweeks · pain-point · xhs · 导出藏得太深，四步变一步')
  })

  it('草稿生成完：只知道项目名也能出一条话', () => {
    expect(draftReadyMessage({ projectName: 'fortyweeks' }).body).toBe('fortyweeks')
  })

  it('草稿生成完：一轮出了好几份就点一下数量', () => {
    const message = draftReadyMessage({ projectName: 'fortyweeks', draftCount: 3 })

    expect(message.body).toContain('等 3 份')
  })

  it('有工单等着人工发：标题写明要人动手', () => {
    const message = manualPublishMessage({ platform: 'xhs', title: '导出藏得太深' })

    expect(message.title).toBe('📝 有一条等你去发')
    expect(message.body).toBe('xhs · 导出藏得太深 · 发完回网页登记链接')
  })
})
