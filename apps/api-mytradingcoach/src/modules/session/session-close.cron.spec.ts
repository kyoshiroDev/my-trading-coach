import { describe, it, expect, vi } from 'vitest';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { SessionCloseCron } from './session-close.cron';
import type { SessionService } from './session.service';

describe('SessionCloseCron (#595)', () => {
  it('tourne à la bascule CME : 17:05 heure de Chicago', () => {
    const opts = Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, SessionCloseCron.prototype.closeStaleSessions);
    expect(opts).toMatchObject({ cronTime: '5 17 * * *', timeZone: 'America/Chicago' });
  });

  it('délègue la clôture au service', async () => {
    const sessions = { closeStaleSessions: vi.fn().mockResolvedValue(2) };
    await new SessionCloseCron(sessions as unknown as SessionService).closeStaleSessions();
    expect(sessions.closeStaleSessions).toHaveBeenCalledTimes(1);
  });
});
