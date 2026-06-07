import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DEMO_ALLOWED_KEY } from '../decorators/demo-allowed.decorator';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Lecture seule pour le compte démo. Si l'utilisateur courant a isDemo = true,
 * toute mutation (POST/PUT/PATCH/DELETE) est refusée (403 douce), sauf les routes
 * explicitement marquées @DemoAllowed(). Les lectures (GET) passent toujours.
 *
 * À enregistrer en APP_GUARD APRÈS JwtAuthGuard (besoin de request.user peuplé).
 * Sécurité par défaut « tout bloqué sauf GET » → une nouvelle mutation est
 * protégée sans intervention.
 */
@Injectable()
export class DemoReadOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context
      .switchToHttp()
      .getRequest<{ method?: string; user?: { isDemo?: boolean } }>();

    // Pas un compte démo (ou route publique sans user) → aucune restriction.
    if (!req.user?.isDemo) return true;

    const method = (req.method ?? 'GET').toUpperCase();
    if (READ_METHODS.has(method)) return true;

    const allowed = this.reflector.getAllAndOverride<boolean>(DEMO_ALLOWED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowed) return true;

    throw new ForbiddenException('Action non disponible en mode démo');
  }
}