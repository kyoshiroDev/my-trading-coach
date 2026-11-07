import { SkipThrottle } from '@nestjs/throttler';
import { IP_THROTTLER } from './email-aware-throttler.guard';

/**
 * Liveness `GET /api/health` seulement (aucune entrée-sortie) : aucun limiteur (ni la limite par
 * défaut, ni celui par IP). Une sonde d'uptime ou un contrôle de déploiement qui reçoit un 429
 * conclut à tort que l'API est tombée, et le healthcheck Docker (`wget`) la marquerait
 * « unhealthy ». `@SkipThrottle()` sans argument ne saute que le limiteur `default`. Une route
 * qui touche la base ou Redis garde une limite (voir `/health/ready`).
 */
export const SkipAllThrottlers = () => SkipThrottle({ default: true, [IP_THROTTLER]: true });
