import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { BadRequestException, type ArgumentMetadata, type Type } from '@nestjs/common';
import { createValidationPipe } from '../../config/validation-pipe';
import { UsersController } from './users.controller';
import { AccountsController } from '../accounts/accounts.controller';

/**
 * #1069 : DELETE /users/me et DELETE /accounts/:id/archived|permanent recevaient un corps typé en
 * ligne, donc jamais validé (son type vaut `Object` à l'exécution) : mauvais types et champs inconnus
 * passaient sans bruit (la raison non textuelle était seulement ignorée par un garde du service).
 * Ici, le pipe global de la prod, appliqué au type réel du paramètre `@Body()` de chaque route.
 */
const pipe = createValidationPipe();

function bodyMeta(controller: Type<unknown>, method: string, index: number): ArgumentMetadata {
  const types = Reflect.getMetadata('design:paramtypes', controller.prototype, method) as Type<unknown>[];
  return { type: 'body', metatype: types[index], data: undefined };
}

const deleteMe = bodyMeta(UsersController, 'deleteMe', 1);
const deleteArchived = bodyMeta(AccountsController, 'deleteArchived', 2);
const purge = bodyMeta(AccountsController, 'purge', 2);

describe('Corps des routes de suppression validés (#1069)', () => {
  it('DELETE /users/me : raison non textuelle ou champ inconnu → 400', async () => {
    await expect(pipe.transform({ reason: 5 }, deleteMe)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ reason: ['a'] }, deleteMe)).rejects.toBeInstanceOf(BadRequestException);
    await expect(pipe.transform({ raison: 'x' }, deleteMe)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('DELETE /users/me : corps du front accepté (avec ou sans raison)', async () => {
    await expect(pipe.transform({ reason: 'Je ne trade plus' }, deleteMe)).resolves.toMatchObject({ reason: 'Je ne trade plus' });
    await expect(pipe.transform({}, deleteMe)).resolves.toBeDefined();
    // DELETE sans corps du tout (client hors app) : reste accepté, comme avant.
    const sansCorps = await pipe.transform(undefined, deleteMe).then(() => 'accepté', (e: Error) => e.constructor.name);
    expect(sansCorps).toBe('accepté');
  });

  it('DELETE /accounts/:id/archived et /permanent : confirm non booléen ou champ inconnu → 400', async () => {
    for (const meta of [deleteArchived, purge]) {
      await expect(pipe.transform({ confirm: 'oui' }, meta)).rejects.toBeInstanceOf(BadRequestException);
      // Pas de conversion implicite : ni « true » en texte ni 1 ne valent une confirmation.
      await expect(pipe.transform({ confirm: 'true' }, meta)).rejects.toBeInstanceOf(BadRequestException);
      await expect(pipe.transform({ confirm: 1 }, meta)).rejects.toBeInstanceOf(BadRequestException);
      await expect(pipe.transform({ confirm: true, force: true }, meta)).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('DELETE /accounts/:id/archived et /permanent : { confirm: true } accepté, confirmation absente laissée au service', async () => {
    for (const meta of [deleteArchived, purge]) {
      await expect(pipe.transform({ confirm: true }, meta)).resolves.toMatchObject({ confirm: true });
      // Le service répond 400 CONFIRMATION_REQUIRED (message existant) quand `confirm` n'est pas true.
      await expect(pipe.transform({}, meta)).resolves.toBeDefined();
    }
  });
});
