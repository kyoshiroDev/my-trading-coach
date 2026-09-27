import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { HttpExceptionFilter } from './http-exception.filter';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

function httpHost() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const request = { method: 'GET', path: '/api/trades', url: '/api/trades?token=secret' };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getResponse: () => ({ status }), getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

const prismaError = (code: string) =>
  new Prisma.PrismaClientKnownRequestError('erreur prisma', { code, clientVersion: 'test' });

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('HttpException : statut, message et code machine conservés', () => {
    const { host, status, json } = httpHost();
    filter.catch(new HttpException({ message: 'Reconnecte Tradovate', code: 'TRADOVATE_RECONNECT_REQUIRED' }, 409), host);
    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TRADOVATE_RECONNECT_REQUIRED', message: 'Reconnecte Tradovate' }));
  });

  it('erreurs de validation : liste des messages', () => {
    const { host, json } = httpHost();
    filter.catch(new BadRequestException(['email must be an email']), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400, message: ['email must be an email'] }));
  });

  it('Prisma P2002 → 409 CONFLICT', () => {
    const { host, status, json } = httpHost();
    filter.catch(prismaError('P2002'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'CONFLICT' }));
  });

  it('Prisma P2025 → 404 NOT_FOUND', () => {
    const { host, status } = httpHost();
    filter.catch(prismaError('P2025'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('erreur inattendue → 500 au même format, sans détail technique', () => {
    const { host, status, json } = httpHost();
    filter.catch(new TypeError("Cannot read properties of undefined (reading 'id')"), host);
    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0] as { code: string; message: string };
    expect(body.code).toBe('INTERNAL');
    expect(body.message).not.toContain('undefined');
  });

  it('le chemin renvoyé ne contient jamais la query string', () => {
    const { host, json } = httpHost();
    filter.catch(new BadRequestException('x'), host);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ path: '/api/trades' }));
  });

  it('remonte les 5xx à Sentry, pas les 4xx', () => {
    vi.mocked(Sentry.captureException).mockClear();
    filter.catch(new BadRequestException('x'), httpHost().host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
    const boom = new Error('boom');
    filter.catch(boom, httpHost().host);
    expect(Sentry.captureException).toHaveBeenCalledWith(boom, expect.anything());
  });
});
