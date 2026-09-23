import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppException, ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectWorkspaceService } from './project-workspace.service'

const { projectsConfig } = vi.hoisted(() => ({
  projectsConfig: { root: '' },
}))

vi.mock('../../../config', () => ({
  config: {
    projects: projectsConfig,
  },
}))

function expectResponseCode(fn: () => unknown, code: ResponseCode): void {
  try {
    fn()
  }
  catch (error) {
    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe(code)
    return
  }

  throw new Error(`期望抛出 ${ResponseCode[code]}，但没有抛出`)
}

describe('projectWorkspaceService', () => {
  let tmpRoot: string
  let root: string
  let outside: string
  let service: ProjectWorkspaceService

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'aitoearn-ws-'))
    root = join(tmpRoot, 'projects')
    outside = join(tmpRoot, 'outside')
    mkdirSync(root, { recursive: true })
    mkdirSync(outside, { recursive: true })
    mkdirSync(join(root, 'demo', 'background', 'product'), { recursive: true })
    writeFileSync(join(root, 'demo', 'CLAUDE.md'), '# demo\n')
    writeFileSync(join(outside, 'secret.txt'), 'top secret')

    projectsConfig.root = root
    service = new ProjectWorkspaceService()
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  describe('项目名校验', () => {
    it('接受合法的项目英文名', () => {
      expect(service.isValidProjectName('demo')).toBe(true)
      expect(service.isValidProjectName('forty-weeks')).toBe(true)
      expect(service.isValidProjectName('a1b')).toBe(true)
    })

    it.each([
      ['ab', '太短'],
      ['Demo', '有大写'],
      ['1demo', '数字开头'],
      ['demo-', '连字符结尾'],
      ['de--mo', '连续连字符'],
      ['demo/../etc', '带路径分隔符'],
      ['demo name', '带空格'],
      ['demo\0', '带 NUL 字节'],
      ['a'.repeat(41), '超长'],
    ])('拒绝不合法的名字 %s（%s）', (name) => {
      expect(service.isValidProjectName(name)).toBe(false)
      expectResponseCode(() => service.assertProjectNameUsable(name), ResponseCode.ProjectNameInvalid)
    })

    it.each(['archived', 'tmp', 'temp', 'system', 'config', 'node_modules'])('拒绝保留字 %s', (name) => {
      expectResponseCode(() => service.assertProjectNameUsable(name), ResponseCode.ProjectNameReserved)
    })

    it.each(['_archived_demo_20260918120000', '_hidden', '.hidden'])('拒绝归档目录名和隐藏名 %s', (name) => {
      expect(service.isReservedProjectName(name)).toBe(true)
      expectResponseCode(() => service.assertProjectNameUsable(name), ResponseCode.ProjectNameReserved)
    })
  })

  describe('工作目录解析', () => {
    it('解析出项目物料目录', () => {
      expect(service.resolveProjectCwd('demo')).toBe(join(root, 'demo'))
    })

    it('目录不存在时报 ProjectNotFound，且不自己建目录', () => {
      expectResponseCode(() => service.resolveProjectCwd('missing'), ResponseCode.ProjectNotFound)
      expect(() => service.resolveProjectCwd('missing')).toThrow()
      expect(existsSync(join(root, 'missing'))).toBe(false)
    })

    it('项目目录是指向外部的软链时拒绝', () => {
      symlinkSync(outside, join(root, 'escaped'), 'dir')
      expectResponseCode(() => service.resolveProjectCwd('escaped'), ResponseCode.ProjectPathEscape)
    })

    it('项目目录是指向根内部的软链时放行', () => {
      symlinkSync(join(root, 'demo'), join(root, 'alias'), 'dir')
      expect(service.resolveProjectCwd('alias')).toBe(join(root, 'alias'))
    })

    it('根目录本身是软链时不误伤', () => {
      const rootLink = join(tmpRoot, 'projects-link')
      symlinkSync(root, rootLink, 'dir')
      projectsConfig.root = rootLink

      expect(service.resolveProjectCwd('demo')).toBe(join(rootLink, 'demo'))
    })
  })

  describe('工具入参路径校验', () => {
    let projectDir: string

    beforeEach(() => {
      projectDir = service.resolveProjectCwd('demo')
    })

    it('项目内的相对路径放行', () => {
      expect(service.checkToolInput(projectDir, 'Read', { file_path: 'background/product/intro.md' })).toBeNull()
    })

    it('项目内的绝对路径放行', () => {
      expect(service.checkToolInput(projectDir, 'Write', {
        file_path: join(projectDir, 'drafts', 'new.md'),
        content: 'hello',
      })).toBeNull()
    })

    it('项目目录本身放行', () => {
      expect(service.checkToolInput(projectDir, 'Glob', { pattern: '**/*.md', path: projectDir })).toBeNull()
    })

    it('不传 path 的 Glob 放行（默认就是 cwd）', () => {
      expect(service.checkToolInput(projectDir, 'Glob', { pattern: '**/*.md' })).toBeNull()
    })

    it('不在校验表里的工具不管', () => {
      expect(service.checkToolInput(projectDir, 'WebFetch', { url: 'https://example.com' })).toBeNull()
    })

    it.each([
      ['../outside/secret.txt', '相对路径回退'],
      ['../../etc/passwd', '多级回退'],
      ['/etc/passwd', '绝对路径注入'],
    ])('拒绝越界路径 %s（%s）', (filePath) => {
      const message = service.checkToolInput(projectDir, 'Read', { file_path: filePath })
      expect(message).not.toBeNull()
      expect(message).toContain('outside the project workspace')
    })

    it('拒绝指向外部的软链', () => {
      symlinkSync(join(outside, 'secret.txt'), join(projectDir, 'leak.txt'), 'file')
      expect(service.checkToolInput(projectDir, 'Read', { file_path: 'leak.txt' })).not.toBeNull()
    })

    it('拒绝悬空软链（写入时才会跑出去的那种）', () => {
      symlinkSync(join(outside, 'not-yet.txt'), join(projectDir, 'pending.txt'), 'file')
      expect(service.checkToolInput(projectDir, 'Write', {
        file_path: 'pending.txt',
        content: 'x',
      })).not.toBeNull()
    })

    it('拒绝中间层是软链的路径', () => {
      symlinkSync(outside, join(projectDir, 'media-link'), 'dir')
      expect(service.checkToolInput(projectDir, 'Write', {
        file_path: 'media-link/evil.md',
        content: 'x',
      })).not.toBeNull()
    })

    it('拒绝成环的软链', () => {
      symlinkSync(join(projectDir, 'loop-b'), join(projectDir, 'loop-a'), 'dir')
      symlinkSync(join(projectDir, 'loop-a'), join(projectDir, 'loop-b'), 'dir')
      expect(service.checkToolInput(projectDir, 'Read', { file_path: 'loop-a/x.md' })).not.toBeNull()
    })

    it('拒绝同前缀的兄弟目录', () => {
      mkdirSync(join(root, 'demo-evil'), { recursive: true })
      expect(service.checkToolInput(projectDir, 'Read', { file_path: '../demo-evil/x.md' })).not.toBeNull()
    })

    it('路径参数不是字符串时拒绝', () => {
      expect(service.checkToolInput(projectDir, 'Read', { file_path: 123 })).not.toBeNull()
    })

    it('拒绝原因要说清楚是越界，不是文件不存在', () => {
      const message = service.checkToolInput(projectDir, 'Read', { file_path: '/etc/passwd' })
      expect(message).toContain('NOT a "file not found"')
      expect(message).toContain(projectDir)
    })
  })

  describe('agent 自己的配置目录不许碰', () => {
    let projectDir: string

    beforeEach(() => {
      projectDir = service.resolveProjectCwd('demo')
    })

    it.each([
      ['.claude/settings.json'],
      ['.claude'],
      ['.claude/skills/evil/SKILL.md'],
      ['.CLAUDE/settings.json'],
      ['.mcp.json'],
    ])('拒绝写 %s', (filePath) => {
      const message = service.checkToolInput(projectDir, 'Write', { file_path: filePath, content: 'x' })
      expect(message).toContain('agent configuration')
    })

    it('软链指向配置目录也拒绝', () => {
      mkdirSync(join(projectDir, '.claude'), { recursive: true })
      writeFileSync(join(projectDir, '.claude', 'settings.json'), '{}')
      symlinkSync(join(projectDir, '.claude', 'settings.json'), join(projectDir, 'looks-fine.json'), 'file')

      expect(service.checkToolInput(projectDir, 'Write', {
        file_path: 'looks-fine.json',
        content: 'x',
      })).toContain('agent configuration')
    })

    it('读也一样拒绝', () => {
      expect(service.checkToolInput(projectDir, 'Read', { file_path: '.claude/settings.json' })).not.toBeNull()
    })

    it('项目说明 CLAUDE.md 允许改', () => {
      expect(service.checkToolInput(projectDir, 'Write', {
        file_path: 'CLAUDE.md',
        content: '# demo',
      })).toBeNull()
    })
  })

  describe('通配符入参校验', () => {
    let projectDir: string

    beforeEach(() => {
      projectDir = service.resolveProjectCwd('demo')
    })

    it.each([
      ['**/*.md'],
      ['background/**/*.md'],
      ['./drafts/*.md'],
    ])('项目内的通配符放行: %s', (pattern) => {
      expect(service.checkToolInput(projectDir, 'Glob', { pattern })).toBeNull()
    })

    it.each([
      ['../../**/*'],
      ['../outside/*'],
      ['/etc/*'],
      ['~/.ssh/*'],
      ['background/../../**'],
    ])('拒绝可能跑出项目的通配符: %s', (pattern) => {
      const message = service.checkToolInput(projectDir, 'Glob', { pattern })
      expect(message).not.toBeNull()
      expect(message).toContain('glob')
    })

    it('grep 的 glob 走同一套', () => {
      expect(service.checkToolInput(projectDir, 'Grep', { pattern: 'TODO', glob: '**/*.md' })).toBeNull()
      expect(service.checkToolInput(projectDir, 'Grep', { pattern: 'TODO', glob: '../**' })).not.toBeNull()
    })

    it('grep 的 pattern 是正则不是路径，不参与校验', () => {
      expect(service.checkToolInput(projectDir, 'Grep', { pattern: '\\.\\./etc' })).toBeNull()
    })
  })

  /**
   * 技能包里的 references 要让 Agent 读得到，但只读、只限会话技能目录这一个地方。
   * 会话技能目录 = `<cwd>/.claude-session/.claude/skills`，这里把 cwd 换到临时目录。
   */
  describe('会话技能目录的只读口子', () => {
    let cwd: string
    let projectDir: string
    let sessionDir: string
    let skillsDir: string
    let skillFile: string
    let skillService: ProjectWorkspaceService

    beforeEach(() => {
      cwd = process.cwd()
      const appDir = join(tmpRoot, 'app')
      sessionDir = join(appDir, '.claude-session')
      skillsDir = join(sessionDir, '.claude', 'skills')
      skillFile = join(skillsDir, 'my-skill', 'references', 'api.md')
      mkdirSync(join(skillsDir, 'my-skill', 'references'), { recursive: true })
      writeFileSync(join(skillsDir, 'my-skill', 'SKILL.md'), '---\nname: my-skill\n---\n')
      writeFileSync(skillFile, '# api')
      writeFileSync(join(sessionDir, '.claude', 'settings.json'), '{"hooks":{}}')

      process.chdir(appDir)
      skillService = new ProjectWorkspaceService()
      projectDir = skillService.resolveProjectCwd('demo')
    })

    afterEach(() => {
      process.chdir(cwd)
    })

    it('读技能目录里的文件（Read）放行', () => {
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: skillFile })).toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'my-skill', 'SKILL.md') })).toBeNull()
    })

    it('还不存在的路径按词法判断，落在技能目录里就放行（读不到是工具自己的事）', () => {
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'my-skill', 'nope.md') })).toBeNull()
    })

    it('从项目目录出发的相对路径，只要落点在技能目录里也放行', () => {
      const relative = join('..', '..', 'app', '.claude-session', '.claude', 'skills', 'my-skill', 'SKILL.md')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: relative })).toBeNull()
    })

    it('以技能目录（或其中某个技能）为 path 的 Glob / Grep 放行', () => {
      expect(skillService.checkToolInput(projectDir, 'Glob', { pattern: '**/*.md', path: skillsDir })).toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Glob', { pattern: '**/*', path: join(skillsDir, 'my-skill') })).toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Grep', { pattern: 'api', path: skillsDir })).toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Grep', { pattern: 'api', path: skillFile, glob: '*.md' })).toBeNull()
    })

    it('通配符规则不变：path 是技能目录，Glob 的 pattern 也不许往外跑', () => {
      const message = skillService.checkToolInput(projectDir, 'Glob', { pattern: '../**', path: skillsDir })
      expect(message).toContain('glob')
    })

    it.each([
      ['Write', 'file_path', { content: 'x' }],
      ['Edit', 'file_path', { old_string: 'a', new_string: 'b' }],
      ['NotebookEdit', 'notebook_path', { new_source: 'x' }],
    ])('%s 技能目录里的文件照旧拒绝', (tool, argName, rest) => {
      const existing = skillService.checkToolInput(projectDir, tool, { [argName]: join(skillsDir, 'my-skill', 'SKILL.md'), ...rest })
      const fresh = skillService.checkToolInput(projectDir, tool, { [argName]: join(skillsDir, 'evil', 'SKILL.md'), ...rest })
      expect(existing).toContain('outside the project workspace')
      expect(fresh).toContain('outside the project workspace')
    })

    it.each([
      ['<技能目录>/../settings.json', () => join(skillsDir, '..', 'settings.json')],
      ['<技能目录>/my-skill/../../settings.json', () => join(skillsDir, 'my-skill', '..', '..', 'settings.json')],
      ['会话目录下的 settings.json', () => join(sessionDir, '.claude', 'settings.json')],
      ['会话目录本身', () => sessionDir],
    ])('技能目录外的会话配置照旧拒绝: %s', (_label, candidate) => {
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: candidate() })).not.toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Glob', { pattern: '*', path: candidate() })).not.toBeNull()
    })

    it('技能目录里一个指向外面的软链，Read 拒绝', () => {
      symlinkSync(join(outside, 'secret.txt'), join(skillsDir, 'my-skill', 'leak.txt'), 'file')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'my-skill', 'leak.txt') })).not.toBeNull()
    })

    it('技能目录里一个指向会话 settings 的软链，Read 拒绝', () => {
      symlinkSync(join(sessionDir, '.claude', 'settings.json'), join(skillsDir, 'my-skill', 'settings.json'), 'file')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'my-skill', 'settings.json') })).not.toBeNull()
    })

    it('技能目录里一个指向外面的目录软链，经它读、以它为 path 列都拒绝', () => {
      symlinkSync(outside, join(skillsDir, 'evil-dir'), 'dir')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'evil-dir', 'secret.txt') })).not.toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Glob', { pattern: '*', path: join(skillsDir, 'evil-dir') })).not.toBeNull()
    })

    it('项目里一个指向技能目录的软链：读到的还是技能目录，放行；经它写照旧拒', () => {
      symlinkSync(skillsDir, join(projectDir, 'skills-link'), 'dir')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: 'skills-link/my-skill/SKILL.md' })).toBeNull()
      expect(skillService.checkToolInput(projectDir, 'Write', {
        file_path: 'skills-link/my-skill/SKILL.md',
        content: 'x',
      })).not.toBeNull()
    })

    it('技能目录本身被换成软链（比如指向 /）时，口子整个关掉', () => {
      rmSync(skillsDir, { recursive: true })
      symlinkSync(outside, skillsDir, 'dir')
      const probe = new ProjectWorkspaceService()
      expect(probe.checkToolInput(projectDir, 'Read', { file_path: join(skillsDir, 'secret.txt') })).not.toBeNull()
      expect(probe.checkToolInput(projectDir, 'Glob', { pattern: '*', path: skillsDir })).not.toBeNull()
    })

    it.each([
      ['.claude/settings.json'],
      ['.claude/skills/my-skill/SKILL.md'],
    ])('项目自己的 .claude/ 照旧拒绝: %s', (filePath) => {
      mkdirSync(join(projectDir, '.claude', 'skills', 'my-skill'), { recursive: true })
      writeFileSync(join(projectDir, filePath), 'x')
      expect(skillService.checkToolInput(projectDir, 'Read', { file_path: filePath })).toContain('agent configuration')
    })

    it('拒绝信息里告诉模型：技能目录只能读', () => {
      const message = skillService.checkToolInput(projectDir, 'Read', { file_path: '/etc/passwd' })
      expect(message).toContain(join(process.cwd(), '.claude-session', '.claude', 'skills'))
      expect(message).toContain('writing there is never allowed')
    })
  })
})
