import { describe, it, expect, vi } from 'vitest';
import { AdminUsersController } from './admin-users.controller';

// S6 (#1063) : « retirer bêta » passe par removeBetaRole (409 hors BETA_TESTER), plus par setRole(USER)
// qui retirait le code d'un AMBASSADOR.
describe('DELETE /admin/users/:id/beta (S6 #1063)', () => {
  it('appelle removeBetaRole, jamais setRole', async () => {
    const usersService = { removeBetaRole: vi.fn().mockResolvedValue(undefined), setRole: vi.fn() };
    const ctrl = new AdminUsersController(usersService as never);
    await expect(ctrl.removeBetaRole('u1')).resolves.toEqual({ id: 'u1', role: 'USER' });
    expect(usersService.removeBetaRole).toHaveBeenCalledWith('u1');
    expect(usersService.setRole).not.toHaveBeenCalled();
  });
});
