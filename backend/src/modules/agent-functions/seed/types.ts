import type { FunctionTemplateDraftInput } from '@gptmaker/contracts';

export interface SeedTemplate {
  code: string;
  name: string;
  description: string;
  draft: FunctionTemplateDraftInput;
}
