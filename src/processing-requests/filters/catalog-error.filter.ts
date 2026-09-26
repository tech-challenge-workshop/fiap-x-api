import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

/**
 * Shapes every HTTP error on these routes as `{ statusCode, message }`. The
 * message comes from the exception's response body, so validation errors
 * keep the messages naming each invalid field.
 */
@Catch(HttpException)
export class CatalogErrorFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception.getStatus();
    const body = exception.getResponse();
    const message: unknown =
      typeof body === 'object' && body !== null && 'message' in body
        ? body.message
        : exception.message;

    response.status(status).json({ statusCode: status, message });
  }
}
