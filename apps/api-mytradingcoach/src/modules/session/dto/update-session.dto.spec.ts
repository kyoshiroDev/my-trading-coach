import { describe, it, expect } from 'vitest';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateSessionDto } from './update-session.dto';

// Même configuration que le pipe global de main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const meta: ArgumentMetadata = { type: 'body', metatype: UpdateSessionDto };

describe('UpdateSessionDto (PATCH /session/:id)', () => {
  it('accepte les champs modifiables', async () => {
    const out = await pipe.transform({ notes: 'RAS', moodEnd: 'FOCUSED' }, meta);
    expect(out).toEqual(expect.objectContaining({ notes: 'RAS', moodEnd: 'FOCUSED' }));
  });

  it("refuse une colonne hors liste (pas d'assignation de masse)", async () => {
    await expect(pipe.transform({ notes: 'x', userId: 'autre-user' }, meta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('refuse une humeur inconnue au lieu de laisser Prisma planter en 500', async () => {
    await expect(pipe.transform({ moodEnd: 'HAPPY_HAPPY' }, meta)).rejects.toThrow(BadRequestException);
  });
});
