import { Module } from '@nestjs/common';
import { BehaviorBaselineService } from './behavior-baseline.service';

/**
 * Détecteurs de comportement (#602, phase 1) : référence personnelle et moteur d'alertes.
 * Phase 1 = mode silencieux, rien n'est affiché (cf. `.claude/agents/nestjs.md`).
 */
@Module({
  providers: [BehaviorBaselineService],
  exports: [BehaviorBaselineService],
})
export class BehaviorModule {}
