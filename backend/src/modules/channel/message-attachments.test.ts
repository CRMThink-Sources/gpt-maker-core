import { describe, expect, it } from 'vitest';
import { fileNameFrom } from './chat-media';
import { attachmentFileIds, hasUnknownAttachment, mediaKindOf } from './message-attachments';

describe('anexos da mensagem do cliente', () => {
  it.each([
    ['lista de FILE_ID (v1)', { FILE_ID: ['138', '139'] }, [138, 139]],
    ['FILE_ID indexado do form-urlencoded', { FILE_ID: { 0: '138' } }, [138]],
    ['FILE_ID texto', { FILE_ID: '138' }, [138]],
    ['files com id', { files: [{ id: 138, name: 'a.pdf' }] }, [138]],
    ['FILES indexado', { FILES: { 0: { id: '140' } } }, [140]],
    ['sem repetição', { FILE_ID: ['138'], files: [{ id: 138 }] }, [138]],
    ['ids inválidos ignorados', { FILE_ID: ['0', 'abc', ''] }, []],
    ['sem anexo', {}, []],
    ['params vazio do webhook', '', []],
    ['params nulo', null, []],
  ])('%s', (_name, params, expected) => {
    expect(attachmentFileIds(params)).toEqual(expected);
  });

  it('aponta chave de arquivo em formato desconhecido', () => {
    expect(hasUnknownAttachment({ ATTACH_FILES: 'x' })).toBe(true);
    expect(hasUnknownAttachment({ FILE_ID: ['1'] })).toBe(false);
    expect(hasUnknownAttachment({ KEYBOARD: [] })).toBe(false);
  });

  it.each([
    ['image/jpeg', 'x', 'image'],
    ['audio/ogg; codecs=opus', 'x', 'audio'],
    ['video/mp4', 'x', 'video'],
    ['application/pdf', 'contrato.pdf', 'document'],
    ['application/octet-stream', 'foto.PNG', 'image'],
    ['application/octet-stream', 'voz.oga', 'audio'],
    ['application/octet-stream', 'clipe.mov', 'video'],
    ['application/octet-stream', 'planilha.xlsx', 'document'],
  ] as const)('%s / %s ⇒ %s', (contentType, fileName, kind) => {
    expect(mediaKindOf(contentType, fileName)).toBe(kind);
  });

  it.each([
    [`attachment; filename="a.pdf"; filename*=UTF-8''or%C3%A7amento.pdf`, 'orçamento.pdf'],
    ['attachment; filename="relatorio.pdf"', 'relatorio.pdf'],
    ['attachment; filename=foto.jpg', 'foto.jpg'],
    ['inline', undefined],
    [null, undefined],
  ])('nome do arquivo de %s', (header, expected) => {
    expect(fileNameFrom(header)).toBe(expected);
  });
});
