import { Injectable, Logger } from '@nestjs/common'
import { AppException, ResponseCode, UserType } from '@yikart/common'
import { Project, ProjectRepository, ProjectStatus } from '@yikart/mongodb'
import { ProjectDirService } from './project-dir.service'
import {
  assertProjectNameUsable,
  buildArchivedDirName,
  normalizeProjectName,
  randomProjectName,
} from './project-name.util'
import { CreateProjectDto, UpdateProjectDto } from './projects.dto'

/** 建议名连续撞名多少次后改成「名字 + 数字」 */
const SUGGEST_NAME_MAX_TRIES = 10
/** 加数字后最多再试多少次 */
const SUGGEST_NAME_MAX_SUFFIX = 999

const MONGO_DUPLICATE_KEY_ERROR = 11000

function isDuplicateKeyError(error: unknown): boolean {
  return (error as { code?: number } | null)?.code === MONGO_DUPLICATE_KEY_ERROR
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name)

  constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly projectDirService: ProjectDirService,
  ) {}

  /**
   * 建项目：先校验名字，再建目录，最后写库。
   * 目录建失败会自己清理；库写失败会把目录删掉，不留半成品。
   */
  async create(userId: string, dto: CreateProjectDto) {
    const name = normalizeProjectName(dto.name)
    assertProjectNameUsable(name)

    if (await this.projectRepository.existsByName(name))
      throw new AppException(ResponseCode.ProjectNameTaken)

    await this.projectDirService.createProjectDir({
      name,
      displayName: dto.displayName,
      desc: dto.desc,
      audience: dto.audience,
      goal: dto.goal,
    })

    try {
      return await this.projectRepository.create({
        userId,
        userType: UserType.User,
        name,
        displayName: dto.displayName,
        desc: dto.desc,
        audience: dto.audience,
        goal: dto.goal,
        status: ProjectStatus.ACTIVE,
        dirName: name,
      })
    }
    catch (error) {
      this.logger.error(`项目入库失败，回滚目录: ${name}`, error instanceof Error ? error.stack : String(error))
      await this.projectDirService.removeProjectDir(name)

      // 并发下唯一索引才拦到的重名
      if (isDuplicateKeyError(error))
        throw new AppException(ResponseCode.ProjectNameTaken)

      throw error
    }
  }

  async listByUserId(userId: string, status?: ProjectStatus) {
    return await this.projectRepository.listByUserId(userId, status)
  }

  async getDetail(id: string, userId: string) {
    return await this.getOwnedProject(id, userId)
  }

  /** 只改显示信息，英文名永久不可改 */
  async update(id: string, userId: string, dto: UpdateProjectDto) {
    const project = await this.getOwnedProject(id, userId)
    if (project.status === ProjectStatus.ARCHIVED)
      throw new AppException(ResponseCode.ProjectArchived)

    const update: Partial<Project> = {}
    if (dto.displayName !== undefined)
      update.displayName = dto.displayName
    if (dto.desc !== undefined)
      update.desc = dto.desc
    if (dto.audience !== undefined)
      update.audience = dto.audience
    if (dto.goal !== undefined)
      update.goal = dto.goal

    if (Object.keys(update).length === 0)
      return project

    const updated = await this.projectRepository.updateById(id, update)
    if (!updated)
      throw new AppException(ResponseCode.ProjectNotFound)

    // 磁盘上的 CLAUDE.md 要跟着改，否则 AI Agent 读到的一直是创建那一刻的旧信息。
    // 已归档的项目走不到这里（上面已经拦掉），写失败也只记日志，不回滚数据库。
    await this.projectDirService.refreshClaudeMd(updated.dirName, {
      name: updated.name,
      displayName: updated.displayName,
      desc: updated.desc,
      audience: updated.audience,
      goal: updated.goal,
    })

    return updated
  }

  /** 归档：目录改名 + 更新状态，不删文件。库写失败会把目录名改回去 */
  async archive(id: string, userId: string) {
    const project = await this.getOwnedProject(id, userId)
    if (project.status === ProjectStatus.ARCHIVED)
      throw new AppException(ResponseCode.ProjectArchived)

    const archivedDirName = buildArchivedDirName(project.name)
    const renamed = await this.projectDirService.renameProjectDir(project.dirName, archivedDirName)

    try {
      const updated = await this.projectRepository.updateById(id, {
        dirName: archivedDirName,
        status: ProjectStatus.ARCHIVED,
        archivedAt: new Date(),
      })
      if (!updated)
        throw new AppException(ResponseCode.ProjectNotFound)

      return updated
    }
    catch (error) {
      this.logger.error(`归档入库失败，目录名改回: ${project.name}`, error instanceof Error ? error.stack : String(error))
      if (renamed)
        await this.projectDirService.renameProjectDir(archivedDirName, project.dirName)

      throw error
    }
  }

  /** 生成一个当前没被占用的可读英文名 */
  async suggestName(): Promise<string> {
    for (let i = 0; i < SUGGEST_NAME_MAX_TRIES; i++) {
      const candidate = randomProjectName()
      if (!(await this.projectRepository.existsByName(candidate)))
        return candidate
    }

    const base = randomProjectName()
    for (let suffix = 2; suffix <= SUGGEST_NAME_MAX_SUFFIX; suffix++) {
      const candidate = `${base}-${suffix}`
      if (!(await this.projectRepository.existsByName(candidate)))
        return candidate
    }

    return `${base}-${Date.now() % 100000}`
  }

  /**
   * 拿一个当前用户可写的项目：不属于自己报「不存在」，已归档报「已归档」。
   * 物料文件接口全部从这里进，归属和归档只在这一处判。
   */
  async getWritableProject(id: string, userId: string) {
    const project = await this.getOwnedProject(id, userId)
    if (project.status === ProjectStatus.ARCHIVED)
      throw new AppException(ResponseCode.ProjectArchived)

    return project
  }

  private async getOwnedProject(id: string, userId: string) {
    const project = await this.projectRepository.getById(id)
    if (!project || project.userId !== userId)
      throw new AppException(ResponseCode.ProjectNotFound)

    return project
  }
}
