'use client';

import { ChatIcon } from '@/components/icons';
import { useT } from '@/i18n';
import { buttonClass, Card, PageHeader } from '@/components/ui';
import { useAppSession } from '../session-provider';
import { SkillCard } from './skill-card';

const STEPS = ['s1', 's2', 's3'] as const;

/** Temas e perguntas do FAQ; os textos ficam em `help.json` (spec app-help). */
const TOPICS = [
  { id: 'agents', items: ['create', 'train', 'test'] },
  { id: 'credits', items: ['charge', 'empty', 'plan'] },
  { id: 'channel', items: ['connect', 'handoff', 'offHours'] },
] as const;

/** Ajuda do portal do cliente: primeiros passos, perguntas frequentes e atalho para o suporte. */
export default function HelpPage() {
  const t = useT('help');
  const { config } = useAppSession();

  return (
    <div className="space-y-8">
      <PageHeader title={t('title')} description={t('description')} />

      <section aria-labelledby="help-steps">
        <h2 id="help-steps" className="mb-3 text-base font-semibold text-zinc-900">
          {t('stepsTitle')}
        </h2>
        <ol className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step}>
              <Card className="h-full p-4">
                <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-brand-50 text-xs font-semibold text-brand-700">
                  {index + 1}
                </span>
                <p className="text-sm font-medium text-zinc-900">{t(`steps.${step}.title`)}</p>
                <p className="mt-1 text-sm text-zinc-500">{t(`steps.${step}.text`)}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="help-faq" className="space-y-5">
        <h2 id="help-faq" className="text-base font-semibold text-zinc-900">
          {t('faqTitle')}
        </h2>
        {TOPICS.map((topic) => (
          <div key={topic.id}>
            <h3 className="mb-2 text-sm font-semibold text-zinc-600">
              {t(`topics.${topic.id}.title`)}
            </h3>
            <Card className="divide-y divide-zinc-100">
              {topic.items.map((item) => (
                <details key={item} className="px-4 py-3">
                  <summary className="cursor-pointer rounded text-sm font-medium text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                    {t(`topics.${topic.id}.items.${item}.q`)}
                  </summary>
                  <p className="mt-2 text-sm text-zinc-600">
                    {t(`topics.${topic.id}.items.${item}.a`)}
                  </p>
                </details>
              ))}
            </Card>
          </div>
        ))}
      </section>

      <SkillCard apiBaseUrl={config.apiBaseUrl} />

      {config.supportUrl && (
        <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t('supportTitle')}</p>
            <p className="text-sm text-zinc-500">{t('supportText')}</p>
          </div>
          <a
            href={config.supportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('secondary')}
          >
            <ChatIcon className="size-4" />
            {t('supportButton')}
          </a>
        </Card>
      )}
    </div>
  );
}
