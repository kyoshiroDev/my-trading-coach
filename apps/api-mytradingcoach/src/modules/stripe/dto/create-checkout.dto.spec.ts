/**
 * Audit fonctionnel #993 (lot 2 #1013, B1) : un `cta` inconnu (vieille app en cache, lien `?cta=…`)
 * faisait échouer TOUT le checkout en 400 (@IsIn + forbidNonWhitelisted). Le point de clic n'est
 * qu'une mesure : une valeur inconnue est ignorée, le paiement part.
 */
import { describe, it, expect } from 'vitest';
import { ValidationPipe } from '@nestjs/common';
import { CreateCheckoutDto } from './create-checkout.dto';

// Mêmes options que main.ts.
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: object) => pipe.transform(body, { type: 'body', metatype: CreateCheckoutDto });

describe('CreateCheckoutDto — cta', () => {
  it('valeur connue : conservée', async () => {
    await expect(validate({ plan: 'premium_monthly', cta: 'autopsie' })).resolves.toMatchObject({ cta: 'autopsie' });
  });

  it('valeur inconnue : ignorée, pas de 400', async () => {
    const dto = (await validate({ plan: 'premium_monthly', cta: 'newsletter' })) as CreateCheckoutDto;
    expect(dto.cta).toBeUndefined();
  });

  it('plan invalide : toujours refusé', async () => {
    await expect(validate({ plan: 'gratuit' })).rejects.toThrow();
  });
});
