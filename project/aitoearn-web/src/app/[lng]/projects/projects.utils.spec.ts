import { describe, expect, it } from 'vitest'
import { PROJECT_FILE_ERROR_CODE } from '@/api/projects/project-file.constants'
import { PROJECT_ERROR_CODE, PROJECT_NAME_MAX_LENGTH } from '@/api/projects/project.constants'
import { getProjectErrorKey, validateProjectDisplayName, validateProjectName } from './projects.utils'

describe('validateProjectName', () => {
  it('合法的英文名放行', () => {
    expect(validateProjectName('forty-weeks')).toBeNull()
    expect(validateProjectName('ab1')).toBeNull()
    expect(validateProjectName('  spaced-name  ')).toBeNull()
  })

  it('空名字要求先填', () => {
    expect(validateProjectName('')).toBe('nameError.required')
    expect(validateProjectName('   ')).toBe('nameError.required')
  })

  /**
   * 拒绝理由的**顺序**必须跟服务端一模一样，不然同一个名字两边给出的说法会对不上。
   * `config` 既是保留字、字符集也合法；`_foo` 既是保留字、字符集也不合法——
   * 两个都必须先报保留字。
   */
  it('保留字先于其它规则判定', () => {
    expect(validateProjectName('config')).toBe('nameError.reserved')
    expect(validateProjectName('CONFIG')).toBe('nameError.reserved')
    expect(validateProjectName('_foo')).toBe('nameError.reserved')
    expect(validateProjectName('.hidden')).toBe('nameError.reserved')
  })

  it('字符集只认小写字母、数字和连字符', () => {
    expect(validateProjectName('Foo')).toBe('nameError.charset')
    expect(validateProjectName('foo_bar')).toBe('nameError.charset')
    expect(validateProjectName('foo bar')).toBe('nameError.charset')
    expect(validateProjectName('中文名')).toBe('nameError.charset')
  })

  it('必须字母开头、字母或数字结尾', () => {
    expect(validateProjectName('1abc')).toBe('nameError.start')
    expect(validateProjectName('-abc')).toBe('nameError.start')
    expect(validateProjectName('abc-')).toBe('nameError.end')
  })

  it('太短或太长都拒绝', () => {
    expect(validateProjectName('ab')).toBe('nameError.length')
    expect(validateProjectName(`a${'b'.repeat(PROJECT_NAME_MAX_LENGTH)}`)).toBe('nameError.length')
    // 边界上的两个名字要放行，别把合法名字连坐掉
    expect(validateProjectName('abc')).toBeNull()
    expect(validateProjectName(`a${'b'.repeat(PROJECT_NAME_MAX_LENGTH - 1)}`)).toBeNull()
  })

  it('不允许连续连字符', () => {
    expect(validateProjectName('foo--bar')).toBe('nameError.doubleHyphen')
  })
})

describe('validateProjectDisplayName', () => {
  it('正常显示名放行', () => {
    expect(validateProjectDisplayName('四十周')).toBeNull()
  })

  it('空显示名要求先填', () => {
    expect(validateProjectDisplayName('')).toBe('displayNameError.required')
    expect(validateProjectDisplayName('  ')).toBe('displayNameError.required')
  })

  it('超长显示名拒绝', () => {
    expect(validateProjectDisplayName('名'.repeat(500))).toBe('displayNameError.tooLong')
  })
})

describe('getProjectErrorKey', () => {
  it('请求本身没到服务端时按网络错误处理', () => {
    expect(getProjectErrorKey(null)).toBe('error.network')
    expect(getProjectErrorKey(undefined)).toBe('error.network')
  })

  it('项目业务码翻成对应文案键', () => {
    expect(getProjectErrorKey(PROJECT_ERROR_CODE.NotFound)).toBe('error.notFound')
    expect(getProjectErrorKey(PROJECT_ERROR_CODE.NameTaken)).toBe('error.nameTaken')
    expect(getProjectErrorKey(PROJECT_ERROR_CODE.Archived)).toBe('error.archived')
    expect(getProjectErrorKey(PROJECT_ERROR_CODE.PathEscape)).toBe('error.pathEscape')
  })

  it('文件业务码翻成 fileError 文案键', () => {
    expect(getProjectErrorKey(PROJECT_FILE_ERROR_CODE.NotFound)).toBe('fileError.notFound')
    expect(getProjectErrorKey(PROJECT_FILE_ERROR_CODE.IsSymlink)).toBe('fileError.isSymlink')
    expect(getProjectErrorKey(PROJECT_FILE_ERROR_CODE.UploadFailed)).toBe('fileError.uploadFailed')
  })

  it('字符串形式的业务码同样认得', () => {
    expect(getProjectErrorKey(String(PROJECT_ERROR_CODE.NotFound))).toBe('error.notFound')
  })

  it('没收录的业务码退回未知错误', () => {
    expect(getProjectErrorKey(999999)).toBe('error.unknown')
  })
})
