import { GptthinkLanding } from '@/components/landing/gptthink-landing';
import { landingMetadata } from '@/components/landing/landing-metadata';

// pt-BR vive na URL sem sufixo; en e es ficam em `[locale]` (spec landing-page).
export const metadata = landingMetadata('pt-BR');

export default function GptthinkLandingPage() {
  return <GptthinkLanding locale="pt-BR" />;
}
