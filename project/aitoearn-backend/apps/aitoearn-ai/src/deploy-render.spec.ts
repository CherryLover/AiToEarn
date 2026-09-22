/**
 * 部署渲染 → 后台 schema 的贯通用例。
 *
 * 线上踩过的那一次：`deploy/oci/overrides/ai.yaml` 新加了七个 `${AGENT_*}`，
 * 服务器上的 `.env` 还是旧的，而 `render_config.py` 用的是严格替换，
 * 于是部署脚本在渲染那一步甩出一个 Python KeyError 就停了——
 * 一个纯粹的「配置比仓库旧」把整套部署卡死，跟要部署的改动毫无关系。
 *
 * 所以这里盯三件事，它们各自对应一种真实后果：
 * - `.env` 比仓库旧照样渲染得出来，而且渲染出来的东西**后台能解析**（否则是容器起不来）
 * - 模板里真写错了变量名必须当场报错（悄悄渲染成空的话，几层之后变成看不懂的启动失败）
 * - 按 `.env.example` 填全之后，OpenAI 协议的中转站那套值渲染出来是对的
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { appConfigSchema } from './config'

/** 从本文件往上找到仓库根（`deploy/oci/render_config.py` 在那儿） */
function findRepoRoot(): string {
  let dir = __dirname
  while (!existsSync(join(dir, 'deploy/oci/render_config.py'))) {
    const parent = dirname(dir)
    if (parent === dir)
      throw new Error('没找到仓库根')
    dir = parent
  }
  return dir
}

const REPO_ROOT = findRepoRoot()
const RENDER = join(REPO_ROOT, 'deploy/oci/render_config.py')
const OVERRIDE = join(REPO_ROOT, 'deploy/oci/overrides/ai.yaml')
const BASE = resolve(__dirname, '../config/config.yaml')

/** 渲染需要 python3 + PyYAML。没有就整组跳过：跳过会明写在结果里，红色会淹掉真正的回归 */
function rendererAvailable(): boolean {
  try {
    execFileSync('python3', ['-c', 'import yaml'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

/** 除 AGENT_* 之外 `.env` 本来就有的那些，值随便填，这里不校验它们 */
const LEGACY_ENV: Record<string, string> = {
  DOMAIN: 'pub.example.com',
  OSS_DOMAIN: 'pub-oss.example.com',
  DATA_DIR: '/data/aitoearn',
  MONGO_PASSWORD: 'mongo-pass',
  REDIS_PASSWORD: 'redis-pass',
  JWT_SECRET: 'jwt-secret',
  INTERNAL_TOKEN: 'internal-token',
  RELAY_API_KEY: 'relay-key',
  AI_RELAY_API_KEY: 'ai-relay-key',
  OPENAI_BASE_URL: 'https://relay.example.com/v1',
  OPENAI_API_KEY: 'sk-openai',
  RUSTFS_ACCESS_KEY: 'rustfs-access',
  RUSTFS_SECRET_KEY: 'rustfs-secret',
  OIDC_ISSUER: '',
  OIDC_CLIENT_ID: '',
  OIDC_CLIENT_SECRET: '',
  OIDC_ALLOWED_EMAILS: '',
  NOTIFY_ENABLED: '',
  NOTIFY_BARK_URL: '',
  NOTIFY_BARK_KEY: '',
  NOTIFY_GROUP: '',
}

/** 这个 fork 后来才加进 `.env.example` 的那七个，正是线上缺的那一批 */
const AGENT_ENV: Record<string, string> = {
  AGENT_BASE_URL: 'https://relay.example.com/v1/chat/completions',
  AGENT_API_KEY: 'sk-agent',
  AGENT_MODELS: 'gpt-5,gpt-5-mini',
  AGENT_DEFAULT_MODEL: '',
  AGENT_BACKGROUND_MODEL: '',
  AGENT_THINK_MODEL: '',
  AGENT_TRANSFORMERS: 'none',
}

describe.skipIf(!rendererAvailable())('部署渲染出来的 ai 配置', () => {
  let workspace: string

  beforeAll(() => {
    workspace = mkdtempSync(join(tmpdir(), 'deploy-render-'))
  })

  afterAll(() => {
    rmSync(workspace, { recursive: true, force: true })
  })

  function render(env: Record<string, string>, overridePath = OVERRIDE) {
    const out = join(workspace, `${Math.random().toString(36).slice(2)}.yaml`)
    try {
      execFileSync('python3', [RENDER, BASE, overridePath, out], {
        env: { PATH: process.env.PATH ?? '', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    }
    catch (error) {
      const err = error as { stderr?: Buffer, stdout?: Buffer }
      throw new Error(`渲染失败：${err.stderr?.toString() ?? ''}${err.stdout?.toString() ?? ''}`)
    }
    return parseYaml(readFileSync(out, 'utf8'))
  }

  it('.env 比仓库旧、七个 AGENT_ 变量一个都没有时，照样渲染得出来，而且后台解析得过', () => {
    const config = render(LEGACY_ENV)

    // 关键是「部署没被拦下来」：缺的是可选配置，补不补由人决定，
    // 不该让一次无关的部署整个停摆。缺了什么由进站就绪检查去说
    const parsed = appConfigSchema.safeParse(config)
    expect(parsed.error?.issues ?? []).toEqual([])
    expect(parsed.success).toBe(true)
  })

  it('七个都填上之后，OpenAI 协议那套值原样落到 agent 段', () => {
    const config = render({ ...LEGACY_ENV, ...AGENT_ENV })

    const parsed = appConfigSchema.safeParse(config)
    expect(parsed.error?.issues ?? []).toEqual([])

    const agent = (config as { agent: Record<string, unknown> }).agent
    expect(agent.baseUrl).toBe('https://relay.example.com/v1/chat/completions')
    expect(agent.models).toEqual(['gpt-5', 'gpt-5-mini'])
    // 三个角色模型没单独指定就取清单第一个，绝不能把官方默认那几个 claude 留在这儿：
    // 留着的话后台 zod 当场判「不在清单里」，容器起不来
    expect(agent.defaultModel).toBe('gpt-5')
    expect(agent.backgroundModel).toBe('gpt-5')
    expect(agent.thinkModel).toBe('gpt-5')
    // `none` 是「明确不要 transformer，让 router 自己做 Anthropic ↔ OpenAI 互转」，
    // 和「留空沿用默认的 Anthropic 透传」是两回事
    expect(agent.transformers).toEqual([])
  })

  it('模板里的变量名两边都不认识时当场报错，不会悄悄渲染成空', () => {
    const bad = join(workspace, 'typo.yaml')
    // eslint-disable-next-line no-template-curly-in-string -- 要的就是一个写错名字的占位符
    writeFileSync(bad, readFileSync(OVERRIDE, 'utf8').replace('${AGENT_BASE_URL}', '${AGENT_BASE_URLL}'))

    expect(() => render({ ...LEGACY_ENV, ...AGENT_ENV }, bad)).toThrow(/AGENT_BASE_URLL/)
  })
})
