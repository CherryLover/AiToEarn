import { createZodDto } from '@yikart/common'
import { ProjectStatus } from '@yikart/mongodb'
import { z } from 'zod'
import { MAX_TREE_DEPTH } from './project-path.util'

const CreateProjectDtoSchema = z.object({
  name: z.string().describe('项目英文名，同时是目录名，创建后不可修改'),
  displayName: z.string().min(1).max(60).describe('显示名，可中文，可随时修改'),
  desc: z.string().max(500).optional().describe('一句话说明'),
  audience: z.string().max(200).optional().describe('面向谁'),
  goal: z.string().max(200).optional().describe('想达成什么'),
})
export class CreateProjectDto extends createZodDto(CreateProjectDtoSchema, 'CreateProjectDto') {}

/** 不接受 name：英文名创建后永久不可修改，带了也会被忽略 */
const UpdateProjectDtoSchema = z.object({
  displayName: z.string().min(1).max(60).optional().describe('显示名'),
  desc: z.string().max(500).optional().describe('一句话说明'),
  audience: z.string().max(200).optional().describe('面向谁'),
  goal: z.string().max(200).optional().describe('想达成什么'),
})
export class UpdateProjectDto extends createZodDto(UpdateProjectDtoSchema, 'UpdateProjectDto') {}

const ProjectListQueryDtoSchema = z.object({
  status: z.enum(ProjectStatus).optional().describe('按状态过滤，不传则全部返回'),
})
export class ProjectListQueryDto extends createZodDto(ProjectListQueryDtoSchema, 'ProjectListQueryDto') {}

// ========== 物料文件接口 ==========

const FileTreeQueryDtoSchema = z.object({
  path: z.string().optional().describe('相对项目根的目录路径，不传表示项目根'),
  depth: z.coerce.number().int().min(1).max(MAX_TREE_DEPTH).default(3).describe('展开层数，最多 10 层'),
})
export class FileTreeQueryDto extends createZodDto(FileTreeQueryDtoSchema, 'FileTreeQueryDto') {}

const FilePathQueryDtoSchema = z.object({
  path: z.string().describe('相对项目根的文件路径'),
})
export class FilePathQueryDto extends createZodDto(FilePathQueryDtoSchema, 'FilePathQueryDto') {}

const FileWriteDtoSchema = z.object({
  path: z.string().describe('相对项目根的文件路径'),
  content: z.string().describe('文件正文，纯文本，上限 1 MB'),
})
export class FileWriteDto extends createZodDto(FileWriteDtoSchema, 'FileWriteDto') {}

const FileMkdirDtoSchema = z.object({
  path: z.string().describe('相对项目根的目录路径，父目录必须已存在'),
})
export class FileMkdirDto extends createZodDto(FileMkdirDtoSchema, 'FileMkdirDto') {}

const FileRenameDtoSchema = z.object({
  from: z.string().describe('原路径，相对项目根'),
  to: z.string().describe('新路径，相对项目根；目标已存在会被拒绝'),
})
export class FileRenameDto extends createZodDto(FileRenameDtoSchema, 'FileRenameDto') {}

const FileDeleteDtoSchema = z.object({
  path: z.string().describe('要删除的路径，相对项目根；目录会连同内容一起删除'),
})
export class FileDeleteDto extends createZodDto(FileDeleteDtoSchema, 'FileDeleteDto') {}

const FileUploadDtoSchema = z.object({
  path: z.string().optional().describe('目标目录，相对项目根，不传表示项目根'),
})
export class FileUploadDto extends createZodDto(FileUploadDtoSchema, 'FileUploadDto') {}
