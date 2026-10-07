import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PRODUCT_EVENTS, type ProductEvent } from '../product-events.const';

/** Événement produit envoyé par l'app (jamais de donnée personnelle : un nom et un écran). */
export class ProductEventDto {
  @IsIn(PRODUCT_EVENTS)
  event!: ProductEvent;

  /** Écran d'origine (1er segment de route) ou variante (`success`), minuscules et tirets. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9-]*$/)
  place?: string;
}
