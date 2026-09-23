/**
 * 自定义技能的接口
 *
 * 挂在 aitoearn-ai 上：nginx 已经把 `/api/ai/` 路由到这个服务，而技能文件也挂在这个容器里，
 * 放 server 那边等于让两个容器抢同一份文件。
 */

import { Body, Controller, Delete, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiConsumes, ApiTags } from '@nestjs/swagger'
import { ApiDoc, AppException, ResponseCode } from '@yikart/common'
import { MAX_SKILL_ARCHIVE_BYTES } from './skills-archive.util'
import { detectSkillUploadKind } from './skills-store.util'
import { SkillUploadErrorInterceptor } from './skills-upload.interceptor'
import { SkillUploadDto, SkillUploadDtoSchema } from './skills.dto'
import { SkillsService } from './skills.service'
import { SkillListVo, SkillVo } from './skills.vo'

interface UploadedSkillFile {
  originalname: string
  size: number
  buffer: Buffer
}

@ApiTags('AI/Skills')
@Controller('/ai/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  @ApiDoc({
    summary: '列出全部 AI 技能',
    description: '内置的和用户传的一起返回，各自标明来源，并列出每个技能包里的文件。内置的只能看，自定义的能删。',
    response: SkillListVo,
  })
  @Get('/')
  listSkills(): SkillListVo {
    return SkillListVo.create({ list: this.skillsService.listSkills() })
  }

  @ApiDoc({
    summary: '上传一个自定义技能',
    description: '字段 file 收标准技能包 .zip（SKILL.md + references / scripts / assets 等，≤ 10 MiB）或单个 .md（≤ 64 KiB），'
      + '按 SKILL.md frontmatter 里的 name 落盘。上传的技能对这个部署里所有人生效。',
    body: SkillUploadDtoSchema,
    response: SkillVo,
  })
  @ApiConsumes('multipart/form-data')
  @Post('/')
  @UseInterceptors(
    SkillUploadErrorInterceptor,
    // 上限按两种格式里大的那个（zip 10 MiB）给；.md 的 64 KiB 在服务层按扩展名再卡。扩展名不对的直接不收。
    // +1：busboy 读到「正好等于」fileSize 就判超限，不加的话刚好 10 MiB 的包会被误拒
    FileInterceptor('file', {
      limits: { fileSize: MAX_SKILL_ARCHIVE_BYTES + 1 },
      fileFilter: (_req, file, callback) => callback(null, detectSkillUploadKind(file.originalname) !== null),
    }),
  )
  async uploadSkill(
    @Body() dto: SkillUploadDto,
    @UploadedFile() file?: UploadedSkillFile,
  ): Promise<SkillVo> {
    if (!file?.buffer)
      throw new AppException(ResponseCode.SkillFileInvalid)

    const skill = await this.skillsService.saveSkill(file.buffer, file.originalname ?? '', dto.overwrite ?? false)
    return SkillVo.create(skill)
  }

  @ApiDoc({
    summary: '删除一个自定义技能',
    description: '内置技能删不掉，服务端拒绝。',
  })
  @Delete('/:name')
  async deleteSkill(@Param('name') name: string): Promise<void> {
    await this.skillsService.deleteSkill(name)
  }
}
