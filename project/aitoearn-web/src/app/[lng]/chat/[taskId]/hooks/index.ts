/**
 * Chat 页面自定义 Hooks 导出
 * 实现已提升到 `@/components/Chat/hooks`（项目详情页的对话面板同样要用），
 * 这里只保留原来的入口，页面里的 import 不用动。
 */
export {
  type IChatStateOptions,
  type IChatStateReturn,
  type IScrollControlOptions,
  type IScrollControlReturn,
  type ITaskPollingOptions,
  type ITaskPollingReturn,
  useChatState,
  useScrollControl,
  useTaskPolling,
} from '@/components/Chat/hooks'
