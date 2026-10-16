import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AdminPushEvent } from '@prisma/client';
import type { AdminPushSubscriptionInput } from '@mtc/shared';

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

/** `PushSubscription.toJSON()` du navigateur : endpoint https du service push + clés. */
export class SubscribePushDto implements AdminPushSubscriptionInput {
  @IsUrl(ENDPOINT_RULES) @MaxLength(2048)
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

/** Événements coupés sur cet appareil. */
export class PushPreferencesDto extends PushEndpointDto {
  @IsArray() @ArrayMaxSize(Object.keys(AdminPushEvent).length) @IsEnum(AdminPushEvent, { each: true })
  mutedEvents!: AdminPushEvent[];
}
