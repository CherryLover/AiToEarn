import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 接口契约守护。
 *
 * 这一层全是薄封装，本身没有分支逻辑，出事的方式只有一种：**路径或载荷被悄悄改掉**。
 * 后端改了路由、前端跟着改一半，页面上看到的是一个空列表或者一句「未知错误」，
 * 很难联想到是路径写错了。所以这里把每个函数发出去的
 * 方法、路径、载荷原样钉住——改接口时这些断言必须跟着一起改，改不动就说明改漏了地方。
 */

const httpMock = {
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  patch: vi.fn(),
}

vi.mock('@/utils/request', () => ({ default: httpMock }))

vi.mock('@/store/user', () => ({
  useUserStore: { getState: () => ({ token: 'test-token', lang: 'zh-CN' }) },
}))

const { createAngleApi, deleteAngleApi, deriveAngleApi, getAngleListApi, getAngleTreeApi, syncAnglesApi, updateAngleApi } = await import('../angles/angle.api')
const { adoptCreatorNoteRowApi, claimCreatorNoteRowApi, createSyncTaskApi, getCreatorNoteRowListApi, getPostMetricSeriesApi, getProjectAngleTotalsApi, getProjectMetricTrendsApi } = await import('../creator-notes/creator-notes.api')
const { createDevicePairingCodeApi, getDeviceListApi, revokeDeviceApi, updateDeviceApi } = await import('../devices/device.api')
const { cancelExecutionTaskApi, createEchoTaskApi, getExecutionTaskDetailApi, getExecutionTaskListApi, retryExecutionTaskApi } = await import('../devices/execution-task.api')
const { archiveProjectApi, createProjectApi, getProjectDetailApi, getProjectListApi, suggestProjectNameApi, updateProjectApi } = await import('../projects/project.api')
const { deleteProjectFileApi, getProjectFileTreeApi, mkdirProjectFileApi, readProjectFileApi, renameProjectFileApi, writeProjectFileApi } = await import('../projects/project-file.api')
const { completePublishedPostApi, createPublishFromDraftApi, deletePublishedPostApi, failPublishedPostApi, getPublishedPostDetailApi, getPublishedPostListApi } = await import('../publishing/publishing.api')

beforeEach(() => {
  for (const fn of Object.values(httpMock)) fn.mockReset()
})

/** [说明, 调用, 期望的 method, 期望的 path, 期望的载荷] */
type Case = [string, () => unknown, keyof typeof httpMock, string, unknown]

const CASES: Case[] = [
  // 项目
  ['建项目', () => createProjectApi({ name: 'a-b', displayName: '甲' }), 'post', 'projects/create', { name: 'a-b', displayName: '甲' }],
  ['项目列表不带筛选', () => getProjectListApi(), 'get', 'projects/list', undefined],
  ['项目列表带状态', () => getProjectListApi('archived' as never), 'get', 'projects/list', { status: 'archived' }],
  ['项目详情', () => getProjectDetailApi('p1'), 'get', 'projects/p1', undefined],
  ['改项目', () => updateProjectApi('p1', { displayName: '乙' } as never), 'post', 'projects/p1/update', { displayName: '乙' }],
  ['归档项目', () => archiveProjectApi('p1'), 'post', 'projects/p1/archive', undefined],
  ['建议英文名', () => suggestProjectNameApi(), 'get', 'projects/suggest-name', undefined],

  // 物料文件
  ['目录树', () => getProjectFileTreeApi('p1', { path: 'media', depth: 2 }), 'get', 'projects/p1/files/tree', { path: 'media', depth: 2 }],
  ['读文件', () => readProjectFileApi('p1', 'background/a.md'), 'get', 'projects/p1/files/read', { path: 'background/a.md' }],
  ['写文件', () => writeProjectFileApi('p1', { path: 'a.md', content: '正文' }), 'post', 'projects/p1/files/write', { path: 'a.md', content: '正文' }],
  ['建目录', () => mkdirProjectFileApi('p1', { path: 'media/new' }), 'post', 'projects/p1/files/mkdir', { path: 'media/new' }],
  ['改名', () => renameProjectFileApi('p1', { from: 'a.md', to: 'b.md' }), 'post', 'projects/p1/files/rename', { from: 'a.md', to: 'b.md' }],
  ['删文件', () => deleteProjectFileApi('p1', { path: 'a.md' }), 'post', 'projects/p1/files/delete', { path: 'a.md' }],

  // 方向
  ['方向列表', () => getAngleListApi('p1', { status: 'candidate' } as never), 'get', 'projects/p1/angles/list', { status: 'candidate' }],
  ['方向树', () => getAngleTreeApi('p1'), 'get', 'projects/p1/angles/tree', undefined],
  ['建方向', () => createAngleApi('p1', { slug: 'a-b', name: '甲' } as never), 'post', 'projects/p1/angles/create', { slug: 'a-b', name: '甲' }],
  ['改方向', () => updateAngleApi('p1', 'a1', { name: '乙' } as never), 'post', 'projects/p1/angles/a1/update', { name: '乙' }],
  ['派生方向', () => deriveAngleApi('p1', 'a1', { slug: 'a-b-2', name: '丙' } as never), 'post', 'projects/p1/angles/a1/derive', { slug: 'a-b-2', name: '丙' }],
  ['登记 AI 写出来的方向文件', () => syncAnglesApi('p1'), 'post', 'projects/p1/angles/sync', undefined],
  ['删方向', () => deleteAngleApi('p1', 'a1'), 'delete', 'projects/p1/angles/a1', undefined],

  // 发布
  ['从草稿建发布工单', () => createPublishFromDraftApi('p1', { draftPath: 'drafts/x', mode: 'manual' } as never), 'post', 'projects/p1/publishing/from-draft', { draftPath: 'drafts/x', mode: 'manual' }],
  ['发布记录列表', () => getPublishedPostListApi('p1', { publishStatus: 'pending' } as never), 'get', 'projects/p1/publishing/list', { publishStatus: 'pending' }],
  ['发布记录详情', () => getPublishedPostDetailApi('p1', 'r1'), 'get', 'projects/p1/publishing/r1', undefined],
  ['回填链接', () => completePublishedPostApi('p1', 'r1', { postUrl: 'https://a.com/x' } as never), 'post', 'projects/p1/publishing/r1/complete', { postUrl: 'https://a.com/x' }],
  ['标记失败', () => failPublishedPostApi('p1', 'r1', { reason: '限流' } as never), 'post', 'projects/p1/publishing/r1/fail', { reason: '限流' }],
  ['删发布记录', () => deletePublishedPostApi('p1', 'r1'), 'delete', 'projects/p1/publishing/r1', undefined],

  // 设备
  ['生成配对码', () => createDevicePairingCodeApi(), 'post', 'devices/pairing-code', undefined],
  ['设备列表', () => getDeviceListApi(), 'get', 'devices/list', undefined],
  ['改设备名', () => updateDeviceApi('d1', { name: '我的笔记本' } as never), 'post', 'devices/d1/update', { name: '我的笔记本' }],
  ['吊销设备', () => revokeDeviceApi('d1'), 'delete', 'devices/d1', undefined],

  // 工单
  ['工单列表', () => getExecutionTaskListApi({ projectId: 'p1' } as never), 'get', 'execution-tasks/list', { projectId: 'p1' }],
  ['工单详情', () => getExecutionTaskDetailApi('t1'), 'get', 'execution-tasks/t1', undefined],
  ['建 echo 工单', () => createEchoTaskApi({ deviceId: 'd1' } as never), 'post', 'execution-tasks/create-echo', { deviceId: 'd1' }],
  ['取消工单', () => cancelExecutionTaskApi('t1'), 'post', 'execution-tasks/t1/cancel', undefined],
  ['重试工单', () => retryExecutionTaskApi('t1'), 'post', 'execution-tasks/t1/retry', undefined],

  // 采集
  ['立刻采一次', () => createSyncTaskApi({ projectId: 'p1' } as never), 'post', 'creator-notes/sync', { projectId: 'p1' }],
  ['数据行列表', () => getCreatorNoteRowListApi({ matchState: 'unmatched' } as never), 'get', 'creator-notes/rows', { matchState: 'unmatched' }],
  ['认领一行', () => claimCreatorNoteRowApi('r1', 'post-1'), 'post', 'creator-notes/rows/r1/claim', { publishedPostId: 'post-1' }],
  ['把一行建成发布记录', () => adoptCreatorNoteRowApi('r1', { projectId: 'p1', angleId: 'a1' } as never), 'post', 'creator-notes/rows/r1/adopt', { projectId: 'p1', angleId: 'a1' }],
  ['单帖时间序列', () => getPostMetricSeriesApi('post-1'), 'get', 'creator-notes/posts/post-1/series', undefined],
  ['项目趋势', () => getProjectMetricTrendsApi('p1', { days: 7 } as never), 'get', 'creator-notes/projects/p1/trends', { days: 7 }],
  ['按方向汇总', () => getProjectAngleTotalsApi('p1'), 'get', 'creator-notes/projects/p1/angle-totals', undefined],
]

describe('接口路径与载荷', () => {
  it.each(CASES)('%s', (_name, call, method, path, payload) => {
    call()

    expect(httpMock[method]).toHaveBeenCalledTimes(1)
    const [actualPath, actualPayload] = httpMock[method].mock.calls[0]
    expect(actualPath).toBe(path)
    expect(actualPayload).toEqual(payload)
  })

  /** 一个都不能走错动词：把 delete 写成 post，服务端会当成未知路由 404 */
  it('每个调用只打一次，且没打到别的动词上', () => {
    for (const [, call, method] of CASES) {
      for (const fn of Object.values(httpMock)) fn.mockReset()
      call()
      for (const [name, fn] of Object.entries(httpMock))
        expect(fn.mock.calls.length, name).toBe(name === method ? 1 : 0)
    }
  })
})

/**
 * 「只登记、不代发」是这套设计的硬边界：
 * 网页这一侧不存在、也不该新增任何真正把内容发到平台的接口。
 */
describe('发布接口的边界', () => {
  it('从草稿建工单只接受 manual', () => {
    createPublishFromDraftApi('p1', { draftPath: 'drafts/x', mode: 'manual' } as never)
    expect(httpMock.post.mock.calls[0][1]).toMatchObject({ mode: 'manual' })
  })
})
