import { describe, expect, it, vi } from 'vitest'
import {
  PublishedPostDeletedVo,
  toPublishedPostDetailVo,
  toPublishedPostListItemVo,
  toPublishJobCreatedVo,
} from './publishing.vo'

// 只要两个枚举；真的加载 @yikart/mongodb 会把全部 schema 装饰器跑一遍
vi.mock('@yikart/mongodb', () => ({
  PublishedPost: class PublishedPost {},
  PublishedPostPublishStatus: {
    PENDING: 'pending',
    PUBLISHING: 'publishing',
    PUBLISHED: 'published',
    FAILED: 'failed',
  },
  PublishedPostLinkStatus: { NONE: 'none', CLAIMED: 'claimed', CLAIM_FAILED: 'claim_failed' },
}))

const NOW = new Date('2026-09-18T05:00:00.000Z')

function postDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: '68c4b3f0a1b2c3d4e5f60001',
    userId: 'user-1',
    projectId: '68c4b3f0a1b2c3d4e5f60718',
    draftPath: 'drafts/2026-09-18-xhs-export-friction',
    platform: 'xhs',
    snapshot: {
      title: '导出藏得太深，四步变一步',
      body: '正文第一段。',
      topics: ['效率工具'],
      mediaUrls: ['https://oss.example.com/k/home.png'],
    },
    publishStatus: 'pending',
    linkStatus: 'none',
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as never
}

describe('发布记录 VO', () => {
  it('列表项不带正文，但带标题和图片张数，够列一张表', () => {
    const vo = toPublishedPostListItemVo(postDoc())

    expect(vo.title).toBe('导出藏得太深，四步变一步')
    expect(vo.mediaCount).toBe(1)
    expect(vo).not.toHaveProperty('snapshot')
  })

  it('两个状态分开出，没有合成一个字段', () => {
    const vo = toPublishedPostDetailVo(postDoc({
      publishStatus: 'published',
      linkStatus: 'claim_failed',
      postUrl: null,
    }))

    expect(vo.publishStatus).toBe('published')
    expect(vo.linkStatus).toBe('claim_failed')
    expect(vo.postUrl).toBeNull()
  })

  it('详情带完整快照', () => {
    const vo = toPublishedPostDetailVo(postDoc())

    expect(vo.snapshot).toEqual({
      title: '导出藏得太深，四步变一步',
      body: '正文第一段。',
      topics: ['效率工具'],
      mediaUrls: ['https://oss.example.com/k/home.png'],
    })
  })

  it('没填的字段一律出成 null，不出成 undefined', () => {
    const vo = toPublishedPostDetailVo(postDoc())

    expect(vo.angleId).toBeNull()
    expect(vo.accountId).toBeNull()
    expect(vo.executionTaskId).toBeNull()
    expect(vo.platformPostId).toBeNull()
    expect(vo.publishedAt).toBeNull()
    expect(vo.failReason).toBeNull()
  })

  it('建单返回里带着被跳过的图片，让人知道少了什么', () => {
    const vo = toPublishJobCreatedVo(postDoc(), [{ path: 'media/broken.png', reason: 'oss_missing' }])

    expect(vo.post.title).toBe('导出藏得太深，四步变一步')
    expect(vo.skippedMedia).toEqual([{ path: 'media/broken.png', reason: 'oss_missing' }])
  })

  it('删除返回记录 id 和一并删掉的工单 id', () => {
    const vo = PublishedPostDeletedVo.create({
      id: '68c4b3f0a1b2c3d4e5f60001',
      executionTaskId: null,
    })

    expect(vo.executionTaskId).toBeNull()
  })
})
