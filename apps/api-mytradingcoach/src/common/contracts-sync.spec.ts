import { describe, it, expect } from 'vitest';
import { $Enums } from '@prisma/client';
import { CONTRACT_ENUMS } from '@mtc/shared';

/**
 * Les enums du contrat front ↔ API (@mtc/shared) sont une copie de ceux de Prisma.
 * Ce test échoue dès qu'une valeur est ajoutée, retirée ou renommée d'un seul côté.
 */
describe('contrat @mtc/shared ↔ enums Prisma', () => {
  for (const [name, values] of Object.entries(CONTRACT_ENUMS)) {
    it(`${name} identique au schéma Prisma`, () => {
      const prismaEnum = ($Enums as Record<string, Record<string, string>>)[name];
      expect(prismaEnum, `enum ${name} absent de Prisma`).toBeDefined();
      expect(Object.values(values).sort()).toEqual(Object.values(prismaEnum).sort());
    });
  }

  it('chaque enum Prisma a sa copie dans le contrat', () => {
    expect(Object.keys($Enums).sort()).toEqual(Object.keys(CONTRACT_ENUMS).sort());
  });
});
