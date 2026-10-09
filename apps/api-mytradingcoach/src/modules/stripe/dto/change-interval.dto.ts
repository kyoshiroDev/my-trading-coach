import { IsIn } from 'class-validator';

/** POST /billing/interval : mensuel ↔ annuel, en gardant le tarif obtenu. */
export class ChangeIntervalDto {
  @IsIn(['month', 'year'])
  interval!: 'month' | 'year';
}
