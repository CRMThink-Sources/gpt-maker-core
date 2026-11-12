import type { AiKeyView } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/platform-session';
import AiKeyPage from './page';

const api = vi.fn();
vi.mock('../session-provider', () => ({
  useAppSession: () => ({ session: { user: { isAdmin: true } }, api }),
}));

const view = (patch: Partial<AiKeyView> = {}): AiKeyView => ({
  configured: false,
  last4: null,
  verifiedAt: null,
  creditsPerField: 2,
  platformAvailable: true,
  ...patch,
});

afterEach(() => {
  cleanup();
  api.mockReset();
});

describe('tela da chave Vibecode (6.3)', () => {
  it('chave salva: mostra o final e abre com o campo vazio', async () => {
    api.mockResolvedValueOnce(
      view({ configured: true, last4: '1a2b', verifiedAt: '2026-11-03T12:00:00Z' }),
    );
    render(<AiKeyPage />);
    expect((await screen.findByTestId('ai-key-status')).textContent).toContain('final 1a2b');
    expect((screen.getByPlaceholderText(/vibe_api_/) as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/só com o escopo vibe:ai/)).toBeTruthy();
    expect(screen.getByText(/enviado ao Vibecode/)).toBeTruthy();
  });

  it('chave recusada: mostra a mensagem do backend', async () => {
    api.mockResolvedValueOnce(view());
    api.mockRejectedValueOnce(
      new ApiRequestError(422, 'AI_KEY_SCOPE', 'A chave precisa ter o escopo vibe:ai.'),
    );
    render(<AiKeyPage />);
    const input = await screen.findByPlaceholderText(/vibe_api_/);
    fireEvent.change(input, { target: { value: 'vibe_api_abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Testar e salvar' }));
    await waitFor(() =>
      expect(screen.getByText('A chave precisa ter o escopo vibe:ai.')).toBeTruthy(),
    );
  });
});
