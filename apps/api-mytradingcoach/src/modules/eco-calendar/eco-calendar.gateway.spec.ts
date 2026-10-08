import { describe, it, expect, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import type { Socket } from 'socket.io';
import { EcoCalendarGateway } from './eco-calendar.gateway';

function client(token?: unknown) {
  return { id: 's1', handshake: { auth: token === undefined ? {} : { token } }, disconnect: vi.fn() } as unknown as Socket & {
    disconnect: ReturnType<typeof vi.fn>;
  };
}

describe('EcoCalendarGateway — handshake authentifié (SCA-B6-03)', () => {
  const jwt = { verifyAsync: vi.fn(async (t: string) => { if (t !== 'jwt-ok') throw new Error('invalid'); return { sub: 'u1' }; }) };
  const gateway = new EcoCalendarGateway(jwt as unknown as JwtService);

  it('jeton valide → connexion gardée', async () => {
    const c = client('jwt-ok');
    await gateway.handleConnection(c);
    expect(c.disconnect).not.toHaveBeenCalled();
  });

  it.each([['absent', undefined], ['vide', ''], ['invalide ou expiré', 'jwt-expire'], ['pas une chaîne', 42]])(
    'jeton %s → socket refusé',
    async (_label, token) => {
      const c = client(token);
      await gateway.handleConnection(c);
      expect(c.disconnect).toHaveBeenCalledWith(true);
    },
  );
});
