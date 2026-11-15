import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ObjectiveNoteDto } from './objective-note.dto';
import { DebriefController } from '../debrief.controller';

// Mêmes options que le ValidationPipe global (main.ts).
const errorsOf = async (body: unknown) =>
  (await validate(plainToInstance(ObjectiveNoteDto, body) as object, { whitelist: true, forbidNonWhitelisted: true }))
    .map((e) => e.property);

// C11 (#1045) : `@Body('note')` brut stockait n'importe quel type ou longueur (jusqu'à 100 ko),
// réinjecté ensuite en entier dans le prompt de chaque débrief suivant.
describe('ObjectiveNoteDto', () => {
  it('note courte, ou vide pour effacer : acceptée', async () => {
    expect(await errorsOf({ note: 'Tenu 4 jours sur 5.' })).toEqual([]);
    expect(await errorsOf({ note: '' })).toEqual([]);
  });

  it('plus de 1000 caractères, objet, nombre ou absente : refusée', async () => {
    expect(await errorsOf({ note: 'x'.repeat(1001) })).toEqual(['note']);
    expect(await errorsOf({ note: { a: 1 } })).toEqual(['note']);
    expect(await errorsOf({ note: 42 })).toEqual(['note']);
    expect(await errorsOf({})).toEqual(['note']);
  });

  it('la route PATCH …/note lit bien le corps par ce DTO', () => {
    const types = Reflect.getMetadata('design:paramtypes', DebriefController.prototype, 'addNote') as unknown[];
    expect(types).toContain(ObjectiveNoteDto);
  });
});
