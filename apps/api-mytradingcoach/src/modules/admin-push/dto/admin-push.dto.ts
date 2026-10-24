import { ArrayMaxSize, IsArray, IsEnum } from 'class-validator';
import { AdminPushEvent } from '@prisma/client';
import { PushEndpointDto } from '../../push/dto/push-subscription.dto';

export { PushEndpointDto, SubscribePushDto } from '../../push/dto/push-subscription.dto';

/** Événements coupés sur cet appareil. */
export class PushPreferencesDto extends PushEndpointDto {
  @IsArray() @ArrayMaxSize(Object.keys(AdminPushEvent).length) @IsEnum(AdminPushEvent, { each: true })
  mutedEvents!: AdminPushEvent[];
}
