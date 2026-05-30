import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

@Injectable()
export class AmbassadorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const user = context.switchToHttp().getRequest().user;
    if (user?.role === 'AMBASSADOR' || user?.role === 'ADMIN') return true;
    throw new ForbiddenException('Accès réservé aux ambassadeurs');
  }
}