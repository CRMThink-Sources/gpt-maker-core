import { redirect } from 'next/navigation';

/** Link direto para criar agente: a criação é um modal sobre a lista. */
export default function NewAgentPage() {
  redirect('/app?novo=1');
}
