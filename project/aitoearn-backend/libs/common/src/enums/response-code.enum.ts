export enum ResponseCode {
  Success = 0,

  // ========================================
  // 10000-11999: 基础设施层 (libs)
  // ========================================

  // 10000-10099: common（公共库）
  ValidationFailed = 10002,
  DevOnlyEndpoint = 10005,

  // 10100-10199: s3/aws-s3/gcs
  S3DownloadFileFailed = 10100,
  S3UploadFailed = 10101,
  InvalidGcsUri = 10102,

  // 10150-10199: config-editor（配置编辑）
  ConfigEditorUnsupportedFormat = 10150,
  ConfigEditorParseFailed = 10151,
  ConfigEditorValidationFailed = 10152,
  ConfigEditorReadFailed = 10153,
  ConfigEditorWriteFailed = 10154,
  ConfigEditorConfigPathMissing = 10155,
  ConfigEditorPm2Unavailable = 10156,
  ConfigEditorRestartFailed = 10157,

  // ========================================
  // 12000-12999: aitoearn-server（主服务）
  // ========================================

  // 12000-12099: user（用户模块）
  UserNotFound = 12000,
  UserStorageExceeded = 12002,
  UserStatusError = 12003,

  // 12300-12399: ai（AI 模块）
  InvalidModel = 12300,
  AiCallFailed = 12301,
  InvalidAiTaskId = 12302,
  AiLogNotFound = 12303,
  VideoUploadInvalidInput = 12304,
  VideoUploadJobIdNotFound = 12305,
  VideoUploadTaskInfoNotFound = 12306,
  VideoUploadVidNotFound = 12307,
  VideoUploadFailed = 12308,
  DraftGenerationMemoryNotFound = 12309,

  // 12600-12699: account（社交账号）
  AccountNotFound = 12600,
  AccountGroupNotFound = 12601,
  AccountStatisticsNotFound = 12602,
  AccountGroupCountryCodeInvalid = 12603,
  AccountCreateFailed = 12604,
  AccountRefreshTooFrequent = 12605,
  AccountRefreshNotSupported = 12606,

  // 12700-12799: media（媒体文件）
  MediaNotFound = 12700,
  MediaGroupNotFound = 12701,
  MediaGroupDefaultNotAllowed = 12702,

  // 12750-12799: assets（资源模块）
  AssetNotFound = 12750,
  AssetUploadFailed = 12751,
  AssetTooLarge = 12752,

  // 12800-12899: material（素材）
  MaterialNotFound = 12800,
  MaterialGroupNotFound = 12801,
  MaterialGroupDefaultNotAllowed = 12803,

  // 12900-12999: content（内容组合）
  MaterialGroupEmpty = 12900,
  MaterialGroupTypeError = 12901,
  MediaGroupTypeNotSupported = 12902,
  GroupInfoNotFound = 12903,

  // ========================================
  // 13000-13999: aitoearn-admin-server（管理后台）
  // ========================================

  // 13200-13299: admin-operation（管理后台操作）
  AdminOperationPasswordError = 13200,

  // ========================================
  // 15000-15999: aitoearn-channel（渠道服务）
  // ========================================

  // 15000-15099: channel/publish（渠道发布相关）
  PublishRecordNotFound = 15000,
  ChannelAccountNotAuthorized = 15001,
  ChannelAuthorizationExpired = 15002,
  ChannelAccountInfoFailed = 15003,
  PublishTaskNotFound = 15004,
  ChannelCredentialNotFound = 15006,
  ChannelRefreshTokenNotFound = 15007,
  ChannelRefreshTokenExpired = 15008,
  ChannelRefreshTokenFailed = 15009,
  ChannelAccessTokenFailed = 15010,
  ChannelPlatformTokenNotFound = 15011,
  ChannelAuthTaskFailed = 15012,
  ChannelAuthorizationFailed = 15013,
  ChannelNoAccountsFound = 15014,
  PublishServiceNotFound = 15015,
  PublishTaskFailed = 15016,
  PublishTaskInProgress = 15017,
  PublishTaskStatusInvalid = 15018,
  PublishTimeInvalid = 15019,
  EngagementTaskInProgress = 15020,
  ChannelAccountNotFound = 15021,
  InteractAccountTypeNotSupported = 15022,
  InteractRecordNotFound = 15023,
  DataCubeAccountTypeNotSupported = 15024,
  ChannelPublishTaskAlreadyExists = 15025,
  PublishTaskAlreadyPublishing = 15026,
  PublishTaskAlreadyCompleted = 15027,
  PublishTaskNotPublished = 15028,
  PublishTaskAlreadyUpdating = 15029,
  PublishTaskAlreadyWaitingForUpdate = 15030,
  PostCategoryNotSupported = 15031,
  PlatformNotSupported = 15032,
  PublishTaskUpdateFailed = 15033,
  DeletePostFailed = 15034,
  PublishTaskInvalid = 15035,
  // 解析链接，获取视频ID
  InvalidWorkLink = 15036,
  // 作品不属于该账号
  WorkNotBelongToAccount = 15037,
  PublishResourceUnavailable = 15038,
  ChannelAuthSessionInvalid = 15039,
  ChannelAuthPlatformMismatch = 15040,
  ChannelAuthSessionCompleted = 15041,
  ChannelAuthCsrfInvalid = 15042,
  ChannelAuthSelectableAccountsNotFound = 15043,
  ChannelAuthCodeMissing = 15045,
  ChannelAuthRefreshTokenMissing = 15046,
  ChannelAuthPlatformUidMissing = 15047,
  ChannelAuthAccountAccessRevoked = 15048,
  ChannelAuthCodeOrStateMissing = 15049,
  PublishFlowNotFound = 15050,
  ChannelPublishValidationFailed = 15051,
  ChannelPublishDuplicateItem = 15052,
  ChannelPublishQueueRemoveFailed = 15053,
  ChannelPublishPlatformCancelFailed = 15054,
  ChannelPublishCancelNotSupported = 15055,
  ChannelPublishQueueFailed = 15056,
  ChannelPublishTimeUpdateNotAllowed = 15057,
  ChannelPublishNowNotAllowed = 15058,
  ChannelPublishUpdateNotAllowed = 15059,
  ChannelPublishPlatformWorkIdMissing = 15060,
  ChannelPublishUpdateNotSupported = 15061,
  ChannelPublishPlatformNotSupported = 15062,
  ChannelPublishPlatformStatusFailed = 15063,
  ChannelWebhookNotSupported = 15064,
  ChannelWebhookChallengeNotSupported = 15065,
  ChannelWebhookInvalidSignature = 15066,
  ChannelWebhookInvalidVerifyToken = 15067,
  ChannelWebhookChallengeCodeMissing = 15068,
  ChannelWebhookPublishFailed = 15069,
  ChannelPlatformApiFailed = 15070,
  ChannelPlatformRateLimited = 15071,
  ChannelPlatformResponseInvalid = 15072,
  ChannelPlatformMediaUnsupported = 15073,
  ChannelPlatformMediaProcessingFailed = 15074,
  ChannelPlatformMediaProcessingTimeout = 15075,
  ChannelPlatformAccountMissing = 15076,
  ChannelPlatformPublishOptionMissing = 15077,
  ChannelPlatformPermissionMissing = 15078,
  ChannelPlatformWorkNotFound = 15079,
  ChannelPlatformOperationNotSupported = 15080,
  ChannelAccountCreateNotSupported = 15081,
  ChannelAccountAlreadyConnectedToAnotherUser = 15082,
  ChannelAuthSelectionRequired = 15083,
  ChannelAuthSelectedAccountUnavailable = 15084,
  ChannelOAuthIdentityAlreadyConnectedToAnotherUser = 15085,
  ChannelOAuthUserAlreadyConnectedToAnotherIdentity = 15086,
  ChannelPublishMixedRelayAndLocalAccounts = 15087,
  ChannelPaginationModeNotSupported = 15088,
  ChannelPaginationLimitExceeded = 15089,
  ChannelPaginationPageSizeExceeded = 15090,
  ChannelPaginationDirectionNotSupported = 15091,
  ChannelAccountCreateRequiredFieldMissing = 15092,
  ChannelPublishPermalinkMissing = 15093,
  ChannelPlatformServiceUnavailable = 15094,
  ChannelPublishRetryNotAllowed = 15095,

  // 15100-15199: short-link（短链接）
  ShortLinkNotFound = 15100,
  ShortLinkExpired = 15101,

  // 16000-16099: channel/work（作品辅助）
  WorkDetailNotFound = 16026, // 作品详情未找到
  AccountAuthRequired = 16037, // 该平台需要先授权账号

  // 18100-18199: agent（代理服务）
  AgentTaskNotFound = 18100,
  AgentTaskStatusInvalid = 18101,
  GenerateImagesFailed = 18102,
  GenerateVideosFailed = 18103,
  AgentTaskFailed = 18104,
  DailyTaskQuotaExceeded = 18105,
  GenerateContentFailed = 18106,
  AgentTaskTimeout = 18107,
  AgentTaskNotRunning = 18108,
  AgentSessionRecoveryFailed = 18109,

  // 18300-18399: place-draft（地点草稿）
  PlaceDraftNotFound = 18300,

  // ========================================
  // 19000-19099: api-key / relay
  // ========================================
  ApiKeyInvalid = 19000,
  RelayServerUnavailable = 19001,

  // ========================================
  // 20000-20099: projects（项目）
  // ========================================
  ProjectNotFound = 20000,
  ProjectNameInvalid = 20001, // 不符合命名规则
  ProjectNameTaken = 20002, // 已存在
  ProjectNameReserved = 20003, // 命中保留字
  ProjectDirCreateFailed = 20004, // 目录创建失败
  ProjectArchived = 20005, // 已归档，不能操作
  ProjectPathEscape = 20006, // 路径越界
  ProjectDirRenameFailed = 20007, // 目录改名失败（归档、归档回滚）

  // ========================================
  // 20100-20199: projects/files（项目物料文件）
  // ========================================
  ProjectFileNotFound = 20100, // 文件或目录不存在
  ProjectFilePathInvalid = 20101, // 路径不合法
  ProjectFileTooLarge = 20102, // 文件太大，走下载
  ProjectFileNotText = 20103, // 不是文本文件，走下载
  ProjectFileExists = 20104, // 目标已存在
  ProjectFileWriteFailed = 20105, // 写入失败
  ProjectFileIsSymlink = 20106, // 目标是软链，拒绝操作
  ProjectFileUploadFailed = 20107, // 上传失败

  // ========================================
  // 20200-20299: angles（发布方向与内容生成，阶段 2）
  // ========================================
  AngleNotFound = 20200, // 方向不存在
  AngleSlugInvalid = 20201, // slug 不符合命名规则
  AngleSlugTaken = 20202, // slug 在同项目内已被占用
  AngleSlugReserved = 20203, // slug 命中保留字
  AngleParentNotFound = 20204, // 父方向不存在
  AngleParentSelf = 20205, // 不能把自己当父方向
  AngleParentCycle = 20206, // 父子关系成环
  AngleParentProjectMismatch = 20207, // 父方向不属于同一个项目
  AngleRetired = 20208, // 方向已淘汰，不能再操作
  AngleStatusInvalid = 20209, // 状态值不合法或不允许这样流转
  AngleDepthExceeded = 20210, // 派生层级过深
  AngleHasChildren = 20211, // 名下还有子方向，不能直接删
  AngleProjectMismatch = 20212, // 方向不属于该项目
  AngleFileNotFound = 20213, // 方向指引文件缺失
  AngleFileWriteFailed = 20214, // 方向指引文件写入失败
  AngleFileRenameFailed = 20215, // 改 slug 时同步改文件名失败
  AngleFileDeleteFailed = 20216, // 方向指引文件删除失败
  AngleFileInvalid = 20217, // 方向指引文件格式不合法（frontmatter 缺失或无法解析）
  AngleExtractionFailed = 20218, // AI 提炼候选方向失败
  AngleDraftNotFound = 20219, // 草稿不存在
  AngleDraftGenerateFailed = 20220, // 按方向生成内容失败
  AngleDraftWriteFailed = 20221, // 草稿写入失败
  AngleDraftMetaInvalid = 20222, // 草稿血缘文件不合法
  AnglePlatformNotSupported = 20223, // 目标平台不支持

  // ========================================
  // 20300-20399: devices（执行端设备，阶段 3）
  // ========================================
  DevicePairingCodeInvalid = 20300, // 配对码无效或已过期
  DevicePairingCodeUsed = 20301, // 配对码已被使用
  DevicePairingCodeGenerateFailed = 20302, // 配对码生成失败
  DeviceNotFound = 20303, // 设备不存在
  DeviceTokenInvalid = 20304, // 设备令牌无效
  DeviceTokenMissing = 20305, // 请求没有携带设备令牌
  DeviceRevoked = 20306, // 设备已吊销
  DeviceOffline = 20307, // 设备不在线
  DeviceNameInvalid = 20308, // 设备名不合法
  DeviceLimitExceeded = 20309, // 设备数量超出上限
  DeviceCapabilityInvalid = 20310, // 上报的设备能力不合法
  DeviceHeartbeatInvalid = 20311, // 心跳载荷不合法
  DeviceAlreadyPaired = 20312, // 该设备已经配对过
  DeviceWsUnauthorized = 20313, // WebSocket 握手鉴权失败
  DeviceWsHelloTimeout = 20314, // 连接后未在限定时间内发送 hello
  DeviceWsMessageInvalid = 20315, // WebSocket 报文不合法

  // ========================================
  // 20400-20499: execution-tasks（执行工单，阶段 3）
  // ========================================
  ExecutionTaskNotFound = 20400, // 工单不存在
  ExecutionTaskLeaseInvalid = 20401, // 租约 id 对不上
  ExecutionTaskLeaseExpired = 20402, // 租约已过期
  ExecutionTaskStatusInvalid = 20403, // 当前状态不允许该操作
  ExecutionTaskNoneAvailable = 20404, // 没有可领取的工单
  ExecutionTaskManualNotClaimable = 20405, // 手动模式的工单不进入领取流程
  ExecutionTaskCapabilityMismatch = 20406, // 设备能力不满足工单要求
  ExecutionTaskDeviceMismatch = 20407, // 工单指定了别的设备
  ExecutionTaskAlreadyClaimed = 20408, // 工单已被其他设备领走
  ExecutionTaskNotLeasedByDevice = 20409, // 当前设备不是租约持有者
  ExecutionTaskTypeNotSupported = 20410, // 工单类型不支持
  ExecutionTaskPayloadInvalid = 20411, // 工单载荷与类型不匹配
  ExecutionTaskResultInvalid = 20412, // 回报结果不合法
  ExecutionTaskCreateFailed = 20413, // 工单创建失败
  ExecutionTaskCancelNotAllowed = 20414, // 已是终态，不能取消
  ExecutionTaskRetryNotAllowed = 20415, // 只有失败的工单可以重试
  ExecutionTaskMaxAttemptsExceeded = 20416, // 重试次数已用尽
  ExecutionTaskManualCompleteNotAllowed = 20417, // 只有手动模式的工单可以人工回填
  ExecutionTaskProjectMismatch = 20418, // 工单不属于该项目
  ExecutionTaskNoCapableDevice = 20419, // 名下没有声明了所需能力的设备，建了也只会重试到失败

  // ========================================
  // 20500-20599: publishing（发布记录与数据，阶段 4/5）
  // ========================================
  PublishedPostNotFound = 20500, // 发布记录不存在
  PublishedPostProjectMismatch = 20501, // 发布记录不属于该项目
  PublishedPostDraftPathInvalid = 20502, // 草稿路径不合法，必须是 drafts/ 下的草稿目录或草稿文件
  PublishedPostDraftNotFound = 20503, // 草稿不存在：目录版缺 content.md，或路径整个不在
  PublishedPostDraftInvalid = 20504, // 草稿格式不对：解析不了，或路径既不是文件也不是目录
  PublishedPostDraftEmpty = 20505, // 草稿标题和正文都是空的，没东西可发
  PublishedPostAutoModeNotSupported = 20506, // 没有任何一台设备会干这个平台的自动发布
  PublishedPostDuplicate = 20507, // 同一条帖子已经登记过了
  PublishedPostAlreadyCompleted = 20508, // 已经登记为发布成功，不能重复回填
  PublishedPostUrlInvalid = 20509, // 帖子链接不合法
  PublishedPostCreateFailed = 20510, // 建发布记录或执行工单失败
  PublishedPostStatusInvalid = 20511, // 当前状态不允许该操作

  // ========================================
  // 20600-20699: settings（设置页与通知配置）
  // ========================================
  SettingsNotifyUrlInvalid = 20600, // 通知地址不合法：不是合法 URL，或协议不是 http/https
  SettingsNotifyUrlBlocked = 20601, // 通知地址指向内网、回环或云元数据地址，不允许
  SettingsNotifyUrlUnresolvable = 20602, // 通知地址的域名解析不出来
  SettingsNotifyKeyRequired = 20603, // 填了地址就得填 key
  SettingsNotifyNotConfigured = 20604, // 还没配通知，先保存再测试
  SettingsNotifyRuleInvalid = 20605, // 通知规则不合法：类型不认识或同一类型给了多条
  SettingsNotifyGroupInvalid = 20606, // 通知分组不合法

  // ========================================
  // 20700-20799: 创作平台数据采集（contract-collect-xhs）
  // 20700-20709 是插件在页面上跑出来的失败，插件把码写在回报的 error 里，服务端照原样翻出来
  // ========================================
  CreatorNoteSyncEntryUrlNotAllowed = 20700, // 列表页地址不在插件的域名白名单里
  CreatorNoteSyncNotLoggedIn = 20701, // 这台机器没登录这个创作平台
  CreatorNoteSyncListNotAppeared = 20702, // 等不到作品列表出现，页面结构可能变了
  CreatorNoteSyncEmptyResult = 20703, // 一条都没读到：选择器过时，或这个账号确实没有作品
  CreatorNoteSyncScrollLimitReached = 20704, // 滚到上限还没到底，没法确认数据是全的
  CreatorNoteSyncMetricUnrecognized = 20705, // 指标图标全认不出来，按位置猜会把赞和评论对调，不猜
  CreatorNoteSyncSpecInvalid = 20706, // 采集规格不合法
  CreatorNoteSyncFailed = 20707, // 采集失败，原因看工单的 lastError
  CreatorNoteRowNotFound = 20710, // 采集数据行不存在
  CreatorNoteRowAlreadyMatched = 20711, // 这一行已经归属了，要改先取消归属
  CreatorNoteSyncNoCollectSpec = 20712, // 这个平台还没有采集规格，只有小红书有
  CreatorNoteRowAdoptFailed = 20713, // 把未归属的行建成发布记录失败

  // ========================================
  // 20800-20849: config override（运行时配置覆盖层）
  // ========================================
  ConfigOverrideProtectedKey = 20800, // 这一项只能从部署环境改，不接受运行时覆盖
  ConfigOverrideWriteFailed = 20801, // 覆盖文件写入失败
  ConfigOverrideReadFailed = 20802, // 覆盖文件读取失败：不存在不算失败，格式坏了才算
  ConfigOverrideInvalid = 20803, // 合并覆盖层之后的配置过不了 schema 校验
  ConfigOverrideUnsupportedFormat = 20804, // 覆盖文件后缀不是 yaml/yml/json

  // ========================================
  // 20850-20899: system readiness（就绪检查）
  // ========================================
  SystemReadinessProbeFailed = 20850, // 探测某一项时自己出错了（不是被探的那方的问题）
  SystemReadinessUpstreamUnreachable = 20851, // 上游连不上或拒绝

  // ========================================
  // 20900-20949: custom skills（用户自己传上来的 AI 技能）
  // ========================================
  SkillNameInvalid = 20900, // frontmatter 里的 name 不合规（目录名规则）
  SkillNameReserved = 20901, // 和内置技能重名，内置的不许被顶掉
  SkillFrontmatterMissing = 20902, // 没有 frontmatter，或者缺 name / description
  SkillFileTooLarge = 20903, // 超过单文件上限
  SkillFileInvalid = 20904, // 不是 Markdown，或者读不出内容
  SkillAlreadyExists = 20905, // 同名已存在且没勾覆盖
  SkillNotFound = 20906, // 要删的技能不存在
  SkillBuiltinReadonly = 20907, // 内置技能只能看，不能删
  SkillStorageUnavailable = 20908, // 技能目录读写失败（多半是没挂上）
}
