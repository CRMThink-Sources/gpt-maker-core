import { describe, expect, it } from 'vitest';
import BasePage from './page';
import LocalePage, { dynamicParams, generateMetadata, generateStaticParams } from './[locale]/page';

const params = (locale: string) => ({ params: Promise.resolve({ locale }) }) as never;

describe('/lp/gptthink/[locale]', () => {
  it('gera só en e es e não aceita outros segmentos', () => {
    expect(generateStaticParams()).toEqual([{ locale: 'en' }, { locale: 'es' }]);
    expect(dynamicParams).toBe(false);
  });

  it.each(['pt-BR', 'fr', ''])('"%s" responde 404', async (locale) => {
    await expect(LocalePage(params(locale))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
    await expect(generateMetadata(params(locale))).rejects.toMatchObject({
      digest: expect.stringContaining('404'),
    });
  });

  it('en e es renderizam a página no idioma e com metadados próprios', async () => {
    const page = await LocalePage(params('es'));
    expect(page).toBeTruthy();
    const meta = await generateMetadata(params('en'));
    expect(meta.alternates?.canonical).toBe('/lp/gptthink/en');
  });
});

describe('/lp/gptthink', () => {
  it('renderiza a versão em português', () => {
    expect(BasePage()).toBeTruthy();
  });
});
