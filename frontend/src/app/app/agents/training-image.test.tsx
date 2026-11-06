import {
  type FunctionAnswers,
  functionTemplateContentSchema,
  type TrainingView,
} from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from '@/lib/platform-session';
import { FunctionForm } from './function-form';
import { imageFileProblem, TrainingImageField } from './training-image-field';
import { AddTrainingModal } from './[id]/trainings/add-training-modal';
import { EditTextTrainingModal } from './[id]/trainings/edit-text-modal';

const api = vi.fn();
// Troca a chamada por uma função comum quando o teste precisa de rejeição (o espião do vitest
// reporta como não tratada toda Promise rejeitada que passa por ele).
let override: ((...args: unknown[]) => Promise<unknown>) | null = null;
vi.mock('../session-provider', () => ({
  useAppSession: () => ({
    session: { canManage: true },
    api: (...args: unknown[]) => (override ? override(...args) : api(...args)),
  }),
}));

const MB = 1024 * 1024;
const png = (name = 'preco.png', size = 1024) =>
  new File([new Uint8Array(size)], name, { type: 'image/png' });
const pick = (file: File) =>
  fireEvent.change(screen.getByLabelText('Escolher imagem'), { target: { files: [file] } });

beforeEach(() => {
  api.mockReset();
  override = null;
});
afterEach(cleanup);

describe('imageFileProblem', () => {
  it('aceita PNG, JPEG e WebP até 5 MB e recusa o resto', () => {
    expect(imageFileProblem({ type: 'image/png', size: 1 })).toBeNull();
    expect(imageFileProblem({ type: 'image/jpeg', size: 5 * MB })).toBeNull();
    expect(imageFileProblem({ type: 'image/webp', size: 1 })).toBeNull();
    expect(imageFileProblem({ type: 'application/pdf', size: 1 })).toMatch(/PNG, JPEG e WebP/);
    expect(imageFileProblem({ type: 'image/png', size: 8 * MB })).toMatch(/5 MB/);
  });
});

describe('TrainingImageField', () => {
  function Harness() {
    const [image, setImage] = useState<{ id: string; url: string } | null>(null);
    return (
      <TrainingImageField
        agentId="ag1"
        imageId={image?.id ?? null}
        previewUrl={image?.url}
        onChange={setImage}
      />
    );
  }

  it('envia pelo endpoint do agente, mostra a miniatura e permite remover', async () => {
    api.mockResolvedValue({ id: 'img1', url: 'https://s/img1', fileName: 'preco.png' });
    render(<Harness />);
    pick(png());
    const preview = await screen.findByAltText('Imagem anexada ao treinamento');
    expect(preview.getAttribute('src')).toBe('https://s/img1');
    expect(api).toHaveBeenCalledWith('/app/agents/ag1/trainings/images', {
      method: 'POST',
      body: expect.any(FormData),
    });
    fireEvent.click(screen.getByText('Remover imagem'));
    expect(screen.queryByAltText('Imagem anexada ao treinamento')).toBeNull();
  });

  it('recusa formato e tamanho sem chamar a API', () => {
    render(<Harness />);
    pick(new File(['x'], 'a.pdf', { type: 'application/pdf' }));
    expect(screen.getByRole('alert').textContent).toMatch(/PNG, JPEG e WebP/);
    pick(png('grande.png', 6 * MB));
    expect(screen.getByRole('alert').textContent).toMatch(/5 MB/);
    expect(api).not.toHaveBeenCalled();
  });

  it('mostra o erro do servidor', async () => {
    const error = new ApiRequestError(
      422,
      'TRAINING_IMAGE_INVALID_TYPE',
      'Só imagens PNG, JPEG e WebP são aceitas',
    );
    override = async () => {
      throw error;
    };
    render(<Harness />);
    pick(png());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Só imagens PNG, JPEG e WebP');
  });
});

describe('AddTrainingModal: texto com imagem', () => {
  it('cria o texto com o imageId enviado', async () => {
    api.mockImplementation(async (path: string) =>
      String(path).endsWith('/images')
        ? { id: 'img1', url: 'https://s/img1', fileName: 'p.png' }
        : {},
    );
    const onCreated = vi.fn();
    render(
      <AddTrainingModal
        agentId="ag1"
        mediaAllowed={false}
        onClose={() => {}}
        onCreated={onCreated}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: ' Tabela de preços ' } });
    pick(png());
    await screen.findByAltText('Imagem anexada ao treinamento');
    fireEvent.click(screen.getByText('Adicionar'));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const post = api.mock.calls.find(([path]) => path === '/app/agents/ag1/trainings')!;
    expect(JSON.parse(post[1].body)).toEqual({
      type: 'TEXT',
      text: 'Tabela de preços',
      imageId: 'img1',
    });
  });

  it('sem modo avançado só oferece texto; com ele, site e vídeo também', () => {
    const { rerender } = render(
      <AddTrainingModal
        agentId="ag1"
        mediaAllowed={false}
        onClose={() => {}}
        onCreated={() => {}}
      />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    rerender(
      <AddTrainingModal agentId="ag1" mediaAllowed onClose={() => {}} onCreated={() => {}} />,
    );
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });
});

describe('EditTextTrainingModal', () => {
  const training = {
    id: 't1',
    type: 'TEXT',
    status: 'DONE',
    managed: false,
    text: 'Tabela de preços',
    image: { id: 'img1', url: 'https://s/img1', mimetype: 'image/png', sizeBytes: 10 },
  } as unknown as TrainingView;

  it('remover a imagem manda imageId nulo e não repete o texto', async () => {
    api.mockResolvedValue({});
    const onSaved = vi.fn();
    render(
      <EditTextTrainingModal
        agentId="ag1"
        training={training}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    expect((screen.getByText('Salvar') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText('Remover imagem'));
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [path, init] = api.mock.calls[0]!;
    expect(path).toBe('/app/agents/ag1/trainings/t1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ imageId: null });
  });

  it('mudar só o texto não mexe na imagem', async () => {
    api.mockResolvedValue({});
    render(
      <EditTextTrainingModal
        agentId="ag1"
        training={training}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText(/Texto/), { target: { value: 'Tabela 2027' } });
    fireEvent.click(screen.getByText('Salvar'));
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(JSON.parse(api.mock.calls[0]![1].body)).toEqual({ text: 'Tabela 2027' });
  });
});

describe('item da base com imagem', () => {
  const form = functionTemplateContentSchema.parse({
    agentType: 'SUPPORT',
    profile: { jobName: 'Suporte' },
    behavior: 'Você é {{agente.nome}}.',
    fields: [
      {
        kind: 'KNOWLEDGE',
        id: 'base.produtos',
        label: 'Produtos',
        required: false,
        maxItems: 5,
        format: 'Produto: {{nome}}',
        subfields: [{ id: 'nome', label: 'Nome', required: true, maxLength: 80 }],
      },
    ],
  });
  const ITEM = '7f2c1b8e-2a4d-4c6e-9b1a-3d5f7e9a1c2b';

  function Harness({ agentId }: { agentId?: string }) {
    const [answers, setAnswers] = useState<FunctionAnswers>({
      'base.produtos': [{ itemKey: ITEM, values: { nome: 'Plano Pro' } }],
    });
    return (
      <>
        <FunctionForm form={form} answers={answers} onChange={setAnswers} agentId={agentId} />
        <pre data-testid="answers">{JSON.stringify(answers['base.produtos'])}</pre>
      </>
    );
  }

  it('com agente, anexa e remove a imagem do item', async () => {
    api.mockResolvedValue({ id: 'img9', url: 'https://s/img9', fileName: 'p.png' });
    render(<Harness agentId="ag1" />);
    pick(png());
    await waitFor(() =>
      expect(screen.getByTestId('answers').textContent).toContain('"imageId":"img9"'),
    );
    fireEvent.click(screen.getByText('Remover imagem'));
    expect(screen.getByTestId('answers').textContent).not.toContain('imageId');
  });

  it('sem agente (criação, backoffice) não oferece imagem', () => {
    render(<Harness />);
    expect(screen.queryByLabelText('Escolher imagem')).toBeNull();
  });
});
