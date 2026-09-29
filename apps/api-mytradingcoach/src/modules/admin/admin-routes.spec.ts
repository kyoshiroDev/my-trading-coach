import { describe, it, expect } from 'vitest';
import { PATH_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminAmbassadorsController } from './admin-ambassadors.controller';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';

/**
 * API-20 : toutes les routes admin vivent sous /admin, protégées AU NIVEAU DE LA CLASSE.
 * Une route ajoutée plus tard dans ces contrôleurs est donc protégée sans y penser.
 */
const CONTROLLERS = [AdminController, AdminUsersController, AdminAmbassadorsController];

describe('Contrôleurs admin — préfixe et guards', () => {
  it.each(CONTROLLERS)('%o : préfixe /admin', (ctrl) => {
    const path = Reflect.getMetadata(PATH_METADATA, ctrl) as string;
    expect(path === 'admin' || path.startsWith('admin/')).toBe(true);
  });

  it.each(CONTROLLERS)('%o : JwtAuthGuard puis AdminGuard sur la classe', (ctrl) => {
    const guards = (Reflect.getMetadata('__guards__', ctrl) ?? []) as unknown[];
    expect(guards).toEqual([JwtAuthGuard, AdminGuard]);
  });

  it('les routes littérales de /admin/users sont déclarées avant /:id', () => {
    const proto = AdminUsersController.prototype as unknown as Record<string, unknown>;
    const paths = Object.getOwnPropertyNames(proto)
      .filter((k) => k !== 'constructor')
      .map((k) => Reflect.getMetadata(PATH_METADATA, proto[k] as object) as string);
    const firstParam = paths.findIndex((p) => p.startsWith(':'));
    for (const literal of ['stats', 'online', 'subscriptions']) {
      expect(paths.indexOf(literal)).toBeGreaterThan(-1);
      expect(paths.indexOf(literal)).toBeLessThan(firstParam);
    }
  });
});
