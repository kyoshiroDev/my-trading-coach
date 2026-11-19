import { ValidationPipe } from '@nestjs/common';

/**
 * Pipe de validation global de l'API (`main.ts`), partagé avec les tests pour qu'ils valident un
 * corps exactement comme la prod : champs inconnus refusés (400), types convertis.
 * Un `@Body()` typé en ligne (`{ reason?: string }`) n'est PAS validé : son type vaut `Object` à
 * l'exécution. Toujours une classe DTO (#1069).
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}
