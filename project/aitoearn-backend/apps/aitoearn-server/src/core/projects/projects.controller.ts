import type { Response } from 'express'
import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { GetToken, TokenInfo } from '@yikart/aitoearn-auth'
import { ApiDoc, AppException, ParseObjectIdPipe, ResponseCode } from '@yikart/common'
import { Project } from '@yikart/mongodb'
import { ProjectFilesService, UploadedFileInput } from './project-files.service'
import { MAX_UPLOAD_BYTES } from './project-path.util'
import {
  CreateProjectDto,
  FileDeleteDto,
  FileMkdirDto,
  FilePathQueryDto,
  FileRenameDto,
  FileTreeQueryDto,
  FileUploadDto,
  FileWriteDto,
  ProjectListQueryDto,
  UpdateProjectDto,
} from './projects.dto'
import { ProjectsService } from './projects.service'
import { FileContentVo, FileDeletedVo, FileNodeVo, ProjectDetailVo, ProjectListItemVo, SuggestNameVo } from './projects.vo'

type ProjectDoc = Pick<
  Project,
  'id' | 'name' | 'displayName' | 'desc' | 'audience' | 'goal' | 'status' | 'dirName' | 'archivedAt' | 'createdAt' | 'updatedAt'
>

function toDetailVo(project: ProjectDoc): ProjectDetailVo {
  return ProjectDetailVo.create({
    id: project.id,
    name: project.name,
    displayName: project.displayName,
    desc: project.desc ?? null,
    audience: project.audience ?? null,
    goal: project.goal ?? null,
    status: project.status,
    dirName: project.dirName,
    archivedAt: project.archivedAt ?? null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  })
}

@ApiTags('Projects')
@Controller('/projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly projectFilesService: ProjectFilesService,
  ) {}

  @ApiDoc({
    summary: '创建项目',
    description: '英文名同时是服务器上的目录名，创建后不可修改；创建成功时物料目录已经建好',
    body: CreateProjectDto.schema,
    response: ProjectDetailVo,
  })
  @Post('/create')
  async create(
    @GetToken() token: TokenInfo,
    @Body() dto: CreateProjectDto,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.create(token.id, dto)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '获取项目列表',
    query: ProjectListQueryDto.schema,
    response: [ProjectListItemVo],
  })
  @Get('/list')
  async list(
    @GetToken() token: TokenInfo,
    @Query() query: ProjectListQueryDto,
  ): Promise<ProjectListItemVo[]> {
    const projects = await this.projectsService.listByUserId(token.id, query.status)
    return projects.map(project => ProjectListItemVo.create({
      id: project.id,
      name: project.name,
      displayName: project.displayName,
      desc: project.desc ?? null,
      status: project.status,
      createdAt: project.createdAt,
    }))
  }

  @ApiDoc({
    summary: '获取一个可用的建议英文名',
    description: '返回「形容词-名词」形式的可读名字，已经查过重',
    response: SuggestNameVo,
  })
  @Get('/suggest-name')
  async suggestName(
    @GetToken() _token: TokenInfo,
  ): Promise<SuggestNameVo> {
    const name = await this.projectsService.suggestName()
    return SuggestNameVo.create({ name })
  }

  @ApiDoc({
    summary: '获取项目详情',
    response: ProjectDetailVo,
  })
  @Get('/:id')
  async detail(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.getDetail(id, token.id)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '更新项目',
    description: '只能改显示名、说明、面向谁、想达成什么；带上 name 会被忽略',
    body: UpdateProjectDto.schema,
    response: ProjectDetailVo,
  })
  @Post('/:id/update')
  async update(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.update(id, token.id, dto)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '归档项目',
    description: '目录改名为 _archived_<英文名>_<时间戳>，文件不删',
    response: ProjectDetailVo,
  })
  @Post('/:id/archive')
  async archive(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
  ): Promise<ProjectDetailVo> {
    const project = await this.projectsService.archive(id, token.id)
    return toDetailVo(project)
  }

  @ApiDoc({
    summary: '物料目录树',
    description: '路径一律相对项目根，不接受绝对路径和 ..；软链不会出现在结果里',
    query: FileTreeQueryDto.schema,
    response: FileNodeVo,
  })
  @Get('/:id/files/tree')
  async fileTree(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: FileTreeQueryDto,
  ): Promise<FileNodeVo> {
    const node = await this.projectFilesService.tree(id, token.id, query.path, query.depth)
    return FileNodeVo.create(node)
  }

  @ApiDoc({
    summary: '读取文本物料',
    description: '只处理文本，单文件上限 1 MB；二进制或超限一律拒绝，请改用下载接口',
    query: FilePathQueryDto.schema,
    response: FileContentVo,
  })
  @Get('/:id/files/read')
  async fileRead(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: FilePathQueryDto,
  ): Promise<FileContentVo> {
    const file = await this.projectFilesService.read(id, token.id, query.path)
    return FileContentVo.create(file)
  }

  @ApiDoc({
    summary: '写入文本物料',
    description: '目标不存在会新建，已存在会整篇覆盖；上限 1 MB',
    body: FileWriteDto.schema,
    response: FileContentVo,
  })
  @Post('/:id/files/write')
  async fileWrite(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FileWriteDto,
  ): Promise<FileContentVo> {
    const file = await this.projectFilesService.write(id, token.id, dto.path, dto.content)
    return FileContentVo.create(file)
  }

  @ApiDoc({
    summary: '新建物料文件夹',
    description: '父目录必须已存在，同名已存在直接报错',
    body: FileMkdirDto.schema,
    response: FileNodeVo,
  })
  @Post('/:id/files/mkdir')
  async fileMkdir(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FileMkdirDto,
  ): Promise<FileNodeVo> {
    const node = await this.projectFilesService.mkdir(id, token.id, dto.path)
    return FileNodeVo.create(node)
  }

  @ApiDoc({
    summary: '改名或移动物料',
    description: '目标已存在会被拒绝，不做覆盖',
    body: FileRenameDto.schema,
    response: FileNodeVo,
  })
  @Post('/:id/files/rename')
  async fileRename(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FileRenameDto,
  ): Promise<FileNodeVo> {
    const node = await this.projectFilesService.rename(id, token.id, dto.from, dto.to)
    return FileNodeVo.create(node)
  }

  @ApiDoc({
    summary: '删除物料',
    description: '目录会连同内容一起删除；软链只摘掉链接本身，不会跟进去删外面的东西',
    body: FileDeleteDto.schema,
    response: FileDeletedVo,
  })
  @Post('/:id/files/delete')
  async fileDelete(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FileDeleteDto,
  ): Promise<FileDeletedVo> {
    const deleted = await this.projectFilesService.remove(id, token.id, dto.path)
    return FileDeletedVo.create(deleted)
  }

  @ApiDoc({
    summary: '上传物料原件',
    description: '单文件上限 100 MB，不解压压缩包；图片会额外传一份到 OSS 并在旁边生成名片文件',
    response: FileNodeVo,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary', description: '文件本体' },
        path: { type: 'string', description: '目标目录，相对项目根，不传表示项目根' },
      },
      required: ['file'],
    },
  })
  @Post('/:id/files/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async fileUpload(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: FileUploadDto,
    @UploadedFile() file?: UploadedFileInput,
  ): Promise<FileNodeVo> {
    if (!file?.buffer)
      throw new AppException(ResponseCode.ProjectFileUploadFailed)

    const node = await this.projectFilesService.upload(id, token.id, dto.path, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    })

    return FileNodeVo.create(node)
  }

  @ApiDoc({
    summary: '下载物料原件',
    description: '二进制物料走这里；返回文件流，不走统一响应包装',
    query: FilePathQueryDto.schema,
  })
  @Get('/:id/files/download')
  async fileDownload(
    @GetToken() token: TokenInfo,
    @Param('id', ParseObjectIdPipe) id: string,
    @Query() query: FilePathQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, size, fileName, contentType } = await this.projectFilesService.download(id, token.id, query.path)

    res.setHeader('Content-Type', contentType)
    res.setHeader('Content-Length', size)
    // 文件名可能是中文，同时给 ASCII 兜底和 RFC 5987 编码
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/[^\x20-\x7E]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    )

    return new StreamableFile(stream)
  }
}
