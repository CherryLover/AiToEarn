import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { Injectable, PayloadTooLargeException } from '@nestjs/common'
import { AppException, ResponseCode } from '@yikart/common'
import { catchError, throwError } from 'rxjs'

/**
 * 上传超过 multer 的 `fileSize` 时，Nest 抛的是不带业务码的 413。
 * 这里把它换成 `SkillFileTooLarge`，网页按错误码就能说清楚「zip 不超过 10 MiB」。
 *
 * 必须排在 `FileInterceptor` **前面**（`@UseInterceptors(本类, FileInterceptor(...))`），才包得住它抛的错。
 */
@Injectable()
export class SkillUploadErrorInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => throwError(() =>
        error instanceof PayloadTooLargeException
          ? new AppException(ResponseCode.SkillFileTooLarge)
          : error)),
    )
  }
}
