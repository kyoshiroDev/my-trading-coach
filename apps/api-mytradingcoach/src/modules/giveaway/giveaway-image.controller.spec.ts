import { NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { PublicGiveawayController } from './giveaway.controller';

/** Route publique du visuel Instagram (lot C) : câblage @Public, 404, en-têtes de la réponse. */
describe('PublicGiveawayController · visuel Instagram', () => {
  const instagram = { image: vi.fn() };
  const controller = new PublicGiveawayController({} as never, instagram as never);
  const res = () => {
    const headers: Record<string, string> = {};
    return { headers, setHeader: vi.fn((k: string, v: string) => { headers[k] = v; }), end: vi.fn() };
  };

  it('route publique (pas de JWT : Metricool la lit)', () => {
    expect(new Reflector().get(IS_PUBLIC_KEY, PublicGiveawayController.prototype.image)).toBe(true);
  });

  it('jeton inconnu ou expiré : 404, rien envoyé', async () => {
    instagram.image.mockResolvedValueOnce(null);
    const r = res();
    await expect(controller.image('a'.repeat(48) + '.png', r as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(r.end).not.toHaveBeenCalled();
  });

  it('jeton valide : PNG, CORP cross-origin sur cette réponse seule, extension retirée', async () => {
    const png = Buffer.from('png');
    instagram.image.mockResolvedValueOnce(png);
    const r = res();
    await controller.image('b'.repeat(48) + '.png', r as never);
    expect(instagram.image).toHaveBeenLastCalledWith('b'.repeat(48));
    expect(r.headers['Content-Type']).toBe('image/png');
    expect(r.headers['Cross-Origin-Resource-Policy']).toBe('cross-origin');
    expect(r.end).toHaveBeenCalledWith(png);
  });
});
