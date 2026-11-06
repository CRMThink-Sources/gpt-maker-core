import type { BusinessHours } from '@gptmaker/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentFormValues } from './agent-fields';
import { BusinessHoursFields } from './business-hours-fields';

afterEach(cleanup);

function Harness({
  initial,
  now,
  onValues,
}: {
  initial: BusinessHours | null;
  now?: Date;
  onValues?: (values: AgentFormValues) => void;
}) {
  const [values, setValues] = useState<AgentFormValues>({
    name: '',
    avatarUrl: '',
    modelId: '',
    settings: {},
    businessHours: initial,
    outOfHoursMessage: '',
    outOfHoursTransfer: true,
  });
  onValues?.(values);
  return (
    <BusinessHoursFields
      values={values}
      now={now}
      set={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
    />
  );
}

const weekday = [{ start: '09:00', end: '18:00' }];
const office: BusinessHours = {
  timezone: 'America/Sao_Paulo',
  days: { mon: weekday, tue: weekday, wed: weekday, thu: weekday, fri: weekday, sat: [], sun: [] },
};

describe('BusinessHoursFields', () => {
  it('sem horário mostra "24 horas" e liga o expediente padrão', () => {
    render(<Harness initial={null} />);
    expect(screen.getByText('24 horas')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Definir horário de funcionamento'));
    expect(screen.getByLabelText('Segunda: início')).toBeTruthy();
    expect(screen.queryByText('24 horas')).toBeNull();
  });

  it('desligar remove o horário e volta a "24 horas"', () => {
    render(<Harness initial={office} />);
    fireEvent.click(screen.getByLabelText('Definir horário de funcionamento'));
    expect(screen.getByText('24 horas')).toBeTruthy();
  });

  it('adiciona intervalo e avisa sobreposição', () => {
    render(<Harness initial={office} />);
    fireEvent.click(screen.getAllByText('Adicionar intervalo')[0]!);
    expect(screen.getAllByLabelText('Segunda: início')).toHaveLength(2);
    expect(screen.getByRole('alert').textContent).toContain('Segunda');
  });

  it('selo fora/dentro do horário agora, no fuso do agente', () => {
    // 2026-11-04 (quarta) 13:30 UTC = 10:30 em Brasília.
    const { unmount } = render(<Harness initial={office} now={new Date('2026-11-04T13:30:00Z')} />);
    expect(screen.getByText('Dentro do horário agora')).toBeTruthy();
    unmount();
    // Sábado.
    render(<Harness initial={office} now={new Date('2026-11-07T13:30:00Z')} />);
    expect(screen.getByText('Fora do horário agora')).toBeTruthy();
  });

  describe('transferência para atendente', () => {
    it('vem ligada por padrão e desligar muda o valor enviado', () => {
      let latest: AgentFormValues | undefined;
      render(<Harness initial={office} onValues={(v) => (latest = v)} />);
      const box = screen.getByLabelText('Transferir para um atendente') as HTMLInputElement;
      expect(box.checked).toBe(true);
      fireEvent.click(box);
      expect(latest?.outOfHoursTransfer).toBe(false);
      expect(
        (screen.getByLabelText('Transferir para um atendente') as HTMLInputElement).checked,
      ).toBe(false);
    });

    it('o aviso continua opcional e o texto de ajuda cita a Linha Aberta', () => {
      render(<Harness initial={office} />);
      expect(screen.getByText(/Linha Aberta precisa estar configurado/)).toBeTruthy();
      expect(screen.getByText(/Mensagem fora do horário \(opcional\)/)).toBeTruthy();
    });

    it('sem horário a opção não aparece', () => {
      render(<Harness initial={null} />);
      expect(screen.queryByLabelText('Transferir para um atendente')).toBeNull();
    });
  });
});
