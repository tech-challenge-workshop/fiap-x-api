import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { errors } from 'jose';
import { IS_PUBLIC_KEY } from './public.decorator';
import { TokenVerifier } from './token-verifier';
import { IdentityProviderUnavailableError } from './identity-provider-unavailable.error';

export interface AuthenticatedRequest extends Request {
  owner: string;
}

const BEARER = /^Bearer ([^\s]+)$/i;

/**
 * Global guard: every route requires a valid bearer token unless marked
 * @Public(). Authentication failures are 401; an identity provider that
 * cannot supply a needed key is 503. The token itself is never logged.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: TokenVerifier,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) {
      this.logger.warn('Authentication rejected: no bearer token');
      throw new UnauthorizedException();
    }

    try {
      request.owner = (await this.verifier.verify(token)).sub;
      return true;
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) {
        this.logger.error(`Authentication unavailable: ${error.name}`);
        throw new ServiceUnavailableException(
          'Authentication temporarily unavailable',
        );
      }
      if (error instanceof errors.JOSEError) {
        this.logger.warn(`Authentication rejected: ${error.constructor.name}`);
        throw new UnauthorizedException();
      }
      throw error;
    }
  }
}
