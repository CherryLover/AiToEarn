import { ResponseCode } from '@yikart/common'
import { describe, expect, it } from 'vitest'
import {
  assertProjectNameUsable,
  buildArchivedDirName,
  isValidProjectName,
  normalizeProjectName,
  randomProjectName,
} from './project-name.util'

describe('project name rules', () => {
  it('accepts names that follow the rule', () => {
    const valid = ['abc', 'fortyweeks', 'calm-otter', 'a1b', 'my-project-2', 'a'.repeat(40)]
    for (const name of valid) {
      expect(isValidProjectName(name), name).toBe(true)
      expect(() => assertProjectNameUsable(name)).not.toThrow()
    }
  })

  it('rejects names that break the rule', () => {
    const invalid = [
      'ab', // 太短
      'a'.repeat(41), // 太长
      '1abc', // 数字开头
      'Abc', // 大写
      'abc-', // 连字符结尾
      'ab--c', // 连续连字符
      'ab c', // 空格
      'ab_c', // 下划线
      'ab.c', // 点
      '中文名', // 非 ASCII
    ]
    for (const name of invalid) {
      expect(isValidProjectName(name), name).toBe(false)
      expect(() => assertProjectNameUsable(name), name)
        .toThrow(expect.objectContaining({ code: ResponseCode.ProjectNameInvalid }))
    }
  })

  it('rejects reserved names', () => {
    const reserved = ['archived', 'tmp', 'temp', 'system', 'config', 'node_modules', '_hidden', '.env']
    for (const name of reserved) {
      expect(() => assertProjectNameUsable(name), name)
        .toThrow(expect.objectContaining({ code: ResponseCode.ProjectNameReserved }))
    }
  })

  it('trims surrounding whitespace before validating', () => {
    expect(normalizeProjectName('  fortyweeks \n')).toBe('fortyweeks')
  })

  it('generates readable adjective-noun suggestions', () => {
    for (let i = 0; i < 50; i++) {
      const name = randomProjectName()
      expect(name).toMatch(/^[a-z]+-[a-z]+$/)
      expect(isValidProjectName(name)).toBe(true)
    }
  })

  it('builds the archived directory name with a timestamp', () => {
    const dirName = buildArchivedDirName('fortyweeks', new Date(2026, 8, 18, 9, 5, 3))
    expect(dirName).toBe('_archived_fortyweeks_20260918090503')
  })
})
