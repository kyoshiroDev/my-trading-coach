import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { PrismaService } from '../../prisma/prisma.service';

const THROTTLE_MS = 60_000; // mise à jour max 1 fois / minute par user

@Injectable()
export class PresenceInterceptor implements NestInterceptor {
  private readonly lastUpdated = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<{ user?: { id?: string } }>();
    const userId = req.user?.id;

    if (userId) {
      const now = Date.now();
      const last = this.lastUpdated.get(userId) ?? 0;
      if (now - last > THROTTLE_MS) {
        this.lastUpdated.set(userId, now);
        this.prisma.user
          .update({ where: { id: userId }, data: { lastSeenAt: new Date() } })
          .catch(() => {});
      }
    }

    return next.handle();
  }
}
