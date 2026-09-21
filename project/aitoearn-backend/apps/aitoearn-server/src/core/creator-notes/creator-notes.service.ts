import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import {
  AngleRepository,
  CreatorNoteMatchState,
  CreatorNoteRowRepository,
  DeviceRepository,
  ExecutionTaskMode,
  ExecutionTaskRepository,
  ExecutionTaskType,
  PostMetricRepository,
  ProjectRepository,
  ProjectStatus,
  PublishedPostLinkStatus,
  PublishedPostPublishStatus,
  PublishedPostRepository,
  PublishedPostSource,
} from '@yikart/mongodb'
import { ExecutionTasksService } from '../execution-tasks/execution-tasks.service'
import { findCollectProfile } from './collect-specs'
import {
  AdoptCreatorNoteRowDto,
  ClaimCreatorNoteRowDto,
  CreateSyncTaskDto,
  CreatorNoteRowListQueryDto,
  ProjectMetricsQueryDto,
} from './creator-notes.dto'

/** 趋势聚合默认只看最近这么多天，`since` 是给聚合兜底的窗口，不是展示过滤 */
const DEFAULT_TREND_DAYS = 30

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

@Injectable()
export class CreatorNotesService {
  private readonly logger = new Logger(CreatorNotesService.name)

  constructor(
    private readonly creatorNoteRowRepository: CreatorNoteRowRepository,
    private readonly postMetricRepository: PostMetricRepository,
    private readonly publishedPostRepository: PublishedPostRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly angleRepository: AngleRepository,
    private readonly deviceRepository: DeviceRepository,
    private readonly executionTaskRepository: ExecutionTaskRepository,
    private readonly executionTasksService: ExecutionTasksService,
  ) {}

  // ========== 建采集工单 ==========

  /**
   * 建一个采集工单。
   *
   * 规格由服务端下发，用户不填：规格里全是选择器和图标指纹，
   * 让用户填等于把「赞和评论会不会对调」这种事交给他去核对。
   *
   * 工单一定带 `targetDeviceId`：创作平台要登录态，只有用户那台登录着的机器跑得了，
   * 派给别的机器只会失败到重试用尽。
   */
  async createSyncTask(userId: string, dto: CreateSyncTaskDto) {
    const profile = findCollectProfile(dto.platform)
    if (!profile)
      throw new AppException(ResponseCode.CreatorNoteSyncNoCollectSpec)

    const deviceId = dto.targetDeviceId ?? await this.pickCapableDeviceId(userId, dto.platform)
    const projectId = dto.projectId ?? await this.pickProjectId(userId)

    return await this.executionTasksService.create(userId, {
      projectId,
      type: ExecutionTaskType.SYNC_CREATOR_NOTES,
      mode: ExecutionTaskMode.AUTO,
      targetDeviceId: deviceId,
      requiredCapability: dto.platform,
      payload: {
        platform: profile.platform,
        accountId: dto.accountId,
        entryUrl: profile.entryUrl,
        spec: profile.spec,
      },
    })
  }

  /** 没有会干这活的机器时直接拒绝，而不是建一个注定 failed 的工单 */
  private async pickCapableDeviceId(userId: string, platform: string): Promise<string> {
    const devices = await this.deviceRepository.listCapableByUserId(userId, [
      platform,
      `job:${ExecutionTaskType.SYNC_CREATOR_NOTES}`,
    ])

    if (devices.length === 0)
      throw new AppException(ResponseCode.ExecutionTaskNoCapableDevice)

    return devices[0]!.id
  }

  /**
   * 采集是按「平台 + 账号」来的，跟项目没关系，但工单模型要求有 `projectId`。
   *
   * 挂在哪个项目上不影响归因：每一行采回来的数据是在匹配那一步各归各的项目的，
   * 工单上的 `projectId` 只是工单列表里的一个筛选维度。
   */
  private async pickProjectId(userId: string): Promise<string> {
    const projects = await this.projectRepository.listByUserId(userId)
    if (projects.length === 0)
      throw new AppException(ResponseCode.ProjectNotFound)

    return projects[0]!.id
  }

  // ========== 落地数据 ==========

  async listRowsWithPagination(userId: string, query: CreatorNoteRowListQueryDto) {
    return await this.creatorNoteRowRepository.listWithPagination({ userId, ...query })
  }

  async countUnmatched(userId: string): Promise<number> {
    return await this.creatorNoteRowRepository.countByUserIdAndMatchState(
      userId,
      CreatorNoteMatchState.UNMATCHED,
    )
  }

  /**
   * 人工认领一行未归属的数据。
   *
   * 认领完要把这一行的快照补上：不补的话，网页上这条帖子明明归属了，
   * 折线却是空的，得等下一次采集（最长 3 小时）才出现第一个点。
   */
  async claimRow(userId: string, rowId: string, dto: ClaimCreatorNoteRowDto) {
    const row = await this.creatorNoteRowRepository.getByIdAndUserId(rowId, userId)
    if (!row)
      throw new AppException(ResponseCode.CreatorNoteRowNotFound)

    if (row.matchState === CreatorNoteMatchState.MATCHED)
      throw new AppException(ResponseCode.CreatorNoteRowAlreadyMatched)

    const post = await this.publishedPostRepository.getByIdAndUserId(dto.publishedPostId, userId)
    if (!post)
      throw new AppException(ResponseCode.PublishedPostNotFound)

    const updated = await this.creatorNoteRowRepository.updateAsMatchedById(rowId, userId, post.id)
    if (!updated)
      throw new AppException(ResponseCode.CreatorNoteRowAlreadyMatched)

    await this.postMetricRepository.createIfAbsent({
      userId,
      userType: UserType.User,
      publishedPostId: post.id,
      projectId: post.projectId,
      angleId: post.angleId,
      platform: post.platform,
      metrics: updated.metrics,
      collectedAt: updated.collectedAt,
      sourceRowId: updated.id,
      executionTaskId: updated.executionTaskId,
    })

    return updated
  }

  /**
   * 把一行未归属的数据直接建成一条发布记录。
   *
   * 场景是「这条内容是我自己做的，只是一开始没走系统」：认领需要先有一条发布记录，
   * 而这种帖子系统里根本没有对应记录，光有认领就成了死路。
   *
   * 建出来的记录标 `source: discovered`，跟走过发布流程的分开：
   * 它没有草稿、正文是空的（平台的作品列表页上只有标题、时间和五个数字，没有正文），
   * 混在一起会让人以为项目里存着这篇内容。
   */
  async adoptRow(userId: string, rowId: string, dto: AdoptCreatorNoteRowDto) {
    const row = await this.creatorNoteRowRepository.getByIdAndUserId(rowId, userId)
    if (!row)
      throw new AppException(ResponseCode.CreatorNoteRowNotFound)

    if (row.matchState === CreatorNoteMatchState.MATCHED)
      throw new AppException(ResponseCode.CreatorNoteRowAlreadyMatched)

    const project = await this.projectRepository.getById(dto.projectId)
    if (!project || project.userId !== userId)
      throw new AppException(ResponseCode.ProjectNotFound)

    if (project.status === ProjectStatus.ARCHIVED)
      throw new AppException(ResponseCode.ProjectArchived)

    const angleId = await this.resolveAngleId(project.id, dto.angleId)

    const post = await this.publishedPostRepository.create({
      userId,
      userType: UserType.User,
      projectId: project.id,
      angleId,
      platform: row.platform,
      accountId: row.accountId,
      snapshot: { title: row.title, body: '', topics: [], mediaUrls: [] },
      source: PublishedPostSource.DISCOVERED,
      publishStatus: PublishedPostPublishStatus.PUBLISHED,
      linkStatus: PublishedPostLinkStatus.NONE,
      publishedAt: row.publishedAt,
    })

    if (!post)
      throw new AppException(ResponseCode.CreatorNoteRowAdoptFailed)

    // 建完立刻按认领那条路走一遍：归属 + 补第一个快照，
    // 不然人刚建完记录，数据页上这条帖子是一条空折线，要等下一次采集才有点
    return await this.claimRow(userId, rowId, { publishedPostId: post.id })
  }

  private async resolveAngleId(projectId: string, angleId?: string): Promise<string | undefined> {
    if (!angleId)
      return undefined

    const angle = await this.angleRepository.getById(angleId)
    if (!angle || angle.projectId !== projectId)
      throw new AppException(ResponseCode.AngleNotFound)

    return angle.id
  }

  // ========== 数据页 ==========

  /** 某条帖子的时间序列，早的在前 */
  async listSeriesByPublishedPostId(userId: string, publishedPostId: string) {
    const post = await this.publishedPostRepository.getByIdAndUserId(publishedPostId, userId)
    if (!post)
      throw new AppException(ResponseCode.PublishedPostNotFound)

    return await this.postMetricRepository.listByPublishedPostId(post.id, userId)
  }

  /**
   * 项目（或某个方向）下每条帖子的当前值和变化趋势，最新发布的排最前。
   *
   * 标题和发布时间在这里配上，而不是让网页再拉一遍发布记录列表去对：
   * 那样排序就只能在网页拿到的那一页里做，超出那一页的帖子会排到末尾，
   * 而「最新发的排最上面」恰恰是最容易被这件事破坏的。
   */
  async listProjectTrends(userId: string, projectId: string, query: ProjectMetricsQueryDto) {
    const trends = await this.postMetricRepository.listTrendsByProjectId({
      userId,
      projectId,
      angleId: query.angleId,
      since: daysAgo(query.days ?? DEFAULT_TREND_DAYS),
    })

    const posts = await this.publishedPostRepository.listByIds(
      trends.map(trend => trend.publishedPostId),
      userId,
    )
    const postById = new Map(posts.map(post => [post.id, post]))

    return trends
      .map((trend) => {
        const post = postById.get(trend.publishedPostId)
        return {
          ...trend,
          title: post?.snapshot.title || post?.draftPath || '',
          publishedAt: post?.publishedAt,
        }
      })
      .sort((left, right) => {
        // 没有发布时间的排最后：它们是没登记过发布时间的老记录，
        // 当成「很久以前」比当成「刚刚」诚实
        const leftAt = left.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY
        const rightAt = right.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY
        if (leftAt !== rightAt)
          return rightAt - leftAt

        return right.latestCollectedAt.getTime() - left.latestCollectedAt.getTime()
      })
  }

  /** 按方向聚合：这才是整套设计的目的 */
  async listAngleTotals(userId: string, projectId: string, query: ProjectMetricsQueryDto) {
    return await this.postMetricRepository.listAngleTotalsByProjectId({
      userId,
      projectId,
      since: daysAgo(query.days ?? DEFAULT_TREND_DAYS),
    })
  }

  /** 这个用户现在还有没有没跑完的采集工单，调度和网页都要问 */
  async countActiveSyncTasks(userId: string): Promise<number> {
    return await this.executionTaskRepository.countActiveByUserIdAndType(
      userId,
      ExecutionTaskType.SYNC_CREATOR_NOTES,
    )
  }
}
