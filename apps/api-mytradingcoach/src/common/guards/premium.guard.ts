import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';

@Injectable()
export class PremiumGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException({ code: 'PREMIUM_REQUIRED', trialAvailable: true });
    }

    const isAdmin = user.role === Role.ADMIN;
    const isBetaTester = user.role === Role.BETA_TESTER;
    const isPremium = user.plan === Plan.PREMIUM;
    const isInTrial = user.trialEndsAt && new Date() < new Date(user.trialEndsAt);

    if (isAdmin || isBetaTester || isPremium || isInTrial) return true;

    throw new ForbiddenException({
      code: 'PREMIUM_REQUIRED',
      trialAvailable: !user.trialUsed,
    });
  }
}
