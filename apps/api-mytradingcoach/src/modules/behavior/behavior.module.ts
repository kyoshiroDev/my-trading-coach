import { Module } from '@nestjs/common';
import { AccountsModule } from '../accounts/accounts.module';
import { TraderPushModule } from '../push/trader-push.module';
import { BehaviorBaselineService } from './behavior-baseline.service';
import { BehaviorAlertsService } from './behavior-alerts.service';

/**
 * Détecteurs de comportement (#602, phase 1) : référence personnelle et moteur d'alertes.
 * Phase 1 = mode silencieux, rien n'est affiché (cf. `.claude/agents/nestjs.md`).
 */
@Module({
  // AccountsModule : perte max du jour et solde du compte (métriques déjà calculées, rien de recalculé).
  // TraderPushModule : push des alertes affichées (#666).
  imports: [AccountsModule, TraderPushModule],
  providers: [BehaviorBaselineService, BehaviorAlertsService],
  exports: [BehaviorBaselineService, BehaviorAlertsService],
})
export class BehaviorModule {}
