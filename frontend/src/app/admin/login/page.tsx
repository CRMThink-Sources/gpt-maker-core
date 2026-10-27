'use client';

import type { AdminLoginStep, AdminSessionView } from '@gptmaker/contracts';
import QRCode from 'qrcode';
import { type FormEvent, useEffect, useState } from 'react';
import { Logo } from '@/components/logo';
import { Alert, buttonClass, Card, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/platform-session';
import { Field, inputClass } from '../../app/agents/agent-fields';
import { useAdmin } from '../admin-provider';

type CodeStep = Exclude<AdminLoginStep, { step: 'authenticated' }>;

function message(e: unknown, fallback: string): string {
  return e instanceof ApiRequestError && !e.code.startsWith('HTTP_') ? e.message : fallback;
}

/** Login do backoffice: e-mail e senha, depois o código do app autenticador (design D17). */
export default function AdminLoginPage() {
  const { api, signedIn } = useAdmin();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState<CodeStep | null>(null);
  const [code, setCode] = useState('');
  const [rememberDevice, setRememberDevice] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step?.step !== 'totp-setup') return;
    let cancelled = false;
    void QRCode.toDataURL(step.otpauthUrl, { margin: 1, width: 192 }).then(
      (url) => !cancelled && setQr(url),
    );
    return () => {
      cancelled = true;
    };
  }, [step]);

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await api<AdminLoginStep>('/admin/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setPassword('');
      // Navegador lembrado: a sessão já foi aberta, sem pedir o código.
      if (next.step === 'authenticated') signedIn(next.operator);
      else setStep(next);
    } catch (e) {
      setError(message(e, 'Não foi possível entrar.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault();
    if (!step) return;
    setBusy(true);
    setError(null);
    try {
      const { operator } = await api<AdminSessionView>('/admin/auth/totp', {
        method: 'POST',
        body: JSON.stringify({ challenge: step.challenge, code, rememberDevice }),
      });
      signedIn(operator);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'CHALLENGE_EXPIRED') {
        setStep(null);
        setQr(null);
      }
      setCode('');
      setError(message(e, 'Código inválido.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-zinc-50 px-4">
      <Card className="w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-2">
          <Logo subtitle={false} />
          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
            Backoffice
          </span>
        </div>

        {error && (
          <Alert tone="error" className="mb-4">
            {error}
          </Alert>
        )}

        {!step && (
          <form onSubmit={submitPassword} className="space-y-4">
            <Field label="E-mail">
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                required
                autoFocus
              />
            </Field>
            <Field label="Senha">
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                required
              />
            </Field>
            <button type="submit" disabled={busy} className={`${buttonClass()} w-full`}>
              {busy && <Spinner className="size-4" />}
              Continuar
            </button>
          </form>
        )}

        {step && (
          <form onSubmit={submitCode} className="space-y-4">
            {step.step === 'totp-setup' ? (
              <div className="space-y-3 text-sm text-zinc-700">
                <p>
                  <strong>Primeiro acesso:</strong> escaneie o QR code com um app autenticador
                  (Google Authenticator, Microsoft Authenticator, Authy) e digite o código gerado.
                </p>
                <div className="flex justify-center">
                  {qr ? (
                    // eslint-disable-next-line @next/next/no-img-element -- data URL gerado no navegador
                    <img src={qr} alt="QR code do app autenticador" width={192} height={192} />
                  ) : (
                    <Spinner />
                  )}
                </div>
                <p className="text-xs text-zinc-500">
                  Sem câmera? Digite a chave no app:{' '}
                  <code className="break-all rounded bg-zinc-100 px-1 py-0.5">{step.secret}</code>
                </p>
              </div>
            ) : (
              <p className="text-sm text-zinc-700">
                Digite o código de 6 dígitos do seu app autenticador.
              </p>
            )}
            <Field label="Código">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center font-mono text-lg tracking-[0.4em]`}
                required
                autoFocus
              />
            </Field>
            <label className="flex items-start gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                className="mt-0.5 size-4 rounded border-zinc-300"
              />
              <span>
                Lembrar este navegador por 30 dias
                <span className="block text-xs text-zinc-500">
                  Nos próximos logins aqui, só a senha. Não marque em computador compartilhado.
                </span>
              </span>
            </label>
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className={`${buttonClass()} w-full`}
            >
              {busy && <Spinner className="size-4" />}
              Entrar
            </button>
            <button
              type="button"
              onClick={() => {
                setStep(null);
                setQr(null);
                setCode('');
                setError(null);
              }}
              className={`${buttonClass('ghost', 'sm')} w-full`}
            >
              Voltar
            </button>
          </form>
        )}
      </Card>
    </div>
  );
}
