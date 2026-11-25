'use client';

import { buttonClass, Card } from '@/components/ui';
import { useT } from '@/i18n';

const SUMMARY =
  'cursor-pointer rounded text-sm font-medium text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600';

/**
 * Download da skill de ajuda para o Claude do cliente (spec customer-help-skill). É um link para a
 * rota pública da API, em nova aba: não depende da sessão nem navega o iframe do Bitrix24.
 */
export function SkillCard({ apiBaseUrl }: { apiBaseUrl: string }) {
  const t = useT('help');
  const base = apiBaseUrl.replace(/\/+$/, '');

  return (
    <section aria-labelledby="help-skill">
      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="max-w-xl">
            <h2 id="help-skill" className="text-base font-semibold text-zinc-900">
              {t('skill.title')}
            </h2>
            <p className="text-sm text-zinc-500">{t('skill.description')}</p>
          </div>
          <a
            href={`${base}/public/help-skill/download`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass('primary')}
          >
            {t('skill.download')}
          </a>
        </div>
        <details>
          <summary className={SUMMARY}>{t('skill.install.title')}</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li>{t('skill.install.web')}</li>
            <li>{t('skill.install.code')}</li>
          </ul>
        </details>
        <details>
          <summary className={SUMMARY}>{t('skill.access.title')}</summary>
          <p className="mt-2 text-sm text-zinc-600">
            {t('skill.access.text', { domain: new URL(base).hostname })}
          </p>
        </details>
      </Card>
    </section>
  );
}
