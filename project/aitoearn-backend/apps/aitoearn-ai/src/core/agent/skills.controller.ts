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
import { SkillsService } from './skills.service'
import { MAX_SKILL_FILE_BYTES } from './skills.util'
import { SkillUploadDto, SkillUploadDtoSchema } from './skills.dto'
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
    description: '内置的和用户传的一起返回，各自标明来源。内置的只能看，自定义的能删。',
    response: SkillListVo,
  })
  @Get('/')
  listSkills(): SkillListVo {
    return SkillListVo.create({ list: this.skillsService.listSkills() })
  }

  @ApiDoc({
    summary: '上传一个自定义技能',
    description: '只收单个 Markdown 文件，按 frontmatter 里的 name 落盘。上传的技能对这个部署里所有人生效。',
    body: SkillUploadDtoSchema,
  })
  @ApiConsumes('multipart/form-data')
  @Post('/')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_SKILL_FILE_BYTES } }))
  uploadSkill(
    @Body() dto: SkillUploadDto,
    @UploadedFile() file?: UploadedSkillFile,
  ): SkillVo {
    if (!file?.buffer)
      throw new AppException(ResponseCode.SkillFileInvalid)

    return SkillVo.create(
      this.skillsService.saveSkill(file.buffer, file.originalname ?? '', dto.overwrite ?? false),
    )
  }

  @ApiDoc({
    summary: '删除一个自定义技能',
    description: '内置技能删不掉，服务端拒绝。',
  })
  @Delete('/:name')
  deleteSkill(@Param('name') name: string): void {
    this.skillsService.deleteSkill(name)
  }
}
