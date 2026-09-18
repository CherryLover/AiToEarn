import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import {
  AngleRepository,
  ExecutionTaskMode,
  ExecutionTaskRepository,
  ExecutionTaskType,
  PublishedPostLinkStatus,
  PublishedPostPublishStatus,
  PublishedPostRepository,
} from '@yikart/mongodb'
import { ExecutionTasksService } from '../execution-tasks/execution-tasks.service'
import { ProjectsService } from '../projects/projects.service'
import { DraftSnapshotService } from './draft-snapshot.service'
import {
  CompletePublishedPostDto,
  CreateFromDraftDto,
  FailPublishedPostDto,
  PublishedPostListQueryDto,
} from './publishing.dto'
import { PublishedPostDoc, PublishJobDraftNotes } from './publishing.vo'

const MONGO_DUPLICATE_KEY_ERROR = 11000

/**
 * 手动发布工单的 payload 里 `accountId` 的占位。
 *
 * 骨架第四节把 publish 载荷的 `accountId` 定成必填，阶段 4 又把 `/from-draft` 的
 * `accountId` 定成可选——手动发布本来就是人自己挑号，服务端不该逼他先选。
 * 两份契约在这里对不上，而 `task-payloads.ts` 是阶段 3 的文件，这一轮不能动，
 * 所以没填号时往载荷里放一个显式占位，而不是编一个看起来像真号的值。
 * 手动工单不进领取流程，设备永远读不到这个字段。
 */
export const MANUAL_ACCOUNT_PLACEHOLDER = 'manual'

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY_ERROR
}

export interface PublishJobCreated extends PublishJobDraftNotes {
  post: PublishedPostDoc
}

/**
 * 发布工单与发布记录。
 *
 * **这一轮不做真实发布**（contract-stage4）：这里只把草稿打包成一张「可以拿去发」的卡片，
 * 人自己去平台发，发完回来登记。任何平台接口都不调，`mode=auto` 直接拒绝。
 */
@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name)

  constructor(
    private readonly publishedPostRepository: PublishedPostRepository,
    private readonly executionTaskRepository: ExecutionTaskRepository,
    private readonly angleRepository: AngleRepository,
    private readonly projectsService: ProjectsService,
    private readonly draftSnapshotService: DraftSnapshotService,
    private readonly executionTasksService: ExecutionTasksService,
  ) {}

  /**
   * 从一份草稿建发布工单。
   *
   * 顺序是「先读文件抄快照 → 建记录 → 建工单 → 回填工单 id」，
   * 后面任何一步失败都把前面建出来的清理掉：
   * 留下一条没有工单的记录，等于网页上多出一张永远发不掉的卡片。
   */
  async createFromDraft(projectId: string, userId: string, dto: CreateFromDraftDto): Promise<PublishJobCreated> {
    const project = await this.projectsService.getWritableProject(projectId, userId)

    // 红线：自动发布要执行端插件，这一轮没有。不悄悄降级成 manual，免得人以为系统替他发了
    if (dto.mode !== ExecutionTaskMode.MANUAL)
      throw new AppException(ResponseCode.PublishedPostAutoModeNotSupported)

    const draft = await this.draftSnapshotService.read(project.dirName, dto.draftPath)
    const angleId = await this.resolveAngleId(project.id, draft.angleSlug)

    const post = await this.publishedPostRepository.create({
      userId,
      userType: UserType.User,
      projectId: project.id,
      angleId,
      draftPath: draft.draftPath,
      platform: dto.platform,
      accountId: dto.accountId,
      snapshot: draft.snapshot,
      publishStatus: PublishedPostPublishStatus.PENDING,
      linkStatus: PublishedPostLinkStatus.NONE,
    })

    let taskId: string | undefined
    try {
      const task = await this.executionTasksService.create(userId, {
        projectId: project.id,
        angleId,
        type: ExecutionTaskType.PUBLISH,
        mode: ExecutionTaskMode.MANUAL,
        requiredCapability: dto.platform,
        payload: {
          platform: dto.platform,
          accountId: dto.accountId || MANUAL_ACCOUNT_PLACEHOLDER,
          draftPath: draft.draftPath,
          snapshot: draft.snapshot,
        },
      })
      taskId = task.id

      const updated = await this.publishedPostRepository.updateExecutionTaskIdById(post.id, task.id)
      if (!updated)
        throw new AppException(ResponseCode.PublishedPostCreateFailed)

      return {
        post: updated,
        skippedMedia: draft.skippedMedia,
        // 草稿读出来才知道的两件事，只在这一刻说得清：一张图都没声明、正文是整篇原文兜出来的
        mediaDeclared: draft.mediaDeclared,
        bodyFallback: draft.bodyFallback,
      }
    }
    catch (error) {
      await this.rollbackCreate(post.id, taskId)

      if (error instanceof AppException)
        throw error

      this.logger.error(error, `建发布工单失败，已清理发布记录 ${post.id}`)
      throw new AppException(ResponseCode.PublishedPostCreateFailed)
    }
  }

  async listWithPagination(projectId: string, userId: string, query: PublishedPostListQueryDto) {
    const project = await this.projectsService.getWritableProject(projectId, userId)

    return await this.publishedPostRepository.listWithPagination({
      userId,
      projectId: project.id,
      angleId: query.angleId,
      platform: query.platform,
      publishStatus: query.publishStatus,
      linkStatus: query.linkStatus,
      page: query.page,
      pageSize: query.pageSize,
    })
  }

  async getDetail(projectId: string, id: string, userId: string): Promise<PublishedPostDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    return await this.getOwnedPost(project.id, id, userId)
  }

  /**
   * 人工回填：你自己发完了，把链接贴回来。
   *
   * 两个状态一起推到位：发布状态 `published`、链接状态 `claimed`。
   * 记录先落，再去动工单：记录才是发布这件事的事实，
   * 工单没能跟着转只记日志，不能让人「明明发出去了却登记不上」。
   *
   * 「先点发失败、后来又真发出去了」这个顺序是走得通的：记录本来就允许 failed → published，
   * 工单那边 `updateAsManuallySucceededById` 也认 `cancelled`，两边一起回到成功，
   * 不会给阶段 5 的统计留一条没有工单的帖子。
   */
  async complete(
    projectId: string,
    id: string,
    userId: string,
    dto: CompletePublishedPostDto,
  ): Promise<PublishedPostDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const post = await this.getOwnedPost(project.id, id, userId)

    const postUrl = this.normalizePostUrl(dto.postUrl)
    const platformPostId = dto.platformPostId?.trim() || undefined

    if (post.publishStatus === PublishedPostPublishStatus.PUBLISHED)
      throw new AppException(ResponseCode.PublishedPostAlreadyCompleted)

    // 唯一索引兜底，但先查一次，好给人话而不是一个数据库报错
    if (platformPostId && await this.publishedPostRepository.countByPlatformPostId(post.platform, platformPostId, post.id) > 0)
      throw new AppException(ResponseCode.PublishedPostDuplicate)

    let updated: PublishedPostDoc | null
    try {
      updated = await this.publishedPostRepository.updateAsPublishedById({
        id: post.id,
        userId,
        postUrl,
        platformPostId,
        publishedAt: new Date(),
      })
    }
    catch (error) {
      if (isDuplicateKeyError(error))
        throw new AppException(ResponseCode.PublishedPostDuplicate)

      throw error
    }

    if (!updated)
      throw new AppException(ResponseCode.PublishedPostAlreadyCompleted)

    await this.completeTask(updated, { platformPostId: platformPostId ?? null, postUrl })
    return updated
  }

  /**
   * 人工标记发失败：记录转 failed，对应的手动工单一并取消。
   * 取消不是终点——后来真发出去了还能回来点「我发好了」，见 `complete`。
   */
  async fail(projectId: string, id: string, userId: string, dto: FailPublishedPostDto): Promise<PublishedPostDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const post = await this.getOwnedPost(project.id, id, userId)

    if (post.publishStatus === PublishedPostPublishStatus.PUBLISHED)
      throw new AppException(ResponseCode.PublishedPostAlreadyCompleted)

    const updated = await this.publishedPostRepository.updateAsFailedById(post.id, userId, dto.reason.trim())
    if (!updated)
      throw new AppException(ResponseCode.PublishedPostStatusInvalid)

    await this.cancelTask(updated)
    return updated
  }

  /** 删掉这条登记：记录和工单一起删，草稿文件不碰 */
  async remove(projectId: string, id: string, userId: string): Promise<{ id: string, executionTaskId: string | null }> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const post = await this.getOwnedPost(project.id, id, userId)

    // 先删记录再删工单：反过来的话，工单删掉而记录没删成，
    // 网页上会剩下一张指着空工单、永远点不动的卡片
    const deleted = await this.publishedPostRepository.deleteByIdAndUserId(post.id, userId)
    if (!deleted)
      throw new AppException(ResponseCode.PublishedPostNotFound)

    const deletedTaskId = await this.deleteTask(post)
    return { id: post.id, executionTaskId: deletedTaskId }
  }

  // ========== 内部 ==========

  private async getOwnedPost(projectId: string, id: string, userId: string): Promise<PublishedPostDoc> {
    const post = await this.publishedPostRepository.getByIdAndUserId(id, userId)
    if (!post)
      throw new AppException(ResponseCode.PublishedPostNotFound)

    if (post.projectId !== projectId)
      throw new AppException(ResponseCode.PublishedPostProjectMismatch)

    return post
  }

  /** 草稿血缘里记的是方向 slug，数据库里要的是方向 id；对不上就不挂，归因缺一条好过挂错 */
  private async resolveAngleId(projectId: string, angleSlug?: string): Promise<string | undefined> {
    if (!angleSlug)
      return undefined

    const angle = await this.angleRepository.getBySlug(projectId, angleSlug)
    if (!angle) {
      this.logger.warn(`草稿血缘里的方向 ${angleSlug} 在项目 ${projectId} 里找不到，这条发布记录不挂方向`)
      return undefined
    }

    return angle.id
  }

  private normalizePostUrl(input: string): string {
    const url = input.trim()
    if (!/^https?:\/\//i.test(url))
      throw new AppException(ResponseCode.PublishedPostUrlInvalid)

    try {
      // eslint-disable-next-line no-new
      new URL(url)
    }
    catch {
      throw new AppException(ResponseCode.PublishedPostUrlInvalid)
    }

    return url
  }

  /** 建到一半失败时把已经建出来的清理干净，清理本身再失败也只记日志 */
  private async rollbackCreate(postId: string, taskId?: string): Promise<void> {
    if (taskId) {
      try {
        await this.executionTaskRepository.deleteById(taskId)
      }
      catch (error) {
        this.logger.error(error, `回滚时删执行工单失败，留下一条孤儿工单 ${taskId}`)
      }
    }

    try {
      await this.publishedPostRepository.deleteById(postId)
    }
    catch (error) {
      this.logger.error(error, `回滚时删发布记录失败，留下一条孤儿记录 ${postId}`)
    }
  }

  /** 把手动工单转成功，结果照骨架第四节的 publish result 写进去 */
  private async completeTask(post: PublishedPostDoc, result: Record<string, unknown>): Promise<void> {
    if (!post.executionTaskId)
      return

    try {
      await this.executionTasksService.completeManual(post.executionTaskId, post.userId, result)
    }
    catch (error) {
      this.logger.warn(error, `发布记录 ${post.id} 已登记成功，但工单 ${post.executionTaskId} 没能跟着转成功`)
    }
  }

  private async cancelTask(post: PublishedPostDoc): Promise<void> {
    if (!post.executionTaskId)
      return

    try {
      await this.executionTaskRepository.updateAsCancelledById(post.executionTaskId, post.userId, new Date())
    }
    catch (error) {
      this.logger.warn(error, `发布记录 ${post.id} 已标记失败，但工单 ${post.executionTaskId} 没能取消`)
    }
  }

  /** 删记录时一并删工单。工单找不到（已经被别处删了）不算失败 */
  private async deleteTask(post: PublishedPostDoc): Promise<string | null> {
    if (!post.executionTaskId)
      return null

    try {
      const task = await this.executionTaskRepository.getByIdAndUserId(post.executionTaskId, post.userId)
      if (!task)
        return null

      await this.executionTaskRepository.deleteById(task.id)
      return task.id
    }
    catch (error) {
      this.logger.error(error, `删发布记录时删工单 ${post.executionTaskId} 失败`)
      return null
    }
  }
}
