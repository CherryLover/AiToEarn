# skills API

## 模块边界

自定义 AI 技能的增删查。**技能是文件不是记录**：一个技能是一个目录，入口是 `SKILL.md`，
可以带 `references/`、`scripts/` 等子目录。Agent 运行时按文件读，
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
| `deleteSkillApi` | `DELETE ai/skills/{name}` | 删一个自定义技能（整个目录）。内置的删不掉，服务端拒绝。 |
| `getSkillListApi` | `GET ai/skills` | 列出全部技能，内置的和自定义的一起返回，每个都带 `files`。 |
| `uploadSkillApi` | `POST ai/skills` | 传一个 `.zip` 技能包或单个 `.md`，`multipart/form-data`，字段名 `file`，覆盖时另带 `overwrite=true`。 |

## 类型清单

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `Skill` | `interface` | 一个技能，`builtin` 区分来源，`files` 是技能目录下的全部文件。 |
| `SkillList` | `interface` | 列表响应。 |
| `UploadSkillParams` | `interface` | 上传参数，带 `overwrite`。 |

## 常量清单

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `MAX_SKILL_ARCHIVE_BYTES` | `number` | zip 技能包上限（10 MiB），和服务端一致。 |
| `MAX_SKILL_FILE_BYTES` | `number` | 单个 Markdown 上限（64 KiB），单独传 `.md` 和包里的 `SKILL.md` 都按它判。 |
| `SKILL_ERROR_CODE` | `object` | 技能业务错误码（20900 段，20900–20911）。 |

## 维护规则

- **zip 技能包是主格式，单个 `.md` 是简便写法。** `SKILL.md` 必须在压缩包根目录，或者唯一的那个顶层文件夹里；
  有多个顶层文件夹、找不到入口都回 `EntryMissing`（20911）。单独传 `.md` 等于一个只有 `SKILL.md` 的技能包。
- **技能名以 `SKILL.md` frontmatter 里的 `name` 为准，不看压缩包名、文件夹名和文件名。** 服务端拿校验过的 `name`
  重新拼落盘路径，这是挡路径穿越的那一道，前端不要自作主张传目录名。
- **`files` 只用来展示结构。** 它是技能根目录下所有文件的相对路径：posix 分隔、服务端已排序、包含 `SKILL.md`、
  最多 500 条，内置和自定义都有。不要拿它拼请求路径，也不要据此推断技能能不能用。
- **`scripts/` 里的脚本只保存、不执行。** AI 能读到内容，但目前没有执行命令的能力，界面上要把这句话写明，
  别让人以为传了脚本 AI 就会跑。
- 上限：zip ≤ 10 MiB、`.md` ≤ 64 KiB 前端先挡一道；解压后总量 ≤ 30 MiB、≤ 500 个文件、包内单文件 ≤ 10 MiB
  只有服务端能判（`ArchiveTooLarge`，20910）。**改上限要两端和各语言文案一起改**，文案里写的是具体数字。
- 上传的技能**对整个部署里所有人生效**，不按用户隔离。界面上必须把这句话摆明。
- 重名默认不覆盖：服务端返回 `AlreadyExists`（20905），前端扣住文件问一句，人点了才带 `overwrite` 再传。
  覆盖是**整个目录替换**，旧包里有、新包里没有的文件不会留下。
- 错误码与服务端契约一一对应，改动必须两端同步。
- 通用规则见 `src/api/README.md`。
