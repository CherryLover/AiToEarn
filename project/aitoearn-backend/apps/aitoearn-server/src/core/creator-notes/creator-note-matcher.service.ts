import { Injectable, Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import {
  AngleRepository,
  CreatorNoteMatchState,
  LeanDoc,
  ProjectRepository,
  PublishedPost,
  PublishedPostLinkStatus,
  PublishedPostPublishStatus,
  PublishedPostRepository,
  PublishedPostSource,
} from '@yikart/mongodb'
import { DraftSnapshotService } from '../publishing/draft-snapshot.service'
import { toMinuteRange } from './creator-note-time'
import { DraftRef, DraftTitleIndexService, normalizeTitle, toTitlePrefix } from './draft-title-index.service'

/** 前缀命中多少条就不再往下数了：超过一条就已经是 ambiguous，数清楚没有意义 */
const CANDIDATE_LIMIT = 10

export interface MatchInput {
  userId: string
  platform: string
  accountId?: string
  title: string
  titleTruncated: boolean
  publishedAt?: Date
}

export interface MatchDecision {
  matchState: CreatorNoteMatchState
  matchedPublishedPostId?: string
  /** ambiguous 时的候选，网页上要显示出来人才知道该选哪个 */
  matchCandidates: string[]
}

const UNMATCHED: MatchDecision = {
  matchState: CreatorNoteMatchState.UNMATCHED,
  matchCandidates: [],
}

/**
 * 把一行采回来的数据归到某条帖子上。
 *
 * 三条规则按顺序试，第一条命中就停（contract-collect-xhs 第三节）。
 *
 * **不自动给所有帖子建发布记录**：用户账号里有 65 条帖子，只有 3 条属于这个项目。
 * 只有匹配上已知帖子或草稿的才建，其余留在落地表里当「未归属」，
 * 给 65 条全建记录的话，按方向聚合出来的数就全是噪音。
 */
@Injectable()
export class CreatorNoteMatcherService {
  private readonly logger = new Logger(CreatorNoteMatcherService.name)

  constructor(
    private readonly publishedPostRepository: PublishedPostRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly angleRepository: AngleRepository,
    private readonly draftSnapshotService: DraftSnapshotService,
    private readonly draftTitleIndexService: DraftTitleIndexService,
  ) {}

  async buildDraftIndex(userId: string): Promise<Map<string, DraftRef[]>> {
    return await this.draftTitleIndexService.buildByUserId(userId)
  }

  async match(input: MatchInput, draftIndex: Map<string, DraftRef[]>): Promise<MatchDecision> {
    const byPost = await this.matchKnownPost(input)
    if (byPost)
      return byPost

    return await this.matchDraft(input, draftIndex)
  }

  /** 规则 1：在已经登记过的发布记录里找 */
  private async matchKnownPost(input: MatchInput): Promise<MatchDecision | null> {
    const candidates = await this.findPostCandidates(input)
    if (candidates.length === 0)
      return null

    if (candidates.length > 1) {
      return {
        matchState: CreatorNoteMatchState.AMBIGUOUS,
        matchCandidates: candidates.map(post => post.id),
      }
    }

    return {
      matchState: CreatorNoteMatchState.MATCHED,
      matchedPublishedPostId: candidates[0]!.id,
      matchCandidates: [],
    }
  }

  private async findPostCandidates(input: MatchInput): Promise<LeanDoc<PublishedPost>[]> {
    // 标题完整、时间也解析出来了：这是最准的一条路，直接按「标题 + 同一分钟」找
    if (!input.titleTruncated && input.publishedAt) {
      const { minuteStart, minuteEnd } = toMinuteRange(input.publishedAt)
      const exact = await this.publishedPostRepository.listByPlatformAndTitleInMinute({
        userId: input.userId,
        platform: input.platform,
        title: input.title,
        minuteStart,
        minuteEnd,
      })
      if (exact.length > 0)
        return exact
    }

    const prefix = toTitlePrefix(input.title)
    if (prefix.length === 0)
      return []

    const byPrefix = await this.publishedPostRepository.listByPlatformAndTitlePrefix({
      userId: input.userId,
      platform: input.platform,
      titlePrefix: prefix,
      limit: CANDIDATE_LIMIT,
    })

    // 标题没被截断的话前缀只是兜底，仍然要求标题完全一致——
    // 否则「孕期日历」会把「孕期日历（第二版）」也算进来
    const narrowed = input.titleTruncated
      ? byPrefix
      : byPrefix.filter(post => normalizeTitle(post.snapshot.title) === normalizeTitle(input.title))

    if (!input.publishedAt || narrowed.length <= 1)
      return narrowed

    // 前缀撞上多条时，发布时间是唯一还能用的判据，用它再收一次
    const { minuteStart, minuteEnd } = toMinuteRange(input.publishedAt)
    const sameMinute = narrowed.filter((post) => {
      if (!post.publishedAt)
        return false

      const at = new Date(post.publishedAt).getTime()
      return at >= minuteStart.getTime() && at < minuteEnd.getTime()
    })

    return sameMinute.length > 0 ? sameMinute : narrowed
  }

  /** 规则 2：在所有项目的草稿里按标题找，命中唯一一份就替他建一条发布记录 */
  private async matchDraft(input: MatchInput, draftIndex: Map<string, DraftRef[]>): Promise<MatchDecision> {
    const drafts = this.findDraftCandidates(input, draftIndex)
    if (drafts.length === 0)
      return UNMATCHED

    if (drafts.length > 1) {
      return {
        matchState: CreatorNoteMatchState.AMBIGUOUS,
        matchCandidates: drafts.map(draft => draft.draftPath),
      }
    }

    const created = await this.createDiscoveredPost(input, drafts[0]!)
    if (!created)
      return UNMATCHED

    return {
      matchState: CreatorNoteMatchState.MATCHED,
      matchedPublishedPostId: created.id,
      matchCandidates: [],
    }
  }

  private findDraftCandidates(input: MatchInput, draftIndex: Map<string, DraftRef[]>): DraftRef[] {
    if (!input.titleTruncated)
      return draftIndex.get(normalizeTitle(input.title)) ?? []

    const prefix = normalizeTitle(toTitlePrefix(input.title))
    if (prefix.length === 0)
      return []

    const hits: DraftRef[] = []
    for (const [key, refs] of draftIndex) {
      if (key.startsWith(prefix))
        hits.push(...refs)

      if (hits.length > CANDIDATE_LIMIT)
        break
    }

    return hits
  }

  /**
   * 按草稿反查出来的帖子：建一条 `source: discovered` 的发布记录。
   *
   * 状态直接是 `published`：这条帖子本来就已经在平台上了，我们只是刚发现它。
   * 记成 pending 的话，网页上会多出一张「等你去发」的卡片，而那条帖子早就发出去了。
   */
  private async createDiscoveredPost(input: MatchInput, draft: DraftRef): Promise<LeanDoc<PublishedPost> | null> {
    const project = await this.projectRepository.getById(draft.projectId)
    if (!project)
      return null

    try {
      const full = await this.draftSnapshotService.read(project.dirName, draft.draftPath)
      const angleId = await this.resolveAngleId(project.id, full.angleSlug ?? draft.angleSlug)

      return await this.publishedPostRepository.create({
        userId: input.userId,
        userType: UserType.User,
        projectId: project.id,
        angleId,
        draftPath: full.draftPath,
        platform: input.platform,
        accountId: input.accountId,
        snapshot: full.snapshot,
        source: PublishedPostSource.DISCOVERED,
        publishStatus: PublishedPostPublishStatus.PUBLISHED,
        linkStatus: PublishedPostLinkStatus.NONE,
        publishedAt: input.publishedAt,
      })
    }
    catch (error) {
      // 反查失败只意味着这一行归不了属，采回来的数据照样存着
      this.logger.warn(error, `按草稿反查建发布记录失败: ${project.dirName}/${draft.draftPath}`)
      return null
    }
  }

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
}
