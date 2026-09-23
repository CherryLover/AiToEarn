# skills API

## 模块边界

自定义 AI 技能的增删查。**技能是文件不是记录**：内容就是一份 Markdown，Agent 运行时按文件读，
存在服务器的挂载目录里（`$DATA_DIR/skills` → 容器内 `/data/skills`），重新部署不丢。
契约见 `docs/rebuild/contract-custom-skills.md`。

接口前缀是 `ai/` 而不是别的：nginx 把 `/api/ai/` 路由到 `aitoearn-ai` 服务，
技能文件也挂在那个容器里。**改前缀等于把请求打到一个没有这些文件的服务上。**

## 文件清单

- `skill.api.ts`
- `skill.types.ts`
- `skill.constants.ts`

## 接口清单

| 方法 | 请求 | 说明 |
| --- | --- | --- |
| `deleteSkillApi` | `DELETE ai/skills/{name}` | 删一个自定义技能。内置的删不掉，服务端拒绝。 |
| `getSkillListApi` | `GET ai/skills` | 列出全部技能，内置的和自定义的一起返回。 |
| `uploadSkillApi` | `POST ai/skills` | 传一个 Markdown，`multipart/form-data`，字段名 `file`。 |

## 类型清单

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `Skill` | `interface` | 一个技能，`builtin` 区分来源。 |
| `SkillList` | `interface` | 列表响应。 |
| `UploadSkillParams` | `interface` | 上传参数，带 `overwrite`。 |

## 常量清单

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `MAX_SKILL_FILE_BYTES` | `number` | 单文件上限，和服务端一致。 |
| `SKILL_ERROR_CODE` | `object` | 技能业务错误码（20900 段）。 |

## 维护规则

- **技能名以文件 frontmatter 里的 `name` 为准，不看文件名。** 服务端拿校验过的 `name` 重新拼落盘路径，
  这是挡路径穿越的那一道，前端不要自作主张传目录名。
- 上传的技能**对整个部署里所有人生效**，不按用户隔离。界面上必须把这句话摆明。
- 重名默认不覆盖：服务端返回 `AlreadyExists`（20905），前端扣住文件问一句，人点了才带 `overwrite` 再传。
- 错误码与服务端契约一一对应，改动必须两端同步。
- 通用规则见 `src/api/README.md`。
