import { Module } from '@nestjs/common';
import { AgentFunctionsModule } from '../agent-functions';
import { HelpSkillController } from './help-skill.controller';
import { HelpSkillService } from './help-skill.service';

/** Skill do Claude para o cliente tirar dúvidas (spec customer-help-skill). */
@Module({
  imports: [AgentFunctionsModule],
  controllers: [HelpSkillController],
  providers: [HelpSkillService],
})
export class HelpSkillModule {}
