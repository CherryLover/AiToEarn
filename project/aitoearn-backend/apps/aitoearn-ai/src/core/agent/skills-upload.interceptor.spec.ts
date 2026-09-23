import type { CallHandler, ExecutionContext } from '@nestjs/common'
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { firstValueFrom, of, throwError } from 'rxjs'
import { describe, expect, it } from 'vitest'
import { SkillUploadErrorInterceptor } from './skills-upload.interceptor'

const context = {} as ExecutionContext

function handlerThatThrows(error: Error): CallHandler {
  return { handle: () => throwError(() => error) }
}

describe('skillUploadErrorInterceptor', () => {
  const interceptor = new SkillUploadErrorInterceptor()

  it('multer 超限的 413 换成 SkillFileTooLarge', async () => {
    const error = await firstValueFrom(interceptor.intercept(context, handlerThatThrows(new PayloadTooLargeException('File too large'))))
      .then(() => null, (reason: unknown) => reason)

    expect(error).toBeInstanceOf(AppException)
    expect((error as AppException).code).toBe(ResponseCode.SkillFileTooLarge)
  })

  it('别的错误原样放过去', async () => {
    const original = new BadRequestException('Unexpected field')
    const error = await firstValueFrom(interceptor.intercept(context, handlerThatThrows(original)))
      .then(() => null, (reason: unknown) => reason)

    expect(error).toBe(original)
  })

  it('正常返回不动', async () => {
    const handler: CallHandler = { handle: () => of({ name: 'my-skill' }) }
    await expect(firstValueFrom(interceptor.intercept(context, handler))).resolves.toEqual({ name: 'my-skill' })
  })
})
