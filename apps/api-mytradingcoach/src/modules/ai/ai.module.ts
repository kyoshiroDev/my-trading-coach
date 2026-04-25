import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { OrchestratorAgent } from './agents/orchestrator.agent';
import { DataAgent } from './agents/data.agent';
import { PatternAgent } from './agents/pattern.agent';
import { CoachAgent } from './agents/coach.agent';
import { DebriefAgent } from './agents/debrief.agent';
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    OrchestratorAgent,
    DataAgent,
    PatternAgent,
    CoachAgent,
    DebriefAgent,
  ],
  exports: [AiService],
})
export class AiModule {}
