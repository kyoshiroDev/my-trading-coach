import 'reflect-metadata';
import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EcoCalendarController } from './eco-calendar.controller';

describe('EcoCalendarController', () => {
  describe('GET range (S1 #1045)', () => {
    const service = { getEventsRange: vi.fn().mockResolvedValue([]) };
    const controller = new EcoCalendarController(service as never);

    it('plage démesurée : 400, rien n’est lu ni demandé à FMP', async () => {
      service.getEventsRange.mockClear();
      await expect(controller.getRange('1990-01-01', '2100-01-01')).rejects.toBeInstanceOf(BadRequestException);
      expect(service.getEventsRange).not.toHaveBeenCalled();
    });

    it('bornes manquantes ou illisibles : 400', async () => {
      await expect(controller.getRange(undefined as never, '2026-11-20')).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.getRange('abc', '2026-11-20')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('semaine de l’app (lundi → vendredi) : les 5 jours transmis au service', async () => {
      service.getEventsRange.mockClear();
      await controller.getRange('2026-11-16', '2026-11-20');
      expect(service.getEventsRange).toHaveBeenCalledWith([
        '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20',
      ]);
    });
  });

  describe('@Throttle des routes qui déclenchent l’IA mutualisée (S2 #1045)', () => {
    it('refresh-today : 5 par minute', () => {
      const handler = EcoCalendarController.prototype.refreshToday;
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(5);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    });

    it('analyze-result : 20 par minute', () => {
      const handler = EcoCalendarController.prototype.analyzeResult;
      expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(20);
      expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    });
  });
});
