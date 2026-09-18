import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Worker } from 'node:worker_threads'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { safeRemove, safeWriteFile } from './safe-fs'

/**
 * 真并发的对抗测试：攻击方跑在另一个线程里，不打桩、不插钩子，纯真实文件系统。
 *
 * 和 `safe-fs.spec.ts` 里那些钩子用例是互补的——钩子用例证明「在那个瞬间会拒绝」，
 * 这里证明「攻击方全速抢的时候也漏不出去」。这两条曾经都被打穿过：
 * 写入会在根目录外留下空文件，删除会顺着换进来的软链把根目录外的文件删掉。
 */

interface Attacker {
  stop: () => Promise<void>
}

/** 在另一个线程里反复把 `target` 在「真目录」和「指向根目录外的软链」之间掉包 */
function startAttacker(target: string, outside: string): Attacker {
  const stopFlag = new Int32Array(new SharedArrayBuffer(4))
  const source = `
    const fs = require('node:fs')
    const { workerData } = require('node:worker_threads')
    const { target, outside, stopFlag } = workerData
    while (Atomics.load(stopFlag, 0) === 0) {
      try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      try { fs.symlinkSync(outside, target) } catch {}
      try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
      try { fs.mkdirSync(target, { recursive: true }) } catch {}
    }
  `

  const worker = new Worker(source, { eval: true, workerData: { target, outside, stopFlag } })
  worker.unref()

  return {
    stop: async () => {
      Atomics.store(stopFlag, 0, 1)
      await worker.terminate()
    },
  }
}

describe('safe-fs 真并发对抗', () => {
  let root = ''
  let outside = ''
  let projectDir = ''
  let attacker: Attacker | null = null

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'aitoearn-race-root-'))
    outside = await mkdtemp(path.join(tmpdir(), 'aitoearn-race-outside-'))
    projectDir = path.join(root, 'proj')
    await mkdir(path.join(projectDir, 'media'), { recursive: true })
  })

  afterEach(async () => {
    await attacker?.stop()
    attacker = null
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('写入：攻击线程全速换软链，根目录外连空文件都没出现', async () => {
    attacker = startAttacker(path.join(projectDir, 'media'), outside)

    for (let i = 0; i < 1500; i++) {
      await safeWriteFile(root, ['proj', 'media', `x-${i}.md`], Buffer.from('污染', 'utf8'))
        .catch(() => undefined)
    }

    await attacker.stop()
    attacker = null

    expect(await readdir(outside)).toEqual([])
  }, 120_000)

  it('删除：攻击线程全速换软链，根目录外的文件一个都没被删掉', async () => {
    const keep = 50
    for (let i = 0; i < keep; i++)
      await writeFile(path.join(outside, `keep-${i}.md`), 'k', 'utf8')

    const media = path.join(projectDir, 'media')
    const sub = path.join(media, 'sub')
    attacker = startAttacker(sub, outside)

    for (let i = 0; i < 600; i++) {
      await mkdir(path.join(sub, 'deep'), { recursive: true }).catch(() => {})
      await writeFile(path.join(sub, 'deep', 'own.md'), 'o', 'utf8').catch(() => {})
      await safeRemove(root, ['proj', 'media']).catch(() => undefined)
      await mkdir(media, { recursive: true }).catch(() => {})
    }

    await attacker.stop()
    attacker = null

    // 攻击方把软链换进来的那几轮，测试自己会顺着它在外面造出 deep/own.md，这个不算漏；
    // 要查的是根目录外原有的文件一个都不能少
    const left = await readdir(outside)
    for (let i = 0; i < keep; i++) {
      expect(left).toContain(`keep-${i}.md`)
      expect(await readFile(path.join(outside, `keep-${i}.md`), 'utf8')).toBe('k')
    }
  }, 120_000)
})
