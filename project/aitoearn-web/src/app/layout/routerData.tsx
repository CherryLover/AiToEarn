/**
 * 路由/导航数据配置
 * 包含开源版保留导航项的图标、路径、翻译键等信息。
 */

import {
  Bot,
  FolderKanban,
  History,
  Home,
  MonitorSmartphone,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Upload,
} from 'lucide-react'

export interface IRouterDataItem {
  // 导航标题
  name: string
  // 翻译键
  translationKey: string
  // 跳转链接
  path?: string
  // 图标
  icon?: React.ReactNode
  // 子导航
  children?: IRouterDataItem[]
}

export const routerData: IRouterDataItem[] = [
  {
    name: 'Content Management',
    translationKey: 'header.draftBox',
    path: '/',
    icon: <Home size={20} />,
  },
  {
    name: 'Projects',
    translationKey: 'projects',
    path: '/projects',
    icon: <FolderKanban size={20} />,
  },
  {
    name: 'AI Publish',
    translationKey: 'aiSocial',
    path: '/ai-social',
    icon: <Sparkles size={20} />,
  },
  {
    name: 'Task History',
    translationKey: 'tasksHistory',
    path: '/tasks-history',
    icon: <History size={20} />,
  },
  {
    name: 'Publish',
    translationKey: 'accounts',
    path: '/accounts',
    icon: <Upload size={20} />,
  },
  {
    name: 'Agent Assets',
    translationKey: 'header.agentAssets',
    path: '/agent-assets',
    icon: <Bot size={20} />,
  },
  {
    name: 'Devices',
    translationKey: 'devices',
    path: '/devices',
    icon: <MonitorSmartphone size={20} />,
  },
  {
    // 设置以前是个弹框，现在是独立页面，主导航里给个正经入口
    name: 'Settings',
    translationKey: 'settings',
    path: '/settings',
    icon: <Settings size={20} />,
  },
  {
    // 配置管理同理：以前是全局弹框，现在是独立页面，入口放在设置旁边
    name: 'Config Management',
    translationKey: 'configManagement',
    path: '/config',
    icon: <SlidersHorizontal size={20} />,
  },
]

export const visibleRouterData = routerData
