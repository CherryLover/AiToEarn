import { Injectable, Logger } from '@nestjs/common'
import { UserType } from '@yikart/common'
import {
  CreatorNoteMatchState,
  CreatorNoteMetrics,
  CreatorNoteRow,
  CreatorNoteRowRepository,
  LeanDoc,
  PostMetricRepository,
  PublishedPostRepository,
} from '@yikart/mongodb'
import { z } from 'zod'
import { SyncCreatorNotesResultSchema } from '../execution-tasks/task-payloads'
import { findCollectProfile } from './collect-specs'
import { CreatorNoteMatcherService, MatchDecision, MatchInput } from './creator-note-matcher.service'
import { parsePlatformTime } from './creator-note-time'
import { DraftRef } from './draft-title-index.service'

/** 默认时区：平台表里没写的时候按这个解析卡片上的时间 */
const FALLBACK_TIME_ZONE = 'Asia/Shanghai'

type SyncResult = z.infer<typeof SyncCreatorNotesResultSchema>

export interface IngestOutcome {
  /** 真正落进表里的行数，重复回报的那些不算 */
  insertedRows: number
  /** 就地刷新掉的未归属行数：同一条帖子上次采过、这次只是更新它的数字 */
  refreshedRows: number
  /** 入库前清掉的历史重复行数 */
  removedDuplicateRows: number
  matched: number
  ambiguous: number
  unmatched: number
  /** 写出来的指标快照数 */
  snapshots: number
}

/**
 * 插件按图标指纹认出来的指标是个动态字典，这里收成固定的五个字段。
 *
 * 少了的补 0 而不是留空：指标是累计值，缺字段和「这一项是 0」在页面上看不出区别，
 * 但缺字段会让按方向汇总那一步算出 `null`。认不出来的整张卡根本不会走到这儿，
 * 它在插件那边就进了 `unrecognized`。
 */
function toMetrics(raw: Record<string, number>): CreatorNoteMetrics {
  return {
    views: raw['views'] ?? 0,
    comments: raw['comments'] ?? 0,
    likes: raw['likes'] ?? 0,
    collects: raw['collects'] ?? 0,
    shares: raw['shares'] ?? 0,
  }
}

/**
 * 用建单时那一份 schema 再校验一次回报的结果。
 *
 * 不自己手写解析：这里读错一个字段名（比如把 `collects` 读成 `collect`）的后果是
 * 那个指标静默变成 0，页面上看不出来。复用同一份 schema 之后，
 * 插件和服务端对这份结构的理解不可能分叉。
 */
function readSyncResult(result: unknown): SyncResult | null {
  const parsed = SyncCreatorNotesResultSchema.safeParse(result)
  return parsed.success ? parsed.data : null
}

/**
 * 把一个 `sync_creator_notes` 工单回报的结果落进表里。
 *
 * 顺序是**先落地、再匹配、最后写快照**（contract-collect-xhs 第三节）：
 * 匹配规则将来一定会改，改完得能拿历史数据重跑。先落地保证了原始数据在任何情况下都不丢，
 * 匹配挂了顶多是一堆「未归属」，人在网页上还能自己认领。
 */
@Injectable()
export class CreatorNoteIngestService {
  private readonly logger = new Logger(CreatorNoteIngestService.name)

  constructor(
    private readonly creatorNoteRowRepository: CreatorNoteRowRepository,
    private readonly postMetricRepository: PostMetricRepository,
    private readonly publishedPostRepository: PublishedPostRepository,
    private readonly matcherService: CreatorNoteMatcherService,
  ) {}

  async ingest(params: {
    userId: string
    userType: UserType
    executionTaskId: string
    accountId?: string
    result: unknown
  }): Promise<IngestOutcome> {
    const outcome: IngestOutcome = {
      insertedRows: 0,
      refreshedRows: 0,
      removedDuplicateRows: 0,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      snapshots: 0,
    }

    const sync = readSyncResult(params.result)
    if (!sync) {
      this.logger.warn(`工单 ${params.executionTaskId} 回报的结果不是采集结果，跳过入库`)
      return outcome
    }

    if (sync.notes.length === 0) {
      // 插件那边一条都没读到就该回报失败，走到这里说明契约被绕过了，记一笔
      this.logger.warn(`工单 ${params.executionTaskId} 采集成功但一条都没有，不入库`)
      return outcome
    }

    const timeZone = findCollectProfile(sync.platform)?.timeZone ?? FALLBACK_TIME_ZONE
    const collectedAt = Number.isNaN(sync.collectedAt.getTime()) ? new Date() : sync.collectedAt

    // 先把历史上堆出来的重复行清掉再入库。
    // 入库逻辑改成就地刷新之前，每采一轮就给每条帖子插一行，
    // 采过几轮「未归属」里每条就出现几次；新的重复不会再产生，
    // 但已经在库里的那些只能在这里收掉。清完是幂等的，之后每轮都是 0。
    // 清理失败了也要继续入库：这一步只是把列表擦干净，
    // 为它把一整轮采回来的数据丢掉，代价和收益完全不成比例
    try {
      outcome.removedDuplicateRows = await this.creatorNoteRowRepository.deleteDuplicatePendingByUserId(params.userId)
      if (outcome.removedDuplicateRows > 0)
        this.logger.log(`清掉 ${outcome.removedDuplicateRows} 行历史重复的未归属数据`)
    }
    catch (error) {
      this.logger.warn(error, '清理历史重复行失败，这一轮照常入库')
    }

    // 草稿索引一次采集只建一次：这一趟要把所有项目的 drafts/ 扫一遍，
    // 放进每行的匹配里就是几十次重复扫描
    const draftIndex = await this.matcherService.buildDraftIndex(params.userId)

    for (const note of sync.notes) {
      const publishedAt = parsePlatformTime(note.publishedAtText, timeZone)
      const metrics = toMetrics(note.metrics)
      const matchInput: MatchInput = {
        userId: params.userId,
        platform: sync.platform,
        accountId: params.accountId,
        title: note.title,
        titleTruncated: Boolean(note.titleTruncated),
        publishedAt,
      }

      const prior = await this.creatorNoteRowRepository.getLatestByIdentity({
        userId: params.userId,
        platform: sync.platform,
        title: note.title,
        publishedAtText: note.publishedAtText,
      })

      const decision = await this.decide(matchInput, draftIndex, prior)

      if (decision.matchState === CreatorNoteMatchState.MATCHED) {
        // 已归属的帖子每采一次留一行：这是它的原始数据轨迹，快照表只是派生出来的
        const row = await this.creatorNoteRowRepository.createIfAbsent({
          userId: params.userId,
          userType: params.userType,
          platform: sync.platform,
          accountId: params.accountId,
          title: note.title,
          titleTruncated: Boolean(note.titleTruncated),
          publishedAtText: note.publishedAtText,
          publishedAt,
          metrics,
          collectedAt,
          executionTaskId: params.executionTaskId,
          matchedPublishedPostId: decision.matchedPublishedPostId,
          matchState: decision.matchState,
          matchCandidates: decision.matchCandidates,
        })

        // 同一次采集重复回报：行已经在了，快照也已经写过，什么都不用做
        if (!row)
          continue

        outcome.insertedRows++
        outcome.matched++
        if (await this.writeSnapshot(params, row.id, decision.matchedPublishedPostId, metrics, collectedAt))
          outcome.snapshots++
        continue
      }

      if (decision.matchState === CreatorNoteMatchState.AMBIGUOUS)
        outcome.ambiguous++
      else
        outcome.unmatched++

      // 还归不了属的帖子只占一行，采到新数字就刷在同一行上。
      // 每次都插一行的话，一个只有 3 条帖子属于项目的号会在「未归属」里
      // 每天堆出 62×8 行，人再也找不到真正需要他认领的那几条
      if (prior) {
        const refreshed = await this.creatorNoteRowRepository.updatePendingById(prior.id, params.userId, {
          metrics,
          collectedAt,
          executionTaskId: params.executionTaskId,
          matchState: decision.matchState,
          matchCandidates: decision.matchCandidates,
          publishedAt,
        })

        if (refreshed)
          outcome.refreshedRows++

        continue
      }

      if (await this.creatorNoteRowRepository.createIfAbsent({
        userId: params.userId,
        userType: params.userType,
        platform: sync.platform,
        accountId: params.accountId,
        title: note.title,
        titleTruncated: Boolean(note.titleTruncated),
        publishedAtText: note.publishedAtText,
        publishedAt,
        metrics,
        collectedAt,
        executionTaskId: params.executionTaskId,
        matchState: decision.matchState,
        matchCandidates: decision.matchCandidates,
      })) {
        outcome.insertedRows++
      }
    }

    if (sync.unrecognized.length > 0)
      this.logger.warn(`工单 ${params.executionTaskId} 有 ${sync.unrecognized.length} 张卡片的指标认不出来，没有入库`)

    for (const warning of sync.warnings)
      this.logger.warn(`工单 ${params.executionTaskId} 采集告警：${warning}`)

    return outcome
  }

  /**
   * 这一行归到哪条帖子上。
   *
   * **上一次的归属结果优先**：人在网页上认领过的帖子，平台上的标题跟我们记录里的标题
   * 常常对不上（认领本来就是为了处理这种对不上），重新跑一遍匹配规则会把它判成未归属，
   * 于是刚认领完的帖子下一次采集又回到待认领列表里，而且它的快照从此断掉。
   * 采集是每 3 小时一次的，这种回弹人一定会碰上。
   */
  private async decide(
    input: MatchInput,
    draftIndex: Map<string, DraftRef[]>,
    prior: LeanDoc<CreatorNoteRow> | null,
  ): Promise<MatchDecision> {
    if (prior?.matchState === CreatorNoteMatchState.MATCHED && prior.matchedPublishedPostId) {
      return {
        matchState: CreatorNoteMatchState.MATCHED,
        matchedPublishedPostId: prior.matchedPublishedPostId,
        matchCandidates: [],
      }
    }

    try {
      return await this.matcherService.match(input, draftIndex)
    }
    catch (error) {
      // 一行匹配失败不该带走整批数据，落成未归属，人还能手动认领
      this.logger.warn(error, `匹配失败，这一行落成未归属: ${input.title}`)
      return { matchState: CreatorNoteMatchState.UNMATCHED, matchCandidates: [] }
    }
  }

  /** 已归属的行才有快照：快照表是按项目和方向聚合用的，未归属的行进去只会是噪音 */
  private async writeSnapshot(
    params: { userId: string, userType: UserType, executionTaskId: string },
    rowId: string,
    publishedPostId: string | undefined,
    metrics: CreatorNoteMetrics,
    collectedAt: Date,
  ): Promise<boolean> {
    if (!publishedPostId)
      return false

    const post = await this.publishedPostRepository.getByIdAndUserId(publishedPostId, params.userId)
    if (!post)
      return false

    const created = await this.postMetricRepository.createIfAbsent({
      userId: params.userId,
      userType: params.userType,
      publishedPostId: post.id,
      projectId: post.projectId,
      angleId: post.angleId,
      platform: post.platform,
      metrics,
      collectedAt,
      sourceRowId: rowId,
      executionTaskId: params.executionTaskId,
    })

    return created !== null
  }
}
