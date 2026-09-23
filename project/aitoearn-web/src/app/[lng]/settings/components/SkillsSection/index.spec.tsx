import type { Skill } from '@/api/skills/skill.types'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSkillListApi = vi.fn()
const uploadSkillApi = vi.fn()
const deleteSkillApi = vi.fn()
const toastSuccess = vi.fn()
const toastError = vi.fn()

vi.mock('@/api/skills/skill.api', () => ({
  getSkillListApi: (...a: unknown[]) => getSkillListApi(...a),
  uploadSkillApi: (...a: unknown[]) => uploadSkillApi(...a),
  deleteSkillApi: (...a: unknown[]) => deleteSkillApi(...a),
}))
vi.mock('@/utils/ui/toast', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}))

/**
 * 文案键就是断言对象：改一句中文用例不会红，改错了键照样能抓到。
 * 带参数的把参数拼在后面（`key(name=references,count=3)`），结构摘要要靠它断言到具体数字。
 */
function t(key: string, options?: Record<string, unknown>) {
  if (!options)
    return key
  const params = Object.entries(options)
    .filter(([name]) => name !== 'interpolation')
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(',')
  return `${key}(${params})`
}
vi.mock('@/app/i18n/client', () => ({
  useTransClient: () => ({ t }),
}))

const { SkillsSection } = await import('./index')

const CUSTOM_SKILL: Skill = {
  name: 'weekly-report',
  description: '写周报',
  builtin: false,
  updatedAt: '2026-09-20T00:00:00.000Z',
  files: [
    'LICENSE',
    'README.md',
    'SKILL.md',
    'references/a.md',
    'references/b.md',
    'references/deep/c.md',
    'scripts/run.py',
  ],
}

const BUILTIN_SKILL: Skill = {
  name: 'drafting-post',
  description: '写帖子',
  builtin: true,
  files: ['SKILL.md'],
}

const MiB = 1024 * 1024
const KiB = 1024

/** 造一个指定大小的文件：大小直接改 size，不真去分配十几兆内存 */
function makeFile(name: string, size: number, type = '') {
  const file = new File(['x'], name, { type })
  Object.defineProperty(file, 'size', { value: size })
  return file
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getSkillListApi.mockResolvedValue({ code: 0, data: { list: [CUSTOM_SKILL, BUILTIN_SKILL] } })
  uploadSkillApi.mockResolvedValue({ code: 0, data: CUSTOM_SKILL })
})

async function renderSection() {
  const view = render(<SkillsSection />)
  await screen.findByText('weekly-report')
  return view
}

/** 文件选择框本身是隐藏的；applyAccept 关掉，模拟人在系统对话框里切到「所有文件」硬选了一个 */
async function pick(file: File) {
  const user = userEvent.setup({ applyAccept: false })
  await user.upload(screen.getByLabelText('skills.upload.pick'), file)
  return user
}

describe('skillsSection 列表', () => {
  it('自定义和内置分开摆，全局生效的警示在最上面', async () => {
    await renderSection()

    const custom = screen.getByRole('list', { name: 'skills.custom.title' })
    const builtin = screen.getByRole('list', { name: 'skills.builtin.title' })

    expect(within(custom).getByText('weekly-report')).toBeInTheDocument()
    expect(within(custom).queryByText('drafting-post')).not.toBeInTheDocument()
    expect(within(builtin).getByText('drafting-post')).toBeInTheDocument()
    expect(within(builtin).getByText('skills.builtinTag')).toBeInTheDocument()
    expect(within(builtin).queryByText('weekly-report')).not.toBeInTheDocument()

    const warning = screen.getByText('skills.globalWarning')
    const uploadTitle = screen.getByText('skills.upload.title')
    // 警示条在上传卡片前面
    expect(warning.compareDocumentPosition(uploadTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('结构摘要按第一段目录计数，根目录别的文件算「其他」', async () => {
    await renderSection()

    const custom = screen.getByRole('list', { name: 'skills.custom.title' })
    expect(within(custom).getByText(
      'SKILL.md · skills.structure.dir(name=references,count=3) · skills.structure.dir(name=scripts,count=1) · skills.structure.other(count=2)',
    )).toBeInTheDocument()
  })

  it('只有 SKILL.md 的技能只显示 SKILL.md，不给展开', async () => {
    await renderSection()

    const builtin = screen.getByRole('list', { name: 'skills.builtin.title' })
    expect(within(builtin).getByText('SKILL.md')).toBeInTheDocument()
    expect(within(builtin).queryByRole('button', { name: /skills.structure.show/ })).not.toBeInTheDocument()
  })

  it('文件列表默认收起，点开能看到完整路径，再点收起', async () => {
    await renderSection()
    const user = userEvent.setup()

    expect(screen.queryByText('references/deep/c.md')).not.toBeInTheDocument()

    const toggle = screen.getByRole('button', { name: /skills.structure.show/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const custom = screen.getByRole('list', { name: 'skills.custom.title' })
    for (const path of CUSTOM_SKILL.files)
      expect(within(custom).getByText(path)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /skills.structure.hide/ }))
    expect(screen.queryByText('references/deep/c.md')).not.toBeInTheDocument()
  })

  it('服务端没给 files 时不摆摘要，也不报错', async () => {
    getSkillListApi.mockResolvedValue({
      code: 0,
      data: { list: [{ name: 'legacy-skill', description: '旧的', builtin: false }] },
    })
    render(<SkillsSection />)

    expect(await screen.findByText('legacy-skill')).toBeInTheDocument()
    const custom = screen.getByRole('list', { name: 'skills.custom.title' })
    expect(within(custom).queryByText(/SKILL\.md/)).not.toBeInTheDocument()
    expect(within(custom).queryByRole('button', { name: /skills.structure.show/ })).not.toBeInTheDocument()
  })

  it('内置技能没有删除按钮，自定义的有', async () => {
    await renderSection()

    const custom = screen.getByRole('list', { name: 'skills.custom.title' })
    const builtin = screen.getByRole('list', { name: 'skills.builtin.title' })

    expect(within(builtin).queryByRole('button', { name: /skills.delete.action/ })).not.toBeInTheDocument()
    expect(within(custom).getByRole('button', { name: /skills.delete.action/ })).toBeInTheDocument()
  })
})

describe('skillsSection 上传', () => {
  it('上传卡片说明以 zip 为主，写明 scripts 跑不了', async () => {
    await renderSection()

    expect(screen.getByLabelText('skills.upload.pick'))
      .toHaveAttribute('accept', '.zip,.md,application/zip,text/markdown')
    expect(screen.getByText('skills.upload.treeLabel')).toBeInTheDocument()
    expect(screen.getByText('   ├─ SKILL.md', { normalizer: s => s })).toBeInTheDocument()
    expect(screen.getByText('skills.upload.rules.name')).toBeInTheDocument()
    expect(screen.getByText('skills.upload.rules.limits')).toBeInTheDocument()
    expect(screen.getByText('skills.upload.scriptsNote')).toBeInTheDocument()
  })

  it('.txt 不发请求，提示 fileInvalid', async () => {
    await renderSection()

    await pick(makeFile('notes.txt', 100, 'text/plain'))

    expect(toastError).toHaveBeenCalledWith('skills.error.fileInvalid')
    expect(uploadSkillApi).not.toHaveBeenCalled()
  })

  it('11 MiB 的 .zip 不发请求，提示 fileTooLarge', async () => {
    await renderSection()

    await pick(makeFile('big.zip', 11 * MiB, 'application/zip'))

    expect(toastError).toHaveBeenCalledWith('skills.error.fileTooLarge')
    expect(uploadSkillApi).not.toHaveBeenCalled()
  })

  it('70 KiB 的 .md 不发请求，提示 fileTooLarge', async () => {
    await renderSection()

    await pick(makeFile('SKILL.md', 70 * KiB, 'text/markdown'))

    expect(toastError).toHaveBeenCalledWith('skills.error.fileTooLarge')
    expect(uploadSkillApi).not.toHaveBeenCalled()
  })

  it('合法的 .zip 直接传（不带覆盖），成功后重拉列表', async () => {
    await renderSection()
    expect(getSkillListApi).toHaveBeenCalledTimes(1)

    const file = makeFile('weekly-report.zip', 2 * MiB, 'application/zip')
    await pick(file)

    await waitFor(() => expect(uploadSkillApi).toHaveBeenCalledWith({ file, overwrite: false }))
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('skills.uploadSuccess'))
    await waitFor(() => expect(getSkillListApi).toHaveBeenCalledTimes(2))
    expect(toastError).not.toHaveBeenCalled()
  })

  it('重名时先问一句，点了覆盖才带 overwrite=true 再传一次', async () => {
    uploadSkillApi
      .mockResolvedValueOnce({ code: 20905, data: null })
      .mockResolvedValueOnce({ code: 0, data: CUSTOM_SKILL })
    await renderSection()

    const file = makeFile('weekly-report.zip', 1 * MiB, 'application/zip')
    const user = await pick(file)

    expect(await screen.findByText('skills.overwrite.title')).toBeInTheDocument()
    expect(uploadSkillApi).toHaveBeenCalledTimes(1)
    expect(uploadSkillApi).toHaveBeenLastCalledWith({ file, overwrite: false })
    // 重名不是错，不该弹错误提示
    expect(toastError).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'skills.overwrite.confirm' }))

    await waitFor(() => expect(uploadSkillApi).toHaveBeenCalledTimes(2))
    expect(uploadSkillApi).toHaveBeenLastCalledWith({ file, overwrite: true })
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('skills.uploadSuccess'))
    await waitFor(() => expect(screen.queryByText('skills.overwrite.title')).not.toBeInTheDocument())
    expect(getSkillListApi).toHaveBeenCalledTimes(2)
  })

  it.each([
    [20909, 'skills.error.archiveInvalid'],
    [20910, 'skills.error.archiveTooLarge'],
    [20911, 'skills.error.entryMissing'],
  ])('服务端回 %i 时提示 %s，不重拉列表', async (code, key) => {
    uploadSkillApi.mockResolvedValue({ code, data: null })
    await renderSection()

    await pick(makeFile('weekly-report.zip', 1 * MiB, 'application/zip'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(key))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(getSkillListApi).toHaveBeenCalledTimes(1)
  })

  it('请求本身抛错时说「没成功」', async () => {
    uploadSkillApi.mockRejectedValue(new Error('offline'))
    await renderSection()

    await pick(makeFile('weekly-report.zip', 1 * MiB, 'application/zip'))

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('skills.error.unknown'))
  })
})
