import { describe, expect, it } from 'vitest'
import { isBuiltinSkillName, isValidSkillName, parseSkillFile } from './skills.util'

function skillFile(front: string, body = '\n# 正文\n'): string {
  return `---\n${front}\n---${body}`
}

describe('isValidSkillName 目录名白名单', () => {
  it('小写字母数字连字符，3 到 40 个字符', () => {
    expect(isValidSkillName('my-skill')).toBe(true)
    expect(isValidSkillName('abc')).toBe(true)
    expect(isValidSkillName('a1-b2-c3')).toBe(true)
  })

  it('太短太长都不行', () => {
    expect(isValidSkillName('ab')).toBe(false)
    expect(isValidSkillName('a'.repeat(41))).toBe(false)
  })

  it('大写、下划线、空格、点都不行', () => {
    expect(isValidSkillName('MySkill')).toBe(false)
    expect(isValidSkillName('my_skill')).toBe(false)
    expect(isValidSkillName('my skill')).toBe(false)
    expect(isValidSkillName('my.skill')).toBe(false)
  })

  it('不能以连字符或数字开头、以连字符结尾', () => {
    expect(isValidSkillName('-skill')).toBe(false)
    expect(isValidSkillName('1skill')).toBe(false)
    expect(isValidSkillName('skill-')).toBe(false)
  })

  it('不许连续连字符', () => {
    expect(isValidSkillName('my--skill')).toBe(false)
  })

  /**
   * 这一条是挡路径穿越的那道。名字会被拿去 join 技能根目录，
   * 放进来任何一个带斜杠或 .. 的值，文件就写到目录外面去了。
   */
  it('路径穿越一律挡住', () => {
    expect(isValidSkillName('../etc')).toBe(false)
    expect(isValidSkillName('a/b')).toBe(false)
    expect(isValidSkillName('..')).toBe(false)
    expect(isValidSkillName('a\\b')).toBe(false)
  })
})

describe('isBuiltinSkillName 内置名', () => {
  it('认得出内置的', () => {
    expect(isBuiltinSkillName('drafting-post')).toBe(true)
    expect(isBuiltinSkillName('extracting-angles')).toBe(true)
  })

  it('没见过的就不是', () => {
    expect(isBuiltinSkillName('my-skill')).toBe(false)
  })
})

describe('parseSkillFile 解析 frontmatter', () => {
  it('name 和 description 都有就通过', () => {
    const result = parseSkillFile(skillFile('name: my-skill\ndescription: 干这个用的'))
    expect(result).toEqual({ ok: true, meta: { name: 'my-skill', description: '干这个用的' } })
  })

  it('引号会被剥掉', () => {
    const result = parseSkillFile(skillFile('name: "my-skill"\ndescription: \'干这个用的\''))
    expect(result.ok && result.meta.name).toBe('my-skill')
    expect(result.ok && result.meta.description).toBe('干这个用的')
  })

  it('没有 frontmatter 直接拒', () => {
    expect(parseSkillFile('# 就是一篇普通文档')).toEqual({ ok: false, reason: 'frontmatter_missing' })
  })

  /** 技能是靠 description 被匹配到的，空着等于传了个永远不会触发的东西 */
  it('缺 description 也算没 frontmatter', () => {
    expect(parseSkillFile(skillFile('name: my-skill'))).toEqual({ ok: false, reason: 'frontmatter_missing' })
  })

  it('缺 name 一样拒', () => {
    expect(parseSkillFile(skillFile('description: 干这个用的'))).toEqual({ ok: false, reason: 'frontmatter_missing' })
  })

  it('name 不合规要单独说清楚', () => {
    expect(parseSkillFile(skillFile('name: My Skill\ndescription: x'))).toEqual({ ok: false, reason: 'name_invalid' })
  })

  /** 内置的必须赢：不然一次镜像升级会被一个旧的同名上传悄悄改掉行为 */
  it('和内置重名要单独说清楚', () => {
    expect(parseSkillFile(skillFile('name: drafting-post\ndescription: x')))
      .toEqual({ ok: false, reason: 'name_reserved' })
  })

  it('CRLF 换行也认', () => {
    const result = parseSkillFile('---\r\nname: my-skill\r\ndescription: 干这个用的\r\n---\r\n正文')
    expect(result.ok && result.meta.name).toBe('my-skill')
  })

  it('name 里塞路径穿越，按名字不合规拒掉', () => {
    expect(parseSkillFile(skillFile('name: ../../etc/passwd\ndescription: x')))
      .toEqual({ ok: false, reason: 'name_invalid' })
  })
})
