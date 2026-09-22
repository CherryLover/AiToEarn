import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ResponseCode } from '../enums/response-code.enum'
import {
  assertNoProtectedConfigPaths,
  collectConfigLeafPaths,
  diffConfigOverride,
  diffTopLevelKeys,
  findProtectedConfigPaths,
  listProtectedConfigPaths,
  mergeConfigOverride,
  readConfigOverrideFileSync,
  resolveConfigOverridePath,
} from './config-override.util'

function catchCode(run: () => unknown): number | undefined {
  try {
    run()
    return undefined
  }
  catch (error) {
    return (error as { code?: number }).code
  }
}

describe('resolveConfigOverridePath', () => {
  it('覆盖文件就放在基础配置旁边，扩展名跟着基础配置走', () => {
    expect(resolveConfigOverridePath('/app/config.yaml')).toBe('/app/config.override.yaml')
    expect(resolveConfigOverridePath('/app/config.json')).toBe('/app/config.override.json')
    expect(resolveConfigOverridePath('/srv/conf/ai.yml')).toBe('/srv/conf/ai.override.yml')
  })
})

describe('mergeConfigOverride', () => {
  it('对象递归合并', () => {
    const base = { agent: { baseUrl: 'base', apiKey: 'key' }, ai: { openai: { apiKey: 'a' } } }

    expect(mergeConfigOverride(base, { agent: { baseUrl: 'override' } })).toEqual({
      agent: { baseUrl: 'override', apiKey: 'key' },
      ai: { openai: { apiKey: 'a' } },
    })
  })

  it('数组整体替换，不按下标合并', () => {
    const base = { agent: { models: ['a', 'b', 'c'] } }

    expect(mergeConfigOverride(base, { agent: { models: ['z'] } })).toEqual({
      agent: { models: ['z'] },
    })
  })

  it('覆盖层里的新键直接加进去', () => {
    expect(mergeConfigOverride({ a: 1 }, { b: { c: 2 } })).toEqual({ a: 1, b: { c: 2 } })
  })

  it('空覆盖层等于原样返回，base 不会被改动', () => {
    const base = { agent: { baseUrl: 'base' } }
    const merged = mergeConfigOverride(base, {})

    expect(merged).toEqual(base)
    expect(merged).not.toBe(base)
  })

  it('合并不会就地改动 base', () => {
    const base = { agent: { baseUrl: 'base', models: ['a'] } }
    mergeConfigOverride(base, { agent: { baseUrl: 'override', models: ['z'] } })

    expect(base).toEqual({ agent: { baseUrl: 'base', models: ['a'] } })
  })
})

describe('diffConfigOverride', () => {
  it('只留下和 base 不同的部分', () => {
    const base = { port: 3000, agent: { baseUrl: 'base', apiKey: 'key' } }
    const next = { port: 3000, agent: { baseUrl: 'changed', apiKey: 'key' } }

    expect(diffConfigOverride(base, next)).toEqual({ agent: { baseUrl: 'changed' } })
  })

  it('值一样就什么都不写，不会冻结出同值副本', () => {
    const base = { notify: { enabled: false, group: 'AiToEarn' }, models: ['a', 'b'] }

    expect(diffConfigOverride(base, { ...base, models: ['a', 'b'] })).toEqual({})
  })

  it('数组只要不完全一样就整条写进去', () => {
    expect(diffConfigOverride({ models: ['a', 'b'] }, { models: ['a'] })).toEqual({ models: ['a'] })
  })

  it('base 里没有的键整份写进去', () => {
    expect(diffConfigOverride({}, { relay: { apiKey: 'x' } })).toEqual({ relay: { apiKey: 'x' } })
  })

  it('base 有、提交值里没有的键被忽略：覆盖层表达不了「删掉」', () => {
    expect(diffConfigOverride({ a: 1, b: 2 }, { a: 1 })).toEqual({})
  })
})

describe('collectConfigLeafPaths', () => {
  it('列出叶子键路径，数组和空对象都算叶子', () => {
    expect(collectConfigLeafPaths({
      agent: { baseUrl: 'x', models: ['a'] },
      notify: {},
    })).toEqual(['agent.baseUrl', 'agent.models', 'notify'])
  })
})

describe('diffTopLevelKeys', () => {
  it('只报变了的顶层键', () => {
    expect(diffTopLevelKeys(
      { agent: { baseUrl: 'a' }, ai: { x: 1 } },
      { agent: { baseUrl: 'b' }, ai: { x: 1 } },
    )).toEqual(['agent'])
  })
})

describe('受保护键', () => {
  it('逐个列出违规的键路径', () => {
    expect(findProtectedConfigPaths({
      auth: { secret: 'x', expiresIn: '1d' },
      port: 4000,
      agent: { baseUrl: 'ok' },
    })).toEqual(['port', 'auth.secret', 'auth.expiresIn'])
  })

  it('没有违规就返回空数组', () => {
    expect(findProtectedConfigPaths({ agent: { baseUrl: 'ok' } })).toEqual([])
  })

  it('assert 抛出的异常里带着全部违规键路径', () => {
    let captured: { code: number, getResponse: () => { data: { paths: string[] } } } | undefined
    try {
      assertNoProtectedConfigPaths({ mongodb: { uri: 'x' }, redis: { host: 'y' } })
    }
    catch (error) {
      captured = error as typeof captured
    }

    expect(captured?.code).toBe(ResponseCode.ConfigOverrideProtectedKey)
    expect(captured?.getResponse().data.paths).toEqual(['mongodb.uri', 'redis.host'])
  })

  it('只列出这份配置里真正存在的受保护顶层键', () => {
    expect(listProtectedConfigPaths({ auth: {}, agent: {}, mongodb: {} })).toEqual(['auth', 'mongodb'])
  })
})

describe('readConfigOverrideFileSync', () => {
  let workspace: string

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'config-override-'))
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('文件不存在不算失败，返回空覆盖层', () => {
    expect(readConfigOverrideFileSync(join(workspace, 'config.override.yaml'))).toEqual({})
  })

  it('路径被 Docker 建成目录时也当作没有覆盖层', async () => {
    const path = join(workspace, 'config.override.yaml')
    await mkdir(path)

    expect(readConfigOverrideFileSync(path)).toEqual({})
  })

  it('空文件当作没有覆盖层', async () => {
    const path = join(workspace, 'config.override.yaml')
    await writeFile(path, '# 什么都没写\n', 'utf-8')

    expect(readConfigOverrideFileSync(path)).toEqual({})
  })

  it('正常读出 yaml 覆盖层', async () => {
    const path = join(workspace, 'config.override.yaml')
    await writeFile(path, 'agent:\n  baseUrl: https://override.example.com/v1/messages\n', 'utf-8')

    expect(readConfigOverrideFileSync(path)).toEqual({
      agent: { baseUrl: 'https://override.example.com/v1/messages' },
    })
  })

  it('格式坏了就报覆盖层读取失败', async () => {
    const path = join(workspace, 'config.override.yaml')
    await writeFile(path, 'agent:\n  baseUrl: "没有收尾的引号\n', 'utf-8')

    expect(catchCode(() => readConfigOverrideFileSync(path))).toBe(ResponseCode.ConfigOverrideReadFailed)
  })

  it('根节点不是对象也算读取失败', async () => {
    const path = join(workspace, 'config.override.yaml')
    await writeFile(path, '- 1\n- 2\n', 'utf-8')

    expect(catchCode(() => readConfigOverrideFileSync(path))).toBe(ResponseCode.ConfigOverrideReadFailed)
  })

  it('扩展名不认识就拒绝', async () => {
    const path = join(workspace, 'config.override.txt')
    await writeFile(path, 'x: 1\n', 'utf-8')

    expect(catchCode(() => readConfigOverrideFileSync(path))).toBe(ResponseCode.ConfigOverrideUnsupportedFormat)
  })
})
