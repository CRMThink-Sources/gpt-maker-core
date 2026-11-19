import type { FunctionTranslations } from '@gptmaker/contracts';
import { describe, expect, it } from 'vitest';
import { renameId, renameTranslationField, renameTranslationOption } from './model';

// A tradução acompanha o id do campo e o valor da opção (spec function-template-i18n).
const translations: FunctionTranslations = {
  en: {
    name: 'Sales',
    fields: {
      'sdr.tom': { label: 'Tone', options: { formal: 'Formal', normal: 'Friendly' } },
      'sdr.outro': { label: 'Other' },
    },
  },
  es: { fields: { 'sdr.tom': { label: 'Tono' } } },
};

describe('renomear id com traduções', () => {
  it('a chave do campo muda nos dois idiomas e o resto fica', () => {
    const renamed = renameTranslationField(translations, 'sdr.tom', 'sdr.estilo')!;
    expect(Object.keys(renamed.en!.fields!)).toEqual(['sdr.estilo', 'sdr.outro']);
    expect(renamed.en!.fields!['sdr.estilo']!.label).toBe('Tone');
    expect(renamed.en!.name).toBe('Sales');
    expect(Object.keys(renamed.es!.fields!)).toEqual(['sdr.estilo']);
  });

  it('renameId no conteúdo inteiro leva as traduções junto e não mexe nos textos delas', () => {
    const content = {
      behavior: 'Use {{sdr.tom}}',
      translations: {
        en: { fields: { 'sdr.tom': { label: 'Mention {{sdr.tom}} here' } } },
      } satisfies FunctionTranslations,
    };
    const renamed = renameId(content, 'sdr.tom', 'sdr.estilo');
    expect(renamed.behavior).toBe('Use {{sdr.estilo}}');
    expect(renamed.translations.en.fields).toEqual({
      'sdr.estilo': { label: 'Mention {{sdr.tom}} here' },
    });
  });

  it('sem traduções, não inventa nada', () => {
    expect(renameTranslationField(undefined, 'a.b', 'a.c')).toBeUndefined();
    expect(renameId({ behavior: 'x' }, 'a.b', 'a.c')).toEqual({ behavior: 'x' });
  });
});

describe('renomear valor de opção com traduções', () => {
  it('troca a chave da opção só no campo certo, em cada idioma', () => {
    const renamed = renameTranslationOption(translations, 'sdr.tom', 'normal', 'cordial')!;
    expect(renamed.en!.fields!['sdr.tom']!.options).toEqual({
      formal: 'Formal',
      cordial: 'Friendly',
    });
    // espanhol não tinha opções: segue igual
    expect(renamed.es).toEqual(translations.es);
    // outro campo não é tocado
    expect(renamed.en!.fields!['sdr.outro']).toEqual({ label: 'Other' });
  });

  it('opção que não tem tradução não altera nada', () => {
    expect(renameTranslationOption(translations, 'sdr.tom', 'inexistente', 'x')).toEqual(
      translations,
    );
  });
});
