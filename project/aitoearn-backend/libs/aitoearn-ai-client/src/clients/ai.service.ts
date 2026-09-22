import { Injectable } from '@nestjs/common'
import { AxiosRequestConfig } from 'axios'
import {
  CreateDraftGenerationResponse,
  CreateDraftV2Request,
  CreateImageTextDraftRequest,
  DraftGenerationTaskResponse,
  GetDraftTaskRequest,
  ReadinessResponse,
} from '../interfaces'
import { BaseService } from './base.service'

/**
 * 就绪检查这一发单独压短超时：ai 那边探上游最多 5 秒，
 * 再留一点网络余量就够了，不能让它占满 BaseService 默认的 30 秒。
 */
const READINESS_TIMEOUT_MS = 8000

@Injectable()
export class AiService extends BaseService {
  async createDraftV2(data: CreateDraftV2Request): Promise<CreateDraftGenerationResponse> {
    const url = `/internal/ai/draft-generation/v2`
    const config: AxiosRequestConfig = {
      method: 'POST',
      data,
    }
    return this.request<CreateDraftGenerationResponse>(url, config)
  }

  async createImageTextDraft(data: CreateImageTextDraftRequest): Promise<CreateDraftGenerationResponse> {
    const url = `/internal/ai/draft-generation/image-text`
    const config: AxiosRequestConfig = {
      method: 'POST',
      data,
    }
    return this.request<CreateDraftGenerationResponse>(url, config)
  }

  async getDraftTask(data: GetDraftTaskRequest): Promise<DraftGenerationTaskResponse> {
    const url = `/internal/ai/draft-generation/task`
    const config: AxiosRequestConfig = {
      method: 'POST',
      data,
    }
    return this.request<DraftGenerationTaskResponse>(url, config)
  }

  /**
   * 就绪检查：ai 侧能判的项（agent 上游真探一次、对话模型清单）。
   *
   * ai 那边探不通也回 200，失败写在每一项的 `status` 里；
   * 只有 ai 服务本身连不上才会抛错，**调用方必须自己接住**——
   * 就绪检查不许影响任何主流程（contract-runtime-config 4.1）。
   */
  async getReadiness(): Promise<ReadinessResponse> {
    const url = `/internal/readiness`
    const config: AxiosRequestConfig = {
      method: 'GET',
      timeout: READINESS_TIMEOUT_MS,
    }
    return this.request<ReadinessResponse>(url, config)
  }
}
