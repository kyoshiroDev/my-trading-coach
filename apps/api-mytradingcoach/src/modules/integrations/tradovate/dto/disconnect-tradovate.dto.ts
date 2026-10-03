import { IsIn, IsOptional } from 'class-validator';

export class DisconnectTradovateDto {
  /**
   * `true` → supprime aussi les trades importés par Tradovate sur ce compte (BROKER_SYNC /
   * BROKER_HISTORY). Absent ou `false` : comportement historique, les trades restent.
   */
  @IsOptional()
  @IsIn(['true', 'false'])
  deleteTrades?: 'true' | 'false';
}
