import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { StorageUnavailableError } from '../../storage/storage-unavailable.error';

/**
 * Shapes every HTTP error on these routes as `{ statusCode, message }`. The
 * message comes from the exception's response body, so validation errors
 * keep the messages naming each invalid field. Storage that cannot be
 * reached is a 502, like the Catalog; its error's own text is not echoed.
 */
@Catch(HttpException, StorageUnavailableError)
export class CatalogErrorFilter implements ExceptionFilter {
  catch(
    exception: HttpException | StorageUnavailableError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof StorageUnavailableError) {
      response.status(HttpStatus.BAD_GATEWAY).json({
        statusCode: HttpStatus.BAD_GATEWAY,
        message: 'Storage unavailable',
      });
      return;
    }
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message: unknown =
      typeof body === 'object' && body !== null && 'message' in body
        ? body.message
        : exception.message;

    response.status(status).json({ statusCode: status, message });
  }
}
