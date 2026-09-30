const TONES = {
  green: 'bg-green-100 text-green-800',
  zinc: 'bg-zinc-100 text-zinc-700',
  amber: 'bg-amber-100 text-amber-900',
} as const;

export function StatusBadge({ label, tone }: { label: string; tone: keyof typeof TONES }) {
  return <span className={`rounded px-2 py-0.5 text-xs ${TONES[tone]}`}>{label}</span>;
}
