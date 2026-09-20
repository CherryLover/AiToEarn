export const pillClass
  = 'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-transparent hover:border-border'

// 写死 orange-100/orange-600 亮色下只有 3.11:1，徽章正文门槛 4.5:1。
// 换成站里统一的告警口径后 5.18:1（亮）/ 6.55:1（暗）。
export const modelTagClassName
  = 'border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-warning-text'

export const modelOptionClassName
  = 'flex w-full items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors cursor-pointer'
