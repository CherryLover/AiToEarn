/**
 * 关闭弹窗确认 Hook
 * 统一处理发布弹窗关闭前的确认逻辑
 */

import { AlertCircle } from 'lucide-react'
import { useCallback } from 'react'
import { confirm } from '@/utils/ui/confirm'

interface UseCloseDialogParams {
  onClose: () => void
  t: (key: string, params?: Record<string, string>) => string
}

/**
 * 关闭弹窗确认 Hook
 */
export function useCloseDialog({ onClose, t }: UseCloseDialogParams) {
  /**
   * 关闭弹框确认
   * 弹出确认框，确认后关闭弹窗
   */
  const closeDialog = useCallback(() => {
    confirm({
      title: t('confirmClose.title'),
      // 这是关闭确认弹窗里唯一的图标，不是装饰：写死 text-yellow-500 压在弹窗底上
      // 亮色只有 1.84:1，图标门槛 3:1。换 text-warning-text 后 5.52:1（亮）/ 8.70:1（暗），
      // 和 RecordCore 取消发布那个确认框一套。
      icon: <AlertCircle className="h-5 w-5 text-warning-text" />,
      content: t('confirmClose.content'),
      okType: 'destructive',
      centered: true,
      cancelText: t('buttons.cancel'),
      onOk() {
        onClose()
      },
    })
  }, [onClose, t])

  return {
    closeDialog,
  }
}
