/** 自定义技能相关常量，与服务端契约一一对应（contract-custom-skills.md） */

/**
 * 单个 Markdown 的上限，和服务端 MAX_SKILL_FILE_BYTES 一致。
 * 单独传 `.md` 按这个判；zip 包里的 SKILL.md 服务端也按这个判（同样回 20903）。
 */
export const MAX_SKILL_FILE_BYTES = 64 * 1024

/**
 * zip 技能包本身的上限，和服务端一致。
 * 解压后的总量（30 MiB）、文件数（500）、包内单文件（10 MiB）只有服务端能判，
 * 前端不设常量，只在文案里说明；超了服务端回 `ArchiveTooLarge`。
 */
export const MAX_SKILL_ARCHIVE_BYTES = 10 * 1024 * 1024

/** 技能业务错误码，20900 段 */
export const SKILL_ERROR_CODE = {
  NameInvalid: 20900,
  NameReserved: 20901,
  FrontmatterMissing: 20902,
  FileTooLarge: 20903,
  FileInvalid: 20904,
  AlreadyExists: 20905,
  NotFound: 20906,
  BuiltinReadonly: 20907,
  StorageUnavailable: 20908,
  /** 压缩包坏了，或含越界 / 不安全路径、软链 */
  ArchiveInvalid: 20909,
  /** 解压总量、文件数或包内单文件超限 */
  ArchiveTooLarge: 20910,
  /** 根目录或唯一顶层文件夹里找不到 SKILL.md（有多个顶层文件夹也算） */
  EntryMissing: 20911,
} as const
