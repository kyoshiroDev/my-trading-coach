import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Plan } from '@prisma/client';

@Injectable()
export class PremiumGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({ code: 'PREMIUM_REQUIRED', trialAvailable: true });
    }

    const isPremium = user.plan === Plan.PREMIUM;
    const isInTrial = user.trialEndsAt && new Date() < new Date(user.trialEndsAt);

    if (!isPremium && !isInTrial) {
      throw new ForbiddenException({
        code: 'PREMIUM_REQUIRED',
        trialAvailable: !user.trialUsed,
      });
    }

    return true;
  }
}
