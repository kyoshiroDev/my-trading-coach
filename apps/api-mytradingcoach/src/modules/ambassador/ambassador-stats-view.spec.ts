/**
 * S2 (#1063) : quelle vue des stats chaque route sert. Une inversion ferait fuiter les e-mails des
 * filleuls vers l'ambassadeur sans qu'aucun test du service ne casse.
 */
import { describe, it, expect, vi } from 'vitest';
import { Role } from '@prisma/client';
import { AmbassadorController } from './ambassador.controller';
import { AdminAmbassadorsController } from '../admin/admin-ambassadors.controller';

describe('vue des stats ambassadeur par route (S2 #1063)', () => {
  const service = { getStats: vi.fn().mockResolvedValue({}) };
  const ctrl = new AmbassadorController(service as never);

  it('ambassadeur : ses propres stats, vue masquée, même s’il passe un userId', async () => {
    service.getStats.mockClear();
    await ctrl.getStats({ id: 'amb', role: Role.AMBASSADOR }, 'autre');
    expect(service.getStats).toHaveBeenCalledWith('amb', 'ambassador');
  });

  it('ADMIN sans userId : ses propres stats, vue masquée', async () => {
    service.getStats.mockClear();
    await ctrl.getStats({ id: 'adm', role: Role.ADMIN });
    expect(service.getStats).toHaveBeenCalledWith('adm', 'ambassador');
  });

  it('ADMIN avec userId : vue admin de cet ambassadeur', async () => {
    service.getStats.mockClear();
    await ctrl.getStats({ id: 'adm', role: Role.ADMIN }, 'amb');
    expect(service.getStats).toHaveBeenCalledWith('amb', 'admin');
  });

  it('GET /admin/ambassadors/:id/stats : vue admin', async () => {
    const ambassadors = { getStats: vi.fn().mockResolvedValue({}) };
    const admin = new AdminAmbassadorsController(ambassadors as never, {} as never);
    await admin.stats('amb');
    expect(ambassadors.getStats).toHaveBeenCalledWith('amb', 'admin');
  });
});
