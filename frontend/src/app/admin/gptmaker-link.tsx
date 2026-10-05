import { ExternalLinkIcon } from '@/components/icons';

/** Página do agente no painel do GPTMaker. */
export function gptmakerAgentUrl(gptmakerAgentId: string): string {
  return `https://app.gptmaker.ai/browse/agents/${encodeURIComponent(gptmakerAgentId)}`;
}

/** Id do agente no GPTMaker, com link para abri-lo no painel (o nome lá não diz o portal). */
export function GptMakerAgentLink({ id }: { id: string }) {
  return (
    <a
      href={gptmakerAgentUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      title="Abrir no GPTMaker"
      className="inline-flex items-center gap-1 text-zinc-500 hover:text-brand-700 hover:underline"
    >
      <code className="text-xs">{id}</code>
      <ExternalLinkIcon className="size-3.5" />
    </a>
  );
}
