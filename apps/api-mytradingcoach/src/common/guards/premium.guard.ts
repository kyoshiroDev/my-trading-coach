import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';

@Injectable()
export class PremiumGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    if (!user || user.plan !== Plan.PREMIUM) {
      throw new ForbiddenException('Cette fonctionnalité nécessite un abonnement Premium');
    }
    return true;
  }
}
