/**
 * 技能上传的整链路：真 zip 字节喂进去 → 解压 → 校验 → 原子落盘。
 *
 * zip 用下面的 `buildZip` 现拼：正常的打包工具不肯造 `../evil.txt`、软链条目、说谎的头部，
 * 而这些正是要测的。
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { AppException, ResponseCode } from '@yikart/common'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extractSkillArchive, MAX_SKILL_ARCHIVE_BYTES } from './skills-archive.util'
import { detectSkillUploadKind, removeStoredSkill, storeSkillUpload } from './skills-store.util'

interface ZipEntrySpec {
  name: string
  content?: string | Buffer
  deflate?: boolean
  /** 完整 unix mode（含类型位）；默认普通文件 0100644，名字以 / 结尾的是目录 040755 */
  mode?: number
  /** 在头部里谎报解压后大小 */
  declaredSize?: number
  /** 通用位标志，bit 0 = 加密；默认 0x0800（UTF-8 文件名） */
  flags?: number
}

const DOS_DATE_1980_01_01 = 0x21

/** 拼一个最小的 zip：本地头 + 数据、中央目录、目录结尾记录 */
function buildZip(entries: ZipEntrySpec[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const spec of entries) {
    const name = Buffer.from(spec.name, 'utf8')
    const data = Buffer.isBuffer(spec.content) ? spec.content : Buffer.from(spec.content ?? '', 'utf8')
    const method = spec.deflate ? 8 : 0
    const body = spec.deflate ? deflateRawSync(data) : data
    const crc = crc32(data)
    const size = spec.declaredSize ?? data.length
    const flags = spec.flags ?? 0x0800
    const mode = spec.mode ?? (spec.name.endsWith('/') ? 0o040755 : 0o100644)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE_1980_01_01, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE((3 << 8) | 20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(DOS_DATE_1980_01_01, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((mode << 16) >>> 0, 38)
    central.writeUInt32LE(offset, 42)

    localParts.push(local, name, body)
    centralParts.push(central, name)
    offset += local.length + name.length + body.length
  }

  const centralDir = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDir.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralDir, end])
}

function skillMd(name: string, description = '干这个用的'): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n细节见 references/api.md\n`
}

async function expectCode(promise: Promise<unknown>, code: ResponseCode): Promise<void> {
  const error = await promise.then(() => null, (reason: unknown) => reason)
  expect(error, `期望抛出 ${ResponseCode[code]}`).toBeInstanceOf(AppException)
  expect(ResponseCode[(error as AppException).code]).toBe(ResponseCode[code])
}

function listTree(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? listTree(join(dir, entry.name), rel) : [rel]
  }).sort()
}

const MiB = 1024 * 1024

describe('extractSkillArchive 解压安全', () => {
  let sandbox: string
  let dest: string

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'aitoearn-skill-zip-'))
    dest = join(sandbox, 'staging')
    mkdirSync(dest)
  })

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true })
  })

  it('包根就是技能根：整包解出来，scripts 下 0755，其余 0644', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill'), deflate: true },
      { name: 'references/', mode: 0o040755 },
      { name: 'references/api.md', content: '# api', deflate: true },
      { name: 'scripts/run.sh', content: '#!/bin/sh\necho hi\n' },
      { name: 'assets/logo.txt', content: 'logo' },
    ])

    const written = await extractSkillArchive(zip, dest)

    expect(written).toEqual(['SKILL.md', 'assets/logo.txt', 'references/api.md', 'scripts/run.sh'])
    expect(listTree(dest)).toEqual(written)
    expect(readFileSync(join(dest, 'references/api.md'), 'utf8')).toBe('# api')
    expect(statSync(join(dest, 'scripts/run.sh')).mode & 0o777).toBe(0o755)
    expect(statSync(join(dest, 'SKILL.md')).mode & 0o777).toBe(0o644)
    expect(statSync(join(dest, 'references/api.md')).mode & 0o777).toBe(0o644)
  })

  it('访达（Finder）压缩的样子：剥掉唯一的顶层文件夹，__MACOSX 和 .DS_Store 当没看见', async () => {
    const zip = buildZip([
      { name: 'folder-name-does-not-matter/', mode: 0o040755 },
      { name: 'folder-name-does-not-matter/SKILL.md', content: skillMd('demo-skill') },
      { name: 'folder-name-does-not-matter/.DS_Store', content: 'junk' },
      { name: 'folder-name-does-not-matter/references/a.md', content: 'a' },
      { name: '__MACOSX/', mode: 0o040755 },
      { name: '__MACOSX/folder-name-does-not-matter/._SKILL.md', content: 'resource fork' },
    ])

    expect(await extractSkillArchive(zip, dest)).toEqual(['SKILL.md', 'references/a.md'])
    expect(listTree(dest)).toEqual(['SKILL.md', 'references/a.md'])
  })

  it.each([
    ['../evil.txt', '回退到上级'],
    ['a/../../evil.txt', '中间回退'],
    ['/tmp/evil.txt', '绝对路径'],
    ['..\\evil.txt', '反斜杠'],
    ['C:/evil.txt', '盘符'],
    ['a\0/evil.txt', 'NUL'],
  ])('越界条目 %j（%s）整包拒绝，目录外什么都没写', async (name) => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name, content: 'pwned' },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
    expect(readdirSync(sandbox)).toEqual(['staging'])
    expect(readdirSync(dest)).toEqual([])
  })

  it('软链条目直接拒，一个软链都不建', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'references/passwd', content: '/etc/passwd', mode: 0o120777 },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
    expect(readdirSync(dest)).toEqual([])
  })

  it('设备、管道这类特殊文件同样拒', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'fifo', content: '', mode: 0o010644 },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
  })

  it('加密条目拒', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'secret.md', content: 'x'.repeat(20), flags: 0x0801, declaredSize: 8 },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
  })

  it('同名条目两份拒', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'SKILL.md', content: skillMd('other-skill') },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
  })

  it('不是 zip 拒', async () => {
    await expectCode(extractSkillArchive(Buffer.from('definitely not a zip'), dest), ResponseCode.SkillArchiveInvalid)
  })

  it('两个顶层文件夹 → SkillEntryMissing', async () => {
    const zip = buildZip([
      { name: 'a/SKILL.md', content: skillMd('demo-skill') },
      { name: 'b/SKILL.md', content: skillMd('demo-skill') },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillEntryMissing)
  })

  it('哪都没有 SKILL.md → SkillEntryMissing', async () => {
    const zip = buildZip([{ name: 'README.md', content: 'x' }])
    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillEntryMissing)
  })

  it('只有 __MACOSX → SkillEntryMissing', async () => {
    const zip = buildZip([{ name: '__MACOSX/._SKILL.md', content: 'x' }])
    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillEntryMissing)
  })

  it('单个文件超过 10 MiB 拒', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'assets/big.bin', content: Buffer.alloc(10 * MiB + 1), deflate: true },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveTooLarge)
    expect(existsSync(join(dest, 'assets/big.bin'))).toBe(false)
  })

  it('解压总量超过 30 MiB 拒（高压缩比：包本身不到 100 KiB）', async () => {
    const eightMiB = Buffer.alloc(8 * MiB)
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      ...[1, 2, 3, 4].map(i => ({ name: `assets/zero-${i}.bin`, content: eightMiB, deflate: true })),
    ])
    expect(zip.length).toBeLessThan(100 * 1024)

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveTooLarge)
  })

  it('文件数超过 500 拒', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      ...Array.from({ length: 500 }, (_, i) => ({ name: `references/${i}.md`, content: `${i}` })),
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveTooLarge)
  })

  it('目录和 __MACOSX 不占文件数', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      ...Array.from({ length: 499 }, (_, i) => ({ name: `references/${i}.md`, content: `${i}` })),
      { name: 'references/', mode: 0o040755 },
      { name: '__MACOSX/._SKILL.md', content: 'x' },
    ])

    expect(await extractSkillArchive(zip, dest)).toHaveLength(500)
  })

  /**
   * 头部说谎：声明只有 16 字节，实际解出 11 MiB。声明值骗过了预检，
   * 但解压时实际字节数一超过声明值就掐断（yauzl 的 validateEntrySizes 先响，按「包坏了」处理），
   * 不会把 11 MiB 全解出来、更不会写盘。就算这一道漏了，`ArchiveByteBudget` 按实际字节数还有一道。
   */
  it('头部谎报大小：按实际字节掐断，一个字节都不落盘', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('demo-skill') },
      { name: 'assets/liar.bin', content: Buffer.alloc(11 * MiB), deflate: true, declaredSize: 16 },
    ])

    await expectCode(extractSkillArchive(zip, dest), ResponseCode.SkillArchiveInvalid)
    expect(existsSync(join(dest, 'assets/liar.bin'))).toBe(false)
  })
})

describe('storeSkillUpload 原子落盘', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'aitoearn-skill-store-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function leftovers(): string[] {
    return readdirSync(root).filter(name => name.startsWith('.'))
  }

  it('按扩展名认格式', () => {
    expect(detectSkillUploadKind('a.md')).toBe('markdown')
    expect(detectSkillUploadKind('A.MD')).toBe('markdown')
    expect(detectSkillUploadKind('pack.zip')).toBe('archive')
    expect(detectSkillUploadKind('pack.tar.gz')).toBeNull()
    expect(detectSkillUploadKind('')).toBeNull()
  })

  it('单个 .md 落成 <name>/SKILL.md', async () => {
    const stored = await storeSkillUpload(root, { buffer: Buffer.from(skillMd('my-skill')), originalName: 'whatever.md' }, false)

    expect(stored).toEqual({ name: 'my-skill', description: '干这个用的', files: ['SKILL.md'] })
    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toBe(skillMd('my-skill'))
    expect(statSync(join(root, 'my-skill')).mode & 0o777).toBe(0o755)
    expect(leftovers()).toEqual([])
  })

  it('技能名取 frontmatter，不看包里文件夹叫什么', async () => {
    const zip = buildZip([
      { name: 'Random Folder/SKILL.md', content: skillMd('real-name') },
      { name: 'Random Folder/references/api.md', content: '# api' },
    ])

    const stored = await storeSkillUpload(root, { buffer: zip, originalName: 'x.zip' }, false)

    expect(stored.name).toBe('real-name')
    expect(stored.files).toEqual(['SKILL.md', 'references/api.md'])
    expect(readdirSync(root)).toEqual(['real-name'])
  })

  it('扩展名不对 → SkillFileInvalid', async () => {
    await expectCode(storeSkillUpload(root, { buffer: Buffer.from('x'), originalName: 'a.txt' }, false), ResponseCode.SkillFileInvalid)
  })

  it('.md 超 64 KiB → SkillFileTooLarge', async () => {
    const buffer = Buffer.from(skillMd('my-skill') + 'x'.repeat(64 * 1024))
    await expectCode(storeSkillUpload(root, { buffer, originalName: 'a.md' }, false), ResponseCode.SkillFileTooLarge)
    expect(readdirSync(root)).toEqual([])
  })

  it('.zip 超 10 MiB → SkillFileTooLarge', async () => {
    const buffer = Buffer.alloc(MAX_SKILL_ARCHIVE_BYTES + 1)
    await expectCode(storeSkillUpload(root, { buffer, originalName: 'a.zip' }, false), ResponseCode.SkillFileTooLarge)
  })

  it('包里的 SKILL.md 超 64 KiB → SkillFileTooLarge，临时目录清干净', async () => {
    const zip = buildZip([{ name: 'SKILL.md', content: skillMd('my-skill') + 'x'.repeat(64 * 1024) }])
    await expectCode(storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false), ResponseCode.SkillFileTooLarge)
    expect(readdirSync(root)).toEqual([])
  })

  it.each([
    ['name: my-skill', ResponseCode.SkillFrontmatterMissing, '缺 description'],
    ['name: drafting-post\ndescription: x', ResponseCode.SkillNameReserved, '和内置重名'],
    ['name: My Skill\ndescription: x', ResponseCode.SkillNameInvalid, '名字不合规'],
    ['name: ../../etc\ndescription: x', ResponseCode.SkillNameInvalid, '名字里塞路径穿越'],
  ])('包里 SKILL.md 的 frontmatter 照样校验：%s', async (front, code) => {
    const zip = buildZip([{ name: 'SKILL.md', content: `---\n${front}\n---\n正文` }])
    await expectCode(storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false), code)
    expect(readdirSync(root)).toEqual([])
  })

  it('坏包失败后不留临时目录', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill') },
      { name: 'references/ok.md', content: 'ok' },
      { name: '../evil.txt', content: 'x' },
    ])
    await expectCode(storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false), ResponseCode.SkillArchiveInvalid)
    expect(readdirSync(root)).toEqual([])
    expect(existsSync(join(dirname(root), 'evil.txt'))).toBe(false)
  })

  it('同名默认不覆盖，旧的原样留着', async () => {
    await storeSkillUpload(root, { buffer: Buffer.from(skillMd('my-skill', '旧的')), originalName: 'a.md' }, false)

    const zip = buildZip([{ name: 'SKILL.md', content: skillMd('my-skill', '新的') }])
    await expectCode(storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false), ResponseCode.SkillAlreadyExists)

    expect(readFileSync(join(root, 'my-skill', 'SKILL.md'), 'utf8')).toContain('旧的')
    expect(leftovers()).toEqual([])
  })

  it('覆盖是整个换掉：旧包里有、新包里没有的文件不残留', async () => {
    const oldZip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill', '旧的') },
      { name: 'references/old-only.md', content: 'old' },
      { name: 'scripts/old.sh', content: 'echo old' },
    ])
    await storeSkillUpload(root, { buffer: oldZip, originalName: 'old.zip' }, false)

    const newZip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill', '新的') },
      { name: 'references/new-only.md', content: 'new' },
    ])
    const stored = await storeSkillUpload(root, { buffer: newZip, originalName: 'new.zip' }, true)

    expect(stored.description).toBe('新的')
    expect(listTree(join(root, 'my-skill'))).toEqual(['SKILL.md', 'references/new-only.md'])
    expect(leftovers()).toEqual([])
  })

  it('用 .md 覆盖一个技能包，同样整个换掉', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill') },
      { name: 'references/a.md', content: 'a' },
    ])
    await storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false)
    await storeSkillUpload(root, { buffer: Buffer.from(skillMd('my-skill', '单文件')), originalName: 'a.md' }, true)

    expect(listTree(join(root, 'my-skill'))).toEqual(['SKILL.md'])
  })

  it('只剩空壳（没有 SKILL.md）的同名目录不算已存在，直接顶掉', async () => {
    mkdirSync(join(root, 'my-skill', 'junk'), { recursive: true })
    writeFileSync(join(root, 'my-skill', 'junk', 'x.txt'), 'x')

    await storeSkillUpload(root, { buffer: Buffer.from(skillMd('my-skill')), originalName: 'a.md' }, false)
    expect(listTree(join(root, 'my-skill'))).toEqual(['SKILL.md'])
  })

  it('技能根目录还没建时自己建', async () => {
    const nested = join(root, 'not', 'yet')
    await storeSkillUpload(nested, { buffer: Buffer.from(skillMd('my-skill')), originalName: 'a.md' }, false)
    expect(existsSync(join(nested, 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('删除：整个目录拿掉，不留 trash；不存在的返回 false', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill') },
      { name: 'references/a.md', content: 'a' },
    ])
    await storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false)

    expect(await removeStoredSkill(root, 'my-skill')).toBe(true)
    expect(readdirSync(root)).toEqual([])
    expect(await removeStoredSkill(root, 'my-skill')).toBe(false)
  })

  it('落盘的全是普通文件，没有软链', async () => {
    const zip = buildZip([
      { name: 'SKILL.md', content: skillMd('my-skill') },
      { name: 'references/a.md', content: 'a' },
    ])
    await storeSkillUpload(root, { buffer: zip, originalName: 'a.zip' }, false)

    for (const file of listTree(join(root, 'my-skill')))
      expect(lstatSync(join(root, 'my-skill', file)).isFile()).toBe(true)
  })
})
