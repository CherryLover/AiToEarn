/**
 * ProjectScopeContext - 告诉聊天组件「这条对话是在哪个项目里跑的」
 *
 * 只有项目详情页的对话面板会提供它。通用聊天页不提供，取到的就是空，组件按老行为走。
 *
 * 用 context 而不是一路透传 props：需要它的只有工具调用那一层小组件，
 * 为了一个可选的显示口径，把 props 从 ChatMessage 一路钻到 WorkflowStepItem 不划算。
 */
'use client'

import { createContext, useContext, useMemo } from 'react'

interface ProjectScope {
  /** 项目英文名，即 Agent 的工作目录名。用来把工具调用里的绝对路径收成项目内相对路径 */
  projectName: string
}

const ProjectScopeContext = createContext<ProjectScope | null>(null)

export function ProjectScopeProvider({
  projectName,
  children,
}: {
  projectName: string
  children: React.ReactNode
}) {
  const value = useMemo(() => ({ projectName }), [projectName])
  return <ProjectScopeContext.Provider value={value}>{children}</ProjectScopeContext.Provider>
}

/** 不在项目里就是 undefined，调用方自己兜底 */
export function useProjectName(): string | undefined {
  return useContext(ProjectScopeContext)?.projectName
}
