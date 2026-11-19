import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@gptmaker/contracts';

/**
 * Idioma da interface a partir de `Accept-Language` (spec function-template-i18n): o app envia o
 * idioma ativo (`pt-BR`, `en` ou `es`). Aceita também variantes (`en-US`, `es-MX`, `pt`) e lista
 * com pesos; o que não for suportado cai em `pt-BR`. O peso (`q`) é ignorado: vale o primeiro
 * idioma suportado da lista, porque o app envia um idioma só.
 */
export function localeFromAcceptLanguage(header: string | string[] | undefined): Locale {
  const value = Array.isArray(header) ? header[0] : header;
  for (const part of (value ?? '').split(',')) {
    const tag = part.split(';')[0]!.trim();
    if (isLocale(tag)) return tag;
    const language = tag.toLowerCase().split('-')[0];
    if (language === 'pt') return 'pt-BR';
    if (language === 'en' || language === 'es') return language;
  }
  return DEFAULT_LOCALE;
}

/** Idioma da requisição (cabeçalho `Accept-Language`). */
export const RequestLocale = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context
    .switchToHttp()
    .getRequest<{ headers: Record<string, string | string[]> }>();
  return localeFromAcceptLanguage(request.headers['accept-language']);
});
