import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ActivityTrackingService } from '../../modules/activity-tracking/activity-tracking.service';

/**
 * À chaque requête authentifiée, marque l'utilisateur actif pour le jour courant
 * (1 écriture DB max / user / jour grâce à la dédup Redis du service).
 * Fire-and-forget : ne bloque pas la réponse, ne propage jamais d'erreur.
 * Les requêtes non authentifiées (login, webhooks, health…) et le compte démo
 * sont ignorés.
 */
@Injectable()
export class ActivityTrackingInterceptor implements NestInterceptor {
  constructor(private readonly activity: ActivityTrackingService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { id?: string; isDemo?: boolean } }>();
    const userId = req.user?.id;

    if (userId && !req.user?.isDemo) {
      // fire-and-forget : markActive est déjà try/catché en interne
      void this.activity.markActive(userId).catch(() => undefined);
    }

    return next.handle();
  }
}
