import { zodToJsonSchemaOptions } from '@yikart/common'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FileContentVo, FileNodeVo } from './projects.vo'

describe('物料文件 VO', () => {
  it('目录树是递归结构，create 能一层层校验下去', () => {
    const now = new Date()
    const node = FileNodeVo.create({
      name: 'background',
      path: 'background',
      type: 'dir',
      size: null,
      updatedAt: now,
      children: [
        {
          name: 'product',
          path: 'background/product',
          type: 'dir',
          size: null,
          updatedAt: now,
          children: [
            { name: 'intro.md', path: 'background/product/intro.md', type: 'file', size: 12, updatedAt: now, children: null },
          ],
        },
      ],
    })

    expect(node.children![0]!.children![0]!.size).toBe(12)
  })

  it('递归 VO 能转成 JSON Schema —— 应用启动时生成 Swagger 文档要走这一步', () => {
    // 和 starter.ts 里的调用保持一致，递归 schema 处理不了的话这里就会炸
    const schemas = z.toJSONSchema(z.globalRegistry, { ...zodToJsonSchemaOptions, io: 'input' }).schemas

    expect(schemas.FileNodeVo).toBeDefined()
    expect(schemas.FileContentVo).toBeDefined()
  })

  it('文本内容 VO 字段齐全', () => {
    const vo = FileContentVo.create({
      path: 'CLAUDE.md',
      content: '# 四十周',
      size: 10,
      updatedAt: new Date(),
    })

    expect(vo.path).toBe('CLAUDE.md')
    expect(vo.content).toBe('# 四十周')
  })
})
