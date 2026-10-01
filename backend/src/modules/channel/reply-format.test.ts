import { describe, expect, it } from 'vitest';
import { fileNameOfUrl, fitMessage, replyFields, toBbCode } from './reply-format';

describe('resposta do GPTMaker no Bitrix', () => {
  it.each([
    ['**negrito**', '[B]negrito[/B]'],
    ['__negrito__', '[B]negrito[/B]'],
    ['~~riscado~~', '[S]riscado[/S]'],
    ['veja [o site](https://x.com/a?b=1)', 'veja [URL=https://x.com/a?b=1]o site[/URL]'],
    ['```js\nconst a = 1;\n```', '[CODE]const a = 1;\n[/CODE]'],
    // Asterisco simples fica: no WhatsApp `*x*` é negrito.
    ['*ênfase*', '*ênfase*'],
    ['2 ** 3 e a**b', '2 ** 3 e a**b'],
    ['linha 1\nlinha 2', 'linha 1\nlinha 2'],
  ])('%s ⇒ %s', (markdown, bbcode) => {
    expect(toBbCode(markdown)).toBe(bbcode);
  });

  it('corta no limite sem partir a palavra', () => {
    const text = `${'palavra '.repeat(10)}fim`;
    const cut = fitMessage(text, 30);
    expect(cut.length).toBeLessThanOrEqual(30);
    expect(cut.endsWith('…')).toBe(true);
    expect(cut).not.toMatch(/palavr…$/);
    expect(fitMessage('curto', 30)).toBe('curto');
  });

  it('texto e mídia viram message e attach', () => {
    expect(
      replyFields({
        message: ' **Olá** ',
        images: ['https://cdn.gptmaker.ai/a.png'],
        audios: ['https://cdn.gptmaker.ai/audio/resposta.mp3'],
        documents: ['https://cdn.gptmaker.ai/doc/tabela%20de%20pre%C3%A7os.pdf'],
      }),
    ).toEqual({
      message: '[B]Olá[/B]',
      attach: {
        BLOCKS: [
          { IMAGE: { LINK: 'https://cdn.gptmaker.ai/a.png' } },
          { FILE: { LINK: 'https://cdn.gptmaker.ai/audio/resposta.mp3', NAME: 'resposta.mp3' } },
          {
            FILE: {
              LINK: 'https://cdn.gptmaker.ai/doc/tabela%20de%20pre%C3%A7os.pdf',
              NAME: 'tabela de preços.pdf',
            },
          },
        ],
      },
    });
  });

  it('só texto, só mídia e vazio', () => {
    expect(replyFields({ message: 'Oi', images: [], audios: [], documents: [] })).toEqual({
      message: 'Oi',
    });
    expect(replyFields({ message: null, images: ['https://x/a.png'] })).toEqual({
      attach: { BLOCKS: [{ IMAGE: { LINK: 'https://x/a.png' } }] },
    });
    expect(replyFields({ message: '  ', images: [], audios: null })).toBeNull();
  });

  it('nome do arquivo pela URL, com reserva', () => {
    expect(fileNameOfUrl('https://x/y/z.pdf?sig=1', 'f')).toBe('z.pdf');
    expect(fileNameOfUrl('https://x/', 'f')).toBe('f');
    expect(fileNameOfUrl('não é url', 'f')).toBe('f');
  });
});
