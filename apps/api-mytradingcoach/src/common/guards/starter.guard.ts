import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Plan, Role } from '@prisma/client';

@Injectable()
export class StarterGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;

    if (!user) throw new ForbiddenException({ code: 'STARTER_REQUIRED', trialAvailable: true });

    if (user.role === Role.ADMIN || user.role === Role.BETA_TESTER) return true;
    if (user.trialEndsAt && new Date() < new Date(user.trialEndsAt)) return true;
    if (user.plan === Plan.STARTER || user.plan === Plan.PREMIUM) return true;

    throw new ForbiddenException({
      statusCode: 403,
      code: 'STARTER_REQUIRED',
      message: 'Cette fonctionnalité nécessite le plan Starter ou Premium.',
    });
  }
}
