/**
 * usePlatParamsCommon - 平台参数通用 Hook
 */
import type {
  IChangeParams,
  IPubParmasTextareaProps,
} from '@/components/PublishDialog/compoents/PubParmasTextarea'
import type { PubItem } from '@/components/PublishDialog/publishDialog.type'
import { Info } from 'lucide-react'
import { useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PubParamsVerifyInfo } from '@/components/PublishDialog/hooks/usePubParamsVerify'
import { usePublishDialog } from '@/components/PublishDialog/usePublishDialog'
import { parseTopicString } from '@/utils/common'

export default function usePlatParamsCommon(
  pubItem: PubItem,
  isMobile?: boolean,
) {
  const { setOnePubParams, errParamsMap, pubListChoosed, warningParamsMap } = usePublishDialog(
    useShallow(state => ({
      setOnePubParams: state.setOnePubParams,
      step: state.step,
      errParamsMap: state.errParamsMap,
      pubListChoosed: state.pubListChoosed,
      warningParamsMap: state.warningParamsMap,
    })),
  )

  // 当前组件的错误消息
  const currErrItem = useMemo(() => {
    return errParamsMap?.get(pubItem.account.id)
  }, [errParamsMap, pubItem, pubListChoosed])

  // 当前组件的警告消息
  const currWarningItem = useMemo(() => {
    return warningParamsMap?.get(pubItem.account.id)
  }, [warningParamsMap, pubItem, pubListChoosed])

  const onChange = useCallback(
    (values: IChangeParams) => {
      const { topics } = parseTopicString(values.value || '')
      setOnePubParams(
        {
          images: values.imgs,
          des: values.value,
          video: values.video,
          topics,
        },
        pubItem.account.id,
      )
    },
    [pubItem, setOnePubParams],
  )

  const pubParmasTextareaCommonParams = useMemo(() => {
    const props: IPubParmasTextareaProps = {
      platType: pubItem.account.type,
      onChange,
      desValue: pubItem.params.des,
      imageFileListValue: pubItem.params.images,
      videoFileValue: pubItem.params.video,
      isMobile,
      beforeExtend: (
        <>
          <PubParamsVerifyInfo errItem={currErrItem} />
        </>
      ),
      centerExtend: currWarningItem && (
        // 跟同一个发布对话框里的 ErrorSummary 一套告警口径，别一个主题变量一个写死 amber。
        // 图标 5.17:1（亮）/ 6.60:1（暗），正文 4.91:1 / 5.26:1。
        <div className="flex items-start gap-2 px-3 py-2.5 bg-warning/10 border-t border-warning/30">
          <Info className="h-4 w-4 text-warning-text shrink-0 mt-0.5" />
          <span className="text-xs text-muted-foreground leading-relaxed">
            {currWarningItem?.parErrMsg}
          </span>
        </div>
      ),
    }
    return props
  }, [currErrItem, onChange, pubItem, currWarningItem, isMobile])

  return { pubParmasTextareaCommonParams, setOnePubParams }
}
