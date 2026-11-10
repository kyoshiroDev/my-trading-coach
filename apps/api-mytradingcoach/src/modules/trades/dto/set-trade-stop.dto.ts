import { IsNumber, IsOptional, Min, ValidateIf } from 'class-validator';
import type { SetTradeStopRequest } from '@mtc/shared';

/**
 * Corps de PATCH /trades/:id/stop (saisie rapide du stop initial depuis le Journal). Le côté du stop
 * par rapport à l'entrée est vérifié dans le service (il dépend du trade), pas ici.
 */
export class SetTradeStopDto implements SetTradeStopRequest {
  @IsNumber()
  @Min(0)
  stopLoss!: number;

  /** Absent = objectif inchangé ; `null` = objectif retiré. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  takeProfit?: number | null;
}
