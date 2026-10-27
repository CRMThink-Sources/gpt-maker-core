// API pública do módulo: outros módulos só importam daqui.
export { AgentFunctionService } from './agent-function.service';
export { AgentFunctionsModule } from './agent-functions.module';
export { FunctionPublisher } from './function-publisher';
export { FunctionSandbox, type SandboxResult } from './function-sandbox';
export {
  FunctionCatalog,
  type PublishedFunction,
  type PublishOutcome,
} from './function-catalog.service';
