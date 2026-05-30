import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Role } from '@prisma/client';

@Injectable()
export class BetaGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest().user;
    const hasAccess = user?.role === Role.BETA_TESTER || user?.role === Role.ADMIN;
    if (!hasAccess) {
      throw new ForbiddenException({ code: 'BETA_ONLY' });
    }
    return true;
  }
}
