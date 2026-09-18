import type { LeanDoc } from '@yikart/mongodb'
import type { UpdateQuery } from 'mongoose'
import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { Angle, AngleRepository, AngleSource, AngleStatus } from '@yikart/mongodb'
import { ProjectsService } from '../projects/projects.service'
import { AngleFileService } from './angle-file.service'
import { angleRelPath, assertAngleSlugUsable, MAX_ANGLE_DEPTH, normalizeAngleSlug } from './angle-slug.util'
import { angleDepth, angleHeight, AngleTreeNode, buildAngleTree, collectDescendantIds, isAngleAncestor } from './angle-tree.util'
import { CreateAngleDto, DeriveAngleDto, UpdateAngleDto } from './angles.dto'

export type AngleDoc = LeanDoc<Angle>

const MONGO_DUPLICATE_KEY_ERROR = 11000

/** body 里传进来的方向 id：先看格式，免得拿去查库炸成 500 */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY_ERROR
}

/** 文件里写的 source 不一定是合法值（AI 写的），认不出就交给调用方兜底 */
function toAngleSource(value?: string): AngleSource | undefined {
  const list = Object.values(AngleSource) as string[]
  return value && list.includes(value) ? value as AngleSource : undefined
}

function toAngleStatus(value?: string): AngleStatus | undefined {
  const list = Object.values(AngleStatus) as string[]
  return value && list.includes(value) ? value as AngleStatus : undefined
}

/**
 * 发布方向。
 *
 * 两条要一直记着的线：
 * 1. **方向是假设不是分类**，所以血统 `parentAngleId` 是核心：`/tree` 要能组装出方向演进树，
 *    改父方向要防自环（不能把自己或自己的后代当父方向）。
 * 2. **数据库存元信息与血统，`angles/<slug>.md` 存写作指引**（contract-core.md 第五节）。
 *    两边必须一起成功：slug 改了要同步改文件名（文件改名失败回滚数据库），删方向要同时删文件。
 */
@Injectable()
export class AnglesService {
  private readonly logger = new Logger(AnglesService.name)

  constructor(
    private readonly angleRepository: AngleRepository,
    private readonly projectsService: ProjectsService,
    private readonly angleFileService: AngleFileService,
  ) {}

  /** 列出项目下的方向，可按状态过滤 */
  async list(projectId: string, userId: string, status?: AngleStatus): Promise<AngleDoc[]> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    return await this.angleRepository.listByProjectId(project.id, status)
  }

  /** 方向演进树：按血统组装，父方向缺失或成环的节点提到根上，保证一个不丢 */
  async tree(projectId: string, userId: string): Promise<AngleTreeNode<AngleDoc>[]> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const angles = await this.angleRepository.listByProjectId(project.id)
    return buildAngleTree(angles)
  }

  /** 手建一个方向：先入库（唯一索引占住 slug），再写文件；文件写失败把库里的删掉 */
  async create(projectId: string, userId: string, dto: CreateAngleDto): Promise<AngleDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const slug = this.prepareSlug(dto.slug)
    await this.assertSlugFree(project.id, slug)

    const angle = await this.insert({
      userId,
      userType: UserType.User,
      projectId: project.id,
      slug,
      name: dto.name,
      desc: dto.desc,
      source: AngleSource.USER,
      status: dto.status ?? AngleStatus.CANDIDATE,
    })

    await this.writeGuideOrRollback(project.dirName, angle, dto.guide ?? '', null)
    return angle
  }

  /**
   * 从一个方向派生子方向：`source` 固定 derived，`parentAngleId` 自动填父方向。
   * 新方向是新建出来的，不可能成为父方向的祖先，所以这里只需要挡住「从已淘汰的方向继续深入」和层数过深。
   */
  async derive(projectId: string, parentAngleId: string, userId: string, dto: DeriveAngleDto): Promise<AngleDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const parent = await this.getAngleInProject(project.id, userId, parentAngleId)

    if (parent.status === AngleStatus.RETIRED)
      throw new AppException(ResponseCode.AngleRetired)

    const slug = this.prepareSlug(dto.slug)
    await this.assertSlugFree(project.id, slug)

    const angles = await this.angleRepository.listByProjectId(project.id)
    if (angleDepth(angles, parent.id) + 1 > MAX_ANGLE_DEPTH)
      throw new AppException(ResponseCode.AngleDepthExceeded)

    // 不传正文就拿父方向的当起点：派生的意思是沿这条线往下挖，不是从零开始
    const body = dto.guide ?? await this.angleFileService.readBody(project.dirName, parent.slug) ?? ''

    const angle = await this.insert({
      userId,
      userType: UserType.User,
      projectId: project.id,
      slug,
      name: dto.name,
      desc: dto.desc,
      source: AngleSource.DERIVED,
      parentAngleId: parent.id,
      status: AngleStatus.CANDIDATE,
    })

    await this.writeGuideOrRollback(project.dirName, angle, body, parent.slug)
    return angle
  }

  /**
   * 改方向。slug 改了要同步改文件名——**文件改名失败必须把数据库改回去**，
   * 否则库里指向的文件名磁盘上根本不存在。
   */
  async update(projectId: string, angleId: string, userId: string, dto: UpdateAngleDto): Promise<AngleDoc> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const angle = await this.getAngleInProject(project.id, userId, angleId)

    const set: Partial<Angle> = {}
    const unset: Partial<Record<'parentAngleId', ''>> = {}

    let nextSlug = angle.slug
    if (dto.slug !== undefined) {
      const slug = this.prepareSlug(dto.slug)
      if (slug !== angle.slug) {
        await this.assertSlugFree(project.id, slug)
        set.slug = slug
        nextSlug = slug
      }
    }

    if (dto.name !== undefined)
      set.name = dto.name
    if (dto.desc !== undefined)
      set.desc = dto.desc
    if (dto.status !== undefined)
      set.status = dto.status

    if (dto.parentAngleId !== undefined) {
      const nextParentId = await this.resolveNextParent(project.id, userId, angle, dto.parentAngleId)
      if (nextParentId)
        set.parentAngleId = nextParentId
      else
        unset.parentAngleId = ''
    }

    const slugChanged = nextSlug !== angle.slug
    let current = angle

    if (Object.keys(set).length > 0 || Object.keys(unset).length > 0)
      current = await this.applyUpdate(angle.id, this.buildUpdateQuery(set, unset))

    if (slugChanged) {
      try {
        await this.angleFileService.rename(project.dirName, angle.slug, nextSlug)
      }
      catch (error) {
        // 文件没改成，数据库整单退回原样：库和文件必须指着同一个东西
        await this.rollbackUpdate(angle, set, unset)
        throw error
      }
    }

    await this.refreshGuide(project.dirName, current, dto.guide)
    return current
  }

  /** 删方向：名下还有子方向不让删；文件先删，删不掉整单失败，不留「库里没了文件还在」 */
  async remove(projectId: string, angleId: string, userId: string): Promise<{ id: string, slug: string, filePath: string }> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const angle = await this.getAngleInProject(project.id, userId, angleId)

    const children = await this.angleRepository.countChildren(angle.id)
    if (children > 0)
      throw new AppException(ResponseCode.AngleHasChildren)

    await this.angleFileService.remove(project.dirName, angle.slug)
    await this.angleRepository.deleteById(angle.id)

    return { id: angle.id, slug: angle.slug, filePath: angleRelPath(angle.slug) }
  }

  /**
   * 把 `angles/` 下 AI 写出来的方向文件登记进数据库。
   *
   * 契约里没写这个接口，但少了它 AI 提炼出来的方向永远进不了库
   * （AI 技能只会写文件，`sourceAssetPaths` 契约里明说「供服务端回填」）。
   * 只认库里还没有的 slug，已经登记过的一个字段都不动——文件说了算的是正文，库说了算的是元信息。
   */
  async syncFromFiles(projectId: string, userId: string): Promise<AngleDoc[]> {
    const project = await this.projectsService.getWritableProject(projectId, userId)
    const slugs = await this.angleFileService.listSlugs(project.dirName)
    const existing = await this.angleRepository.listByProjectId(project.id)
    const bySlug = new Map(existing.map(angle => [angle.slug, angle]))
    const pendingParents: { id: string, parentSlug: string }[] = []

    for (const slug of slugs) {
      if (bySlug.has(slug))
        continue

      let file
      try {
        file = await this.angleFileService.read(project.dirName, slug)
      }
      catch (error) {
        this.logger.warn(`方向文件读不了，跳过登记: ${project.dirName}/${angleRelPath(slug)} ${error instanceof AppException ? error.code : String(error)}`)
        continue
      }

      let created: AngleDoc
      try {
        created = await this.insert({
          userId,
          userType: UserType.User,
          projectId: project.id,
          slug,
          name: file.meta.name ?? slug,
          desc: file.meta.desc,
          source: toAngleSource(file.meta.source) ?? AngleSource.AI,
          status: toAngleStatus(file.meta.status) ?? AngleStatus.CANDIDATE,
          sourceAssetPaths: file.meta.sourceAssetPaths,
          promptSnapshot: file.meta.promptSnapshot,
        })
      }
      catch (error) {
        this.logger.warn(`方向登记失败，跳过: ${project.dirName}/${angleRelPath(slug)} ${error instanceof AppException ? error.code : String(error)}`)
        continue
      }

      bySlug.set(slug, created)
      if (file.meta.parentSlug)
        pendingParents.push({ id: created.id, parentSlug: file.meta.parentSlug })
    }

    if (pendingParents.length > 0)
      await this.linkParents(project.id, bySlug, pendingParents)

    return await this.angleRepository.listByProjectId(project.id)
  }

  /** 文件里的血统写的是父方向 slug，等所有方向都登记完再连，父子在文件里的先后顺序就不重要了 */
  private async linkParents(
    projectId: string,
    bySlug: Map<string, AngleDoc>,
    pendingParents: { id: string, parentSlug: string }[],
  ): Promise<void> {
    const all = await this.angleRepository.listByProjectId(projectId)
    const working = all.map(angle => ({ id: angle.id, parentAngleId: angle.parentAngleId ?? null }))

    for (const { id, parentSlug } of pendingParents) {
      const parent = bySlug.get(parentSlug)
      if (!parent || parent.id === id)
        continue

      // 文件里写出来的血统同样可能成环或过深，照样挡住
      if (isAngleAncestor(working, id, parent.id))
        continue
      if (angleDepth(working, parent.id) + angleHeight(working, id) > MAX_ANGLE_DEPTH)
        continue

      await this.angleRepository.updateById(id, { $set: { parentAngleId: parent.id } })

      const node = working.find(item => item.id === id)
      if (node)
        node.parentAngleId = parent.id
    }
  }

  /** 拿一个属于当前用户、属于这个项目的方向 */
  private async getAngleInProject(projectId: string, userId: string, angleId: string): Promise<AngleDoc> {
    const angle = await this.angleRepository.getById(angleId)
    // 别人的方向一律报「不存在」，不泄漏它是否存在
    if (!angle || angle.userId !== userId)
      throw new AppException(ResponseCode.AngleNotFound)

    if (angle.projectId !== projectId)
      throw new AppException(ResponseCode.AngleProjectMismatch)

    return angle
  }

  private prepareSlug(input: string): string {
    const slug = normalizeAngleSlug(input)
    assertAngleSlugUsable(slug)
    return slug
  }

  private async assertSlugFree(projectId: string, slug: string): Promise<void> {
    if (await this.angleRepository.existsBySlug(projectId, slug))
      throw new AppException(ResponseCode.AngleSlugTaken)
  }

  private async insert(data: Partial<Angle>): Promise<AngleDoc> {
    try {
      return await this.angleRepository.create(data)
    }
    catch (error) {
      // 并发下唯一索引才拦到的重名
      if (isDuplicateKeyError(error))
        throw new AppException(ResponseCode.AngleSlugTaken)

      throw error
    }
  }

  /** 改父方向：自己不能当自己的父方向，自己的后代也不行，层数还不能超 */
  private async resolveNextParent(
    projectId: string,
    userId: string,
    angle: AngleDoc,
    parentAngleId: string | null,
  ): Promise<string | null> {
    if (!parentAngleId)
      return null

    if (parentAngleId === angle.id)
      throw new AppException(ResponseCode.AngleParentSelf)

    if (!OBJECT_ID_PATTERN.test(parentAngleId))
      throw new AppException(ResponseCode.AngleParentNotFound)

    const parent = await this.angleRepository.getById(parentAngleId)
    if (!parent || parent.userId !== userId)
      throw new AppException(ResponseCode.AngleParentNotFound)

    if (parent.projectId !== projectId)
      throw new AppException(ResponseCode.AngleParentProjectMismatch)

    const angles = await this.angleRepository.listByProjectId(projectId)
    if (collectDescendantIds(angles, angle.id).has(parent.id))
      throw new AppException(ResponseCode.AngleParentCycle)

    if (angleDepth(angles, parent.id) + angleHeight(angles, angle.id) > MAX_ANGLE_DEPTH)
      throw new AppException(ResponseCode.AngleDepthExceeded)

    return parent.id
  }

  /** 落库并兜住并发撞唯一索引的情况（查重和更新之间隔着一个窗口） */
  private async applyUpdate(id: string, query: UpdateQuery<Angle>): Promise<AngleDoc> {
    let updated: AngleDoc | null
    try {
      updated = await this.angleRepository.updateById(id, query)
    }
    catch (error) {
      if (isDuplicateKeyError(error))
        throw new AppException(ResponseCode.AngleSlugTaken)

      throw error
    }

    if (!updated)
      throw new AppException(ResponseCode.AngleNotFound)

    return updated
  }

  private buildUpdateQuery(set: Partial<Angle>, unset: Partial<Record<string, ''>>): UpdateQuery<Angle> {
    const query: UpdateQuery<Angle> = {}
    if (Object.keys(set).length > 0)
      query.$set = set as UpdateQuery<Angle>['$set']
    if (Object.keys(unset).length > 0)
      query.$unset = unset as UpdateQuery<Angle>['$unset']

    return query
  }

  /** 把这次动过的字段整单退回原值。退不回去只能记日志，但必须记得足够大声 */
  private async rollbackUpdate(
    angle: AngleDoc,
    set: Partial<Angle>,
    unset: Partial<Record<string, ''>>,
  ): Promise<void> {
    const previous = angle as unknown as Record<string, unknown>
    const restoreSet: Partial<Angle> = {}
    const restoreUnset: Partial<Record<string, ''>> = {}

    for (const key of [...Object.keys(set), ...Object.keys(unset)]) {
      const value = previous[key]
      if (value === undefined || value === null)
        restoreUnset[key] = ''
      else
        (restoreSet as Record<string, unknown>)[key] = value
    }

    try {
      await this.angleRepository.updateById(angle.id, this.buildUpdateQuery(restoreSet, restoreUnset))
    }
    catch (error) {
      this.logger.error(
        `方向改名失败后回滚数据库也失败了，库和文件可能对不上: ${angle.id}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  /** 新建的方向写不出文件就把库里的记录删掉，不留「库里有方向，磁盘上没指引」 */
  private async writeGuideOrRollback(
    dirName: string,
    angle: AngleDoc,
    body: string,
    parentSlug: string | null,
  ): Promise<void> {
    try {
      await this.angleFileService.write(dirName, this.metaOf(angle, parentSlug), body)
    }
    catch (error) {
      try {
        await this.angleRepository.deleteById(angle.id)
      }
      catch (rollbackError) {
        this.logger.error(
          `方向写文件失败后回滚数据库也失败了: ${angle.id}`,
          rollbackError instanceof Error ? rollbackError.stack : String(rollbackError),
        )
      }

      throw error
    }
  }

  /**
   * 元信息变了就把文件的 frontmatter 重写一遍。
   * 用户明确传了正文却写失败必须报错（不能让他以为保存上了）；
   * 只是顺带刷 frontmatter 的话，记日志就够，不要把整个更新接口拖失败。
   */
  private async refreshGuide(dirName: string, angle: AngleDoc, guide?: string): Promise<void> {
    const parentSlug = await this.parentSlugOf(angle)
    const body = guide ?? await this.angleFileService.readBody(dirName, angle.slug) ?? ''

    try {
      await this.angleFileService.write(dirName, this.metaOf(angle, parentSlug), body)
    }
    catch (error) {
      if (guide !== undefined)
        throw error

      this.logger.error(
        `方向 frontmatter 刷新失败（数据库已更新）: ${dirName}/${angleRelPath(angle.slug)}`,
        error instanceof Error ? error.stack : String(error),
      )
    }
  }

  private async parentSlugOf(angle: AngleDoc): Promise<string | null> {
    if (!angle.parentAngleId)
      return null

    const parent = await this.angleRepository.getById(angle.parentAngleId)
    return parent?.slug ?? null
  }

  private metaOf(angle: AngleDoc, parentSlug: string | null) {
    return {
      slug: angle.slug,
      name: angle.name,
      desc: angle.desc,
      source: angle.source,
      parentSlug,
      status: angle.status,
      sourceAssetPaths: angle.sourceAssetPaths,
    }
  }
}
