import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findDraftWrittenSince } from './draft-summary'

describe('认出这一轮新写出来的草稿', () => {
  let projectDir: string
  let draftsDir: string
  let taskStartedAt: Date

  /** 造一份草稿，并把目录时间戳设成指定时刻 */
  function writeDraft(name: string, options: {
    content?: string
    meta?: Record<string, unknown> | string
    at: Date
  }) {
    const dir = join(draftsDir, name)
    mkdirSync(dir, { recursive: true })

    if (options.content !== undefined)
      writeFileSync(join(dir, 'content.md'), options.content)

    if (options.meta !== undefined) {
      const text = typeof options.meta === 'string' ? options.meta : JSON.stringify(options.meta)
      writeFileSync(join(dir, 'meta.json'), text)
    }

    const seconds = options.at.getTime() / 1000
    utimesSync(dir, seconds, seconds)
    return dir
  }

  const draftContent = [
    '---',
    'title: 导出藏得太深，四步变一步',
    'platform: xhs',
    'angle: export-friction',
    'topics:',
    '  - 效率工具',
    '---',
    '',
    '正文原样写在这里。',
  ].join('\n')

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'aitoearn-drafts-'))
    draftsDir = join(projectDir, 'drafts')
    mkdirSync(draftsDir, { recursive: true })
    taskStartedAt = new Date('2026-09-18T10:00:00Z')
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  it('这一轮写出来的草稿：标题、方向、平台都读得到', async () => {
    writeDraft('2026-09-18-xhs-export-friction', {
      content: draftContent,
      meta: { projectName: 'fortyweeks', angleSlug: 'export-friction', platform: 'xhs' },
      at: new Date('2026-09-18T10:05:00Z'),
    })

    const summary = await findDraftWrittenSince(projectDir, taskStartedAt)

    expect(summary).toMatchObject({
      dirName: '2026-09-18-xhs-export-friction',
      title: '导出藏得太深，四步变一步',
      angle: 'export-friction',
      platform: 'xhs',
      count: 1,
    })
  })

  it('这一轮什么都没写就返回 null：提炼方向、闲聊这类任务不会误报', async () => {
    writeDraft('2026-09-01-xhs-old', {
      content: draftContent,
      at: new Date('2026-09-01T10:00:00Z'),
    })

    expect(await findDraftWrittenSince(projectDir, taskStartedAt)).toBeNull()
  })

  it('一轮出了好几份就报最新那份，并带上份数', async () => {
    writeDraft('2026-09-18-xhs-a', { content: draftContent, at: new Date('2026-09-18T10:01:00Z') })
    writeDraft('2026-09-18-xhs-b', {
      content: draftContent.replace('导出藏得太深，四步变一步', '第二份'),
      at: new Date('2026-09-18T10:09:00Z'),
    })

    const summary = await findDraftWrittenSince(projectDir, taskStartedAt)

    expect(summary?.dirName).toBe('2026-09-18-xhs-b')
    expect(summary?.title).toBe('第二份')
    expect(summary?.count).toBe(2)
  })

  it('meta.json 写坏了不影响推送，标题和平台还能从 content.md 拿到', async () => {
    writeDraft('2026-09-18-xhs-broken-meta', {
      content: draftContent,
      meta: '{ 不是合法 JSON',
      at: new Date('2026-09-18T10:05:00Z'),
    })

    const summary = await findDraftWrittenSince(projectDir, taskStartedAt)

    expect(summary?.title).toBe('导出藏得太深，四步变一步')
    expect(summary?.platform).toBe('xhs')
  })

  it('平台中立的草稿：平台是空，不硬塞一个进去', async () => {
    writeDraft('2026-09-18-general-export-friction', {
      content: draftContent.replace('platform: xhs', 'platform: \'\''),
      meta: { angleSlug: 'export-friction', platform: '' },
      at: new Date('2026-09-18T10:05:00Z'),
    })

    const summary = await findDraftWrittenSince(projectDir, taskStartedAt)

    expect(summary?.platform).toBeUndefined()
    expect(summary?.angle).toBe('export-friction')
  })

  it('drafts 目录不存在就返回 null，不抛错', async () => {
    rmSync(draftsDir, { recursive: true, force: true })

    expect(await findDraftWrittenSince(projectDir, taskStartedAt)).toBeNull()
  })

  it('content.md 是指向项目外的软链就不读，外面的内容进不了推送正文', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'aitoearn-outside-'))
    try {
      const secret = join(outside, 'secret.md')
      writeFileSync(secret, '---\ntitle: 项目外的东西\n---\n')

      const dir = writeDraft('2026-09-18-xhs-symlinked-content', { at: new Date('2026-09-18T10:05:00Z') })
      symlinkSync(secret, join(dir, 'content.md'))
      const seconds = new Date('2026-09-18T10:05:00Z').getTime() / 1000
      utimesSync(dir, seconds, seconds)

      const summary = await findDraftWrittenSince(projectDir, taskStartedAt)

      // 目录本身是这一轮新写的，认；但标题读不到，推送只会带目录名
      expect(summary?.dirName).toBe('2026-09-18-xhs-symlinked-content')
      expect(summary?.title).toBeUndefined()
    }
    finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('草稿目录本身是软链就跳过，哪怕指向的地方刚动过', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'aitoearn-outside-'))
    try {
      const fake = join(outside, 'fake-draft')
      mkdirSync(fake, { recursive: true })
      writeFileSync(join(fake, 'content.md'), draftContent)
      const seconds = new Date('2026-09-18T10:05:00Z').getTime() / 1000
      utimesSync(fake, seconds, seconds)

      symlinkSync(fake, join(draftsDir, '2026-09-18-xhs-linked-dir'))

      expect(await findDraftWrittenSince(projectDir, taskStartedAt)).toBeNull()
    }
    finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })

  it('调用方给的路径守卫说不行就不读：拦下 content.md 后标题是空的', async () => {
    writeDraft('2026-09-18-xhs-guarded', {
      content: draftContent,
      at: new Date('2026-09-18T10:05:00Z'),
    })

    const summary = await findDraftWrittenSince(projectDir, taskStartedAt, {
      assertInside: (candidate) => {
        if (candidate.endsWith('content.md'))
          throw new Error('越界')
      },
    })

    expect(summary?.dirName).toBe('2026-09-18-xhs-guarded')
    expect(summary?.title).toBeUndefined()
  })

  it('只看目录，散落在 drafts 下的单个文件不算草稿', async () => {
    const stray = join(draftsDir, 'notes.md')
    writeFileSync(stray, 'x')
    const seconds = new Date('2026-09-18T10:05:00Z').getTime() / 1000
    utimesSync(stray, seconds, seconds)

    expect(await findDraftWrittenSince(projectDir, taskStartedAt)).toBeNull()
  })
})
