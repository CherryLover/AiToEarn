/**
 * Chat 共享 Hooks
 *
 * 原来住在 `app/[lng]/chat/[taskId]/hooks/`，是聊天页私有的。
 * 项目详情页的对话面板要复用同一套会话加载、断线轮询和滚动控制，
 * 按 `components/Chat/README.md` 的放置规则提上来，页面不再各写一份。
 */
export { type IChatStateOptions, type IChatStateReturn, useChatState } from './useChatState'
export {
  type IScrollControlOptions,
  type IScrollControlReturn,
  useScrollControl,
} from './useScrollControl'
export { type ITaskPollingOptions, type ITaskPollingReturn, useTaskPolling } from './useTaskPolling'
