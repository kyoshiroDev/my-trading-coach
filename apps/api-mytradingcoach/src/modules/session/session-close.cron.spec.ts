import { describe, it, expect, vi } from 'vitest';
import { SessionCloseCron } from './session-close.cron';
import type { SessionService } from './session.service';

describe('SessionCloseCron (#595)', () => {
  it('délègue la clôture au service', async () => {
    const sessions = { closeStaleSessions: vi.fn().mockResolvedValue(2) };
    await new SessionCloseCron(sessions as unknown as SessionService).closeStaleSessions();
    expect(sessions.closeStaleSessions).toHaveBeenCalledTimes(1);
  });
});
