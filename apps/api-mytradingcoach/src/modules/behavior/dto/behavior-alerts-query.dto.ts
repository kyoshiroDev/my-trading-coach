import { Matches } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `GET /behavior/alerts?from=AAAA-MM-JJ&to=AAAA-MM-JJ` : jours inclus, 31 jours au plus (contrôlé à la route). */
export class BehaviorAlertsQueryDto {
  @Matches(DAY, { message: 'from doit être une date AAAA-MM-JJ' })
  from!: string;

  @Matches(DAY, { message: 'to doit être une date AAAA-MM-JJ' })
  to!: string;
}
