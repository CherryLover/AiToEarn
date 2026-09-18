import { aitoearnAiClientConfigSchema } from '@yikart/aitoearn-ai-client'
import { aitoearnAuthConfigSchema } from '@yikart/aitoearn-auth'
import { assetsConfigSchema } from '@yikart/assets'
import { mongodbConfigSchema as channelDbConfigSchema } from '@yikart/channel-db'
import { baseConfig, createZodDto, selectConfig } from '@yikart/common'
import { mongodbConfigSchema } from '@yikart/mongodb'
import { redisConfigSchema } from '@yikart/redis'
import { redlockConfigSchema } from '@yikart/redlock'
import z from 'zod'
import { bilibiliConfigSchema } from './core/channels/platforms/bilibili/bilibili.config'
import { douyinConfigSchema } from './core/channels/platforms/douyin/douyin.config'
import { facebookConfigSchema } from './core/channels/platforms/facebook/facebook.config'
import { googleBusinessConfigSchema } from './core/channels/platforms/google-business/google-business.config'
import { instagramConfigSchema } from './core/channels/platforms/instagram/instagram.config'
import { kwaiConfigSchema } from './core/channels/platforms/kwai/kwai.config'
import { linkedinConfigSchema } from './core/channels/platforms/linkedin/linkedin.config'
import { pinterestConfigSchema } from './core/channels/platforms/pinterest/pinterest.config'
import { rednoteConfigSchema } from './core/channels/platforms/rednote/rednote.config'
import { threadsConfigSchema } from './core/channels/platforms/threads/threads.config'
import { tiktokConfigSchema } from './core/channels/platforms/tiktok/tiktok.config'
import { twitterConfigSchema } from './core/channels/platforms/twitter/twitter.config'
import { wechatConfigSchema } from './core/channels/platforms/wechat/wechat.config'
import { youtubeConfigSchema } from './core/channels/platforms/youtube/youtube.config'
import { notifyConfigSchema } from './core/notify/notify.config'

const httpUrlSchema = z.url({ protocol: /^https?$/ })

export const relayConfigSchema = z.object({
  serverUrl: httpUrlSchema.describe('中转服务器地址'),
  apiKey: z.string().describe('用户 API Key'),
  callbackUrl: httpUrlSchema.describe('OAuth 回调完整地址，如 http://localhost:3000/api/v2/channels/relay/callback'),
})

export const oidcLoginConfigSchema = z.object({
  issuer: httpUrlSchema.describe('OIDC 签发方地址，如 https://id.flyooo.uk'),
  clientId: z.string().min(1).describe('OIDC 客户端 ID'),
  clientSecret: z.string().default('').describe('OIDC 客户端密钥，公共客户端留空'),
  redirectUri: httpUrlSchema.describe('回调完整地址，如 https://pub.flyooo.uk/api/auth/oidc/callback'),
  webBaseUrl: httpUrlSchema.describe('网页地址，登录后跳回这里，如 https://pub.flyooo.uk'),
  allowedEmails: z.array(z.string()).default([]).describe('允许登录的邮箱，不在名单里的一律拒绝'),
  scopes: z.string().default('openid email profile'),
  tokenExpiresIn: z.string().default('30d').describe('签发的登录凭证有效期'),
})

export const apiKeyConfigSchema = z.object({
  prefix: z.string().min(1).default('ai_'),
}).default({ prefix: 'ai_' })

export const projectsConfigSchema = z.object({
  root: z.string().default('/data/projects').describe('项目物料根目录（容器内路径）'),
}).default({ root: '/data/projects' })

export const deviceConfigSchema = z.object({
  heartbeatSeconds: z.number().int().positive().default(30).describe('设备心跳间隔（秒），lastSeenAt 在 3 倍间隔内算在线'),
  pairingCodeTtlSeconds: z.number().int().positive().default(600).describe('配对码有效期（秒）'),
}).default({ heartbeatSeconds: 30, pairingCodeTtlSeconds: 600 })

export const executionTaskConfigSchema = z.object({
  leaseSeconds: z.number().int().positive().default(300).describe('执行工单租约时长（秒），超时未续租会被回收重排'),
  maxAttempts: z.number().int().positive().default(3).describe('执行工单最大尝试次数，超过后转失败'),
}).default({ leaseSeconds: 300, maxAttempts: 3 })

export const channelConfigSchema = z.object({
  channelDb: channelDbConfigSchema,
  shortLink: z.object({
    baseUrl: z.string().default(''),
  }),
  bilibili: bilibiliConfigSchema.optional(),
  douyin: douyinConfigSchema.optional(),
  facebook: facebookConfigSchema.optional(),
  kwai: kwaiConfigSchema.optional(),
  instagram: instagramConfigSchema.optional(),
  linkedin: linkedinConfigSchema.optional(),
  googleBusiness: googleBusinessConfigSchema.optional(),
  pinterest: pinterestConfigSchema.optional(),
  rednote: rednoteConfigSchema.optional(),
  threads: threadsConfigSchema.optional(),
  tiktok: tiktokConfigSchema.optional(),
  twitter: twitterConfigSchema.optional(),
  wechat: wechatConfigSchema.optional(),
  youtube: youtubeConfigSchema.optional(),
})

export const appConfigSchema = z.object({
  ...baseConfig.shape,
  environment: z.enum(['development', 'production']).default('development'),
  auth: aitoearnAuthConfigSchema,
  apiKey: apiKeyConfigSchema,
  projects: projectsConfigSchema,
  device: deviceConfigSchema,
  executionTask: executionTaskConfigSchema,
  notify: notifyConfigSchema,
  redis: redisConfigSchema,
  mongodb: mongodbConfigSchema,
  redlock: redlockConfigSchema,
  assets: assetsConfigSchema,
  aiClient: aitoearnAiClientConfigSchema,
  channel: channelConfigSchema,
  relay: relayConfigSchema.optional(),
  oidcLogin: oidcLoginConfigSchema.optional(),
})

export class AppConfig extends createZodDto(appConfigSchema) { }

export const config = selectConfig(AppConfig)
