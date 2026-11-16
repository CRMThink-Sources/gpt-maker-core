import type { Locale } from '@gptmaker/contracts';
import { LANDING_TAB_IDS } from '@/lib/landing';
import { landingT, translatorFor } from '../landing-t';
import type { LandingTab } from '../landing-tabs';
import type { Screen, ScreenCtx } from './mock-ui';
import { channelScreens } from './screens-channel';
import { createScreens } from './screens-create';
import { creditsScreens } from './screens-credits';
import { installScreens } from './screens-install';
import { intentionsScreens } from './screens-intentions';
import { trainScreens } from './screens-train';

/** Três telas simuladas por aba, na ordem dos passos. */
const SCREENS: Record<(typeof LANDING_TAB_IDS)[number], [Screen, Screen, Screen]> = {
  install: installScreens,
  create: createScreens,
  train: trainScreens,
  intentions: intentionsScreens,
  channel: channelScreens,
  credits: creditsScreens,
};

/**
 * Monta as abas de Primeiros passos no idioma pedido (spec landing-page): textos de cada passo,
 * contador "Passo X de N" e a tela simulada com o destaque no alvo do passo.
 */
export function buildTutorialTabs(locale: Locale): LandingTab[] {
  const t = landingT(locale);
  const ctx: ScreenCtx = { t, app: (namespace) => translatorFor(locale, namespace) };
  return LANDING_TAB_IDS.map((id) => ({
    id,
    label: t(`start.tabs.${id}.label`),
    intro: t(`start.tabs.${id}.intro`),
    steps: SCREENS[id].map((screen, index) => {
      const n = index + 1;
      const target = t(`start.tabs.${id}.steps.${n}.target`);
      return {
        title: t(`start.tabs.${id}.steps.${n}.title`),
        text: t(`start.tabs.${id}.steps.${n}.text`),
        target,
        counter: t('start.stepOf', { current: n, total: SCREENS[id].length }),
        screen: screen(ctx, target),
      };
    }),
  }));
}
