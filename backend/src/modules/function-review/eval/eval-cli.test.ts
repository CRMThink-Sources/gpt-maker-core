import { describe, expect, it, vi } from 'vitest';
import { main, parseArgs } from './eval-cli';

const reply = JSON.stringify({ summary: 'x', items: [] });

function io(apiKey: string | undefined, chat = vi.fn(async () => reply)) {
  const lines: string[] = [];
  const makeChat = vi.fn(() => chat);
  return { lines, chat, makeChat, io: { apiKey, makeChat, write: (l: string) => lines.push(l) } };
}

describe('comando de avaliação', () => {
  it('sem a chave para antes de qualquer chamada', async () => {
    const run = io(undefined);
    expect(await main([], run.io)).toBe(1);
    expect(run.lines.join('\n')).toContain('VIBECODE_EVAL_API_KEY');
    expect(run.makeChat).not.toHaveBeenCalled();
    expect(run.chat).not.toHaveBeenCalled();
  });

  it('versão desconhecida ou mais de duas versões: recusa sem chamar', async () => {
    const unknown = io('vibe_api_x');
    expect(await main(['--versions=zzz'], unknown.io)).toBe(1);
    const three = io('vibe_api_x');
    expect(await main(['--versions=current,candidate,baseline'], three.io)).toBe(1);
    expect(unknown.chat).not.toHaveBeenCalled();
    expect(three.chat).not.toHaveBeenCalled();
  });

  it('com a chave roda os casos pedidos e imprime a tabela com a diferença das duas versões', async () => {
    const run = io('vibe_api_x');
    const code = await main(
      ['--versions=baseline,current', '--repeat=1', '--cases=ruim-descricao-vaga'],
      run.io,
    );
    expect(code).toBe(0);
    const text = run.lines.join('\n');
    expect(text).toContain('baseline');
    expect(text).toContain('diferença');
    expect(run.chat).toHaveBeenCalled();
  });

  it('id de caso que não existe', async () => {
    const run = io('vibe_api_x');
    expect(await main(['--cases=nao-existe'], run.io)).toBe(1);
    expect(run.chat).not.toHaveBeenCalled();
  });

  it('lê as opções e valida o --repeat', () => {
    expect(parseArgs(['--versions=a,b', '--repeat=3', '--cases=x,y', '--details'])).toEqual({
      versions: ['a', 'b'],
      repeat: 3,
      caseIds: ['x', 'y'],
      details: true,
      assist: false,
    });
    expect(parseArgs([])).toEqual({
      versions: ['current'],
      repeat: 2,
      caseIds: null,
      details: false,
      assist: false,
    });
    expect(() => parseArgs(['--repeat=0'])).toThrow(/--repeat/);
  });
  it('--assist avalia a ajuda da IA, sem a chave não chama nada', async () => {
    const none = io(undefined);
    expect(await main(['--assist'], none.io)).toBe(1);
    expect(none.chat).not.toHaveBeenCalled();
    const reply = JSON.stringify({
      fields: [{ fieldId: 'sdr.criterio', text: 'Tem 99 vendedores' }],
    });
    const run = io(
      'vibe_api_x',
      vi.fn(async () => reply),
    );
    expect(await main(['--assist', '--repeat=1', '--cases=sdr-criterio-completa'], run.io)).toBe(0);
    expect(run.lines.join('\n')).toContain('fatos inventados');
    expect(run.lines.join('\n')).toContain('99');
  });
});
