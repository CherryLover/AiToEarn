/**
 * 选模型这一步的纯函数。
 *
 * 盯的是线上那次「我明明配好了还是报错」：人在引导页把默认模型改成上游真有的
 * `gpt-5.6-luna`，保存被后台整份拒掉（`defaultModel must be included in agent.models`），
 * 于是配置里留的还是旧的 `claude-opus-4-6`——就绪检查再去探，报的错里写的是**旧模型名**，
 * 跟人刚填的对不上号，只能反复怀疑自己填错了。
 *
 * 所以这里锁死一件事：选中一个模型，清单和另外两个角色模型必须一起摆平，
 * 存进去的配置要让后台那条校验当场就能过。
 */
import { describe, expect, it } from 'vitest'
import { applyModelSelection } from './setup.utils'

const SPEC = {
  listPath: 'agent.models',
  alignPaths: ['agent.backgroundModel', 'agent.thinkModel'],
}

/** 线上那份配置的形状：仓库自带的一串 claude-*，跟用户的中转站毫无关系 */
function repoDefaults() {
  return {
    agent: {
      baseUrl: 'https://way.example.com/v1/messages',
      models: ['claude-opus-4-6', 'claude-haiku-4-5-20251001'],
      defaultModel: 'claude-opus-4-6',
      backgroundModel: 'claude-haiku-4-5-20251001',
      thinkModel: 'claude-opus-4-6',
    },
  }
}

/** 后台那条校验的等价物：三个角色模型都得在清单里 */
function rolesAreAllListed(config: Record<string, unknown>) {
  const agent = (config as { agent: Record<string, unknown> }).agent
  const models = agent.models as string[]
  return (['defaultModel', 'backgroundModel', 'thinkModel'] as const)
    .every(field => models.includes(agent[field] as string))
}

describe('applyModelSelection', () => {
  it('拉到上游清单时：换上游就等于旧清单作废，清单重写成这次真正要用的那几个', () => {
    const { config, aligned } = applyModelSelection(
      repoDefaults(),
      'agent.defaultModel',
      SPEC,
      'gpt-5.6-luna',
      ['gpt-5.6-luna', 'gpt-5-mini'],
    )

    const agent = (config as ReturnType<typeof repoDefaults>).agent
    expect(agent.defaultModel).toBe('gpt-5.6-luna')
    // 两个角色模型原来是 claude-*，新上游根本没有，只能跟着对齐
    expect(agent.backgroundModel).toBe('gpt-5.6-luna')
    expect(agent.thinkModel).toBe('gpt-5.6-luna')
    expect(agent.models).toEqual(['gpt-5.6-luna'])
    expect(aligned).toEqual(['agent.backgroundModel', 'agent.thinkModel'])
    expect(rolesAreAllListed(config)).toBe(true)
  })

  it('角色模型上游确实也有的，一个都不动——别拿「对齐」当借口改用户配好的东西', () => {
    const before = repoDefaults()
    before.agent.backgroundModel = 'gpt-5-mini'

    const { config, aligned } = applyModelSelection(
      before,
      'agent.defaultModel',
      SPEC,
      'gpt-5.6-luna',
      ['gpt-5.6-luna', 'gpt-5-mini'],
    )

    const agent = (config as ReturnType<typeof repoDefaults>).agent
    expect(agent.backgroundModel).toBe('gpt-5-mini')
    expect(agent.thinkModel).toBe('gpt-5.6-luna')
    expect(agent.models).toEqual(['gpt-5.6-luna', 'gpt-5-mini'])
    expect(aligned).toEqual(['agent.thinkModel'])
    expect(rolesAreAllListed(config)).toBe(true)
  })

  it('清单拉不到（手填）时一项都不删，只把填的这个追加进去', () => {
    const { config, aligned } = applyModelSelection(
      repoDefaults(),
      'agent.defaultModel',
      SPEC,
      'my-model',
      [],
    )

    const agent = (config as ReturnType<typeof repoDefaults>).agent
    expect(agent.defaultModel).toBe('my-model')
    expect(agent.models).toEqual(['my-model', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'])
    // 原来就在清单里的角色模型没有判据说它们错了，不动
    expect(agent.backgroundModel).toBe('claude-haiku-4-5-20251001')
    expect(agent.thinkModel).toBe('claude-opus-4-6')
    expect(aligned).toEqual([])
    expect(rolesAreAllListed(config)).toBe(true)
  })

  it('手填时，本来就不在清单里的角色模型才对齐过去——那种配置后台本来就起不来', () => {
    const before = repoDefaults()
    before.agent.thinkModel = '早就删掉的模型'

    const { config, aligned } = applyModelSelection(before, 'agent.defaultModel', SPEC, 'my-model', [])

    const agent = (config as ReturnType<typeof repoDefaults>).agent
    expect(agent.thinkModel).toBe('my-model')
    expect(aligned).toEqual(['agent.thinkModel'])
    expect(rolesAreAllListed(config)).toBe(true)
  })

  it('配置里压根没有 agent.models 时也建得出来', () => {
    const { config } = applyModelSelection({ agent: {} }, 'agent.defaultModel', SPEC, 'only-one', [])

    expect((config as ReturnType<typeof repoDefaults>).agent.models).toEqual(['only-one'])
    expect(rolesAreAllListed(config)).toBe(true)
  })

  it('不改原对象：整份配置是要提交回服务端的，就地改会让失败重试时拿到脏数据', () => {
    const before = repoDefaults()
    const snapshot = JSON.parse(JSON.stringify(before))

    applyModelSelection(before, 'agent.defaultModel', SPEC, 'gpt-5.6-luna', ['gpt-5.6-luna'])

    expect(before).toEqual(snapshot)
  })
})
