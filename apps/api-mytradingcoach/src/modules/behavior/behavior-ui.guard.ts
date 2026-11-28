import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { behaviorAlertsUiEnabled } from './behavior-flags';

/** Routes d'affichage des alertes (#671) : 404 tant que `BEHAVIOR_ALERTS_UI` n'est pas allumé. */
@Injectable()
export class BehaviorUiGuard implements CanActivate {
  canActivate(): boolean {
    if (!behaviorAlertsUiEnabled()) throw new NotFoundException();
    return true;
  }
}
