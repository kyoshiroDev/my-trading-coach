import { ArrayMaxSize, ArrayMinSize, IsArray, IsString, MaxLength } from 'class-validator';

/** Réaffecte un lot de trades (ex. une journée) à un autre compte du même user. */
export class ReassignTradesDto {
  @IsArray()
  @ArrayMinSize(1, { message: 'Aucun trade à déplacer.' })
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  tradeIds!: string[];

  @IsString()
  @MaxLength(40)
  accountId!: string;
}
