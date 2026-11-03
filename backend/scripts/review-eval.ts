/**
 * Avaliação da revisão por IA, sob demanda (spec agent-review-evaluation). Não roda no CI.
 *
 *   VIBECODE_EVAL_API_KEY=vibe_api_… npm run review:eval -w backend -- --versions=baseline,current
 *
 * Opções: --versions=a,b (current, candidate, baseline; duas mostram a diferença),
 * --repeat=2 (vezes por caso), --cases=id1,id2.
 */
import { VibecodeClient } from '../src/modules/vibecode';
import { main } from '../src/modules/function-review/eval/eval-cli';

const model = process.env.VIBECODE_REVIEW_MODEL ?? 'bitrix/bitrixgpt-5.5';
const client = new VibecodeClient({
  baseUrl: process.env.VIBECODE_BASE_URL ?? 'https://vibecode.bitrix24.com',
  timeoutMs: 60_000,
});

main(process.argv.slice(2), {
  apiKey: process.env.VIBECODE_EVAL_API_KEY,
  makeChat: (apiKey) => async (messages) =>
    (await client.chat({ apiKey, model, messages, temperature: 0.2, json: true })).content,
  write: (line) => console.log(line),
}).then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
