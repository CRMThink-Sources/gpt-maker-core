import type { ReactNode } from 'react';
import type { LANDING_FEATURE_IDS } from '@/lib/landing';

type FeatureId = (typeof LANDING_FEATURE_IDS)[number];

/** Um ícone de traço por funcionalidade (24×24), para os cards não terem todos o mesmo desenho. */
const PATHS: Record<FeatureId, ReactNode> = {
  agents: (
    <>
      <rect x="4" y="8" width="16" height="11" rx="3" />
      <path d="M12 8V5" />
      <circle cx="12" cy="4" r="1" />
      <circle cx="9" cy="13.5" r="1" />
      <circle cx="15" cy="13.5" r="1" />
    </>
  ),
  training: (
    <>
      <path d="M2 5h7a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H2z" />
      <path d="M22 5h-7a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h8z" />
    </>
  ),
  intentions: (
    <>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 6h5a3 3 0 0 1 3 3v7" />
    </>
  ),
  functions: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M3 9h18M9 21V9" />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20a6 6 0 0 1 12 0" />
      <path d="M17 8h4M17 12h4" />
    </>
  ),
  handoff: (
    <>
      <path d="M4 12h13" />
      <path d="m13 6 6 6-6 6" />
    </>
  ),
  offHours: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />,
  testChat: (
    <>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  credits: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v8M9.5 10.5h4a1.5 1.5 0 0 1 0 3h-3a1.5 1.5 0 0 0 0 3h4" />
    </>
  ),
};

export function FeatureIcon({ id }: { id: FeatureId }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[id]}
    </svg>
  );
}
