import { Logger } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, IsUrl, Length, Matches, MaxLength, ValidateBy, ValidateNested } from 'class-validator';
import type { AdminPushSubscriptionInput } from '@mtc/shared';
import { pushEndpointCheck } from '../push-endpoint';

/** Abonnement Web Push du navigateur : DTO communs à l'admin (`/admin/push`) et aux traders (`/push`). */

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const ENDPOINT_RULES = { protocols: ['https'], require_protocol: true, require_tld: true };

class PushKeysDto {
  /** Clé publique ECDH P-256 de l'appareil (65 octets → ~87 caractères base64url). */
  @IsString() @Matches(BASE64URL) @Length(80, 100)
  p256dh!: string;

  /** Secret d'authentification (16 octets → ~22 caractères base64url). */
  @IsString() @Matches(BASE64URL) @Length(16, 32)
  auth!: string;
}

const logger = new Logger('PushEndpoint');

/**
 * Service push connu seulement (`push-endpoint.ts`). Un refus est journalisé avec l'hôte et la
 * raison, jamais l'adresse complète (elle contient un jeton).
 */
function IsKnownPushService(): PropertyDecorator {
  return ValidateBy({
    name: 'isKnownPushService',
    validator: {
      validate: (value: unknown) => {
        if (typeof value !== 'string') return false;
        const check = pushEndpointCheck(value);
        if (!check.ok) logger.warn(`Abonnement push refusé : ${check.reason} (${check.host})`);
        return check.ok;
      },
      defaultMessage: () => "Ce navigateur n'utilise pas un service de notifications reconnu.",
    },
  });
}

/** `PushSubscription.toJSON()` du navigateur : endpoint https d'un service push connu + clés. */
export class SubscribePushDto implements AdminPushSubscriptionInput {
  @IsUrl(ENDPOINT_RULES) @MaxLength(2048) @IsKnownPushService()
  endpoint!: string;

  /** Envoyé par certains navigateurs (souvent `null`) : accepté, ignoré. */
  @IsOptional() @IsNumber()
  expirationTime?: number | null;

  @ValidateNested() @Type(() => PushKeysDto)
  keys!: PushKeysDto;
}

/** Identifie l'appareil par son endpoint (désabonnement, lecture de l'état). */
export class PushEndpointDto {
  @IsUrl(ENDPOINT_RULES) @MaxLength(2048)
  endpoint!: string;
}
