import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Observable } from 'rxjs';

const REPLACEMENT_KEY = 'deprecatedRouteReplacement';

@Injectable()
export class DeprecatedRouteInterceptor implements NestInterceptor {
  private readonly logger = new Logger('DeprecatedRoute');

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const replacement = this.reflector.get<string>(REPLACEMENT_KEY, context.getHandler());
    const req = context.switchToHttp().getRequest<Request>();
    this.logger.warn(`Route obsolète appelée : ${req.method} ${req.path} → utiliser ${replacement}`);
    return next.handle();
  }
}

/**
 * Ancienne route gardée une version pour un déploiement front/back non simultané.
 * Chaque appel écrit un `warn` : quand les logs n'en montrent plus, supprimer la route.
 *
 *   @DeprecatedRoute('GET /admin/users/stats')
 */
export const DeprecatedRoute = (replacement: string) =>
  applyDecorators(SetMetadata(REPLACEMENT_KEY, replacement), UseInterceptors(DeprecatedRouteInterceptor));
