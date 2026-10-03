import type { SVGProps } from 'react';

/** Ícones de traço (24x24), no estilo dos Heroicons outline. */
function Icon({ d, ...props }: SVGProps<SVGSVGElement> & { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="size-5"
      {...props}
    >
      <path d={d} />
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const BotIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 3v3m-5 3h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Zm2 5h.01M15 14h.01M9.5 17.5h5M3 13v2m18-2v2"
  />
);
export const UsersIcon = (p: P) => (
  <Icon
    {...p}
    d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m17 0v-1a4 4 0 0 0-3-3.87M15 4.13a4 4 0 0 1 0 7.75M13.5 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"
  />
);
export const BookIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 6.5C10.5 5.3 8.5 4.5 6 4.5c-1 0-2 .1-3 .4v13c1-.3 2-.4 3-.4 2.5 0 4.5.8 6 2m0-13c1.5-1.2 3.5-2 6-2 1 0 2 .1 3 .4v13c-1-.3-2-.4-3-.4-2.5 0-4.5.8-6 2m0-13v13"
  />
);
export const BellIcon = (p: P) => (
  <Icon
    {...p}
    d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 0 0-4-5.66V5a2 2 0 1 0-4 0v.34A6 6 0 0 0 6 11v3.2a2 2 0 0 1-.6 1.4L4 17h5m6 0v1a3 3 0 1 1-6 0v-1m6 0H9"
  />
);
export const BoltIcon = (p: P) => <Icon {...p} d="M13 3 4 14h7l-1 7 9-11h-7l1-7Z" />;
export const WalletIcon = (p: P) => (
  <Icon
    {...p}
    d="M20 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-1m1-9h-5a2.5 2.5 0 0 0 0 5h5V8Z"
  />
);
export const PlusIcon = (p: P) => <Icon {...p} d="M12 5v14m-7-7h14" />;
export const MenuIcon = (p: P) => <Icon {...p} d="M4 6h16M4 12h16M4 18h16" />;
export const CloseIcon = (p: P) => <Icon {...p} d="M6 6l12 12M18 6 6 18" />;
export const ArrowLeftIcon = (p: P) => <Icon {...p} d="M19 12H5m6-6-6 6 6 6" />;
export const AlertIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 9v4m0 4h.01M10.3 3.9 2.5 17.5A2 2 0 0 0 4.2 20.5h15.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
  />
);
export const CheckIcon = (p: P) => <Icon {...p} d="M5 12.5 10 17 19 7" />;
export const TextIcon = (p: P) => <Icon {...p} d="M4 6h16M4 10h16M4 14h10M4 18h7" />;
export const GlobeIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0 0c2.5-2.5 3.5-5.5 3.5-9S14.5 5.5 12 3m0 18c-2.5-2.5-3.5-5.5-3.5-9S9.5 5.5 12 3M3.5 9h17m-17 6h17"
  />
);
export const VideoIcon = (p: P) => (
  <Icon
    {...p}
    d="M15 10.5 20 7v10l-5-3.5M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
  />
);
export const FileIcon = (p: P) => (
  <Icon
    {...p}
    d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6m-6 4h4"
  />
);
export const UploadIcon = (p: P) => (
  <Icon {...p} d="M12 16V4m0 0-4 4m4-4 4 4M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
);
export const UserIcon = (p: P) => (
  <Icon {...p} d="M16 7.5a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4.5 20a7.5 7.5 0 0 1 15 0" />
);
export const BuildingIcon = (p: P) => (
  <Icon
    {...p}
    d="M4 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16m0-10h2a2 2 0 0 1 2 2v8M3 21h18M8 7h4m-4 4h4m-4 4h4"
  />
);
export const SparkIcon = (p: P) => (
  <Icon
    {...p}
    d="M12 3v3m0 12v3M3 12h3m12 0h3M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2Z"
  />
);
export const ChatIcon = (p: P) => (
  <Icon {...p} d="M8 10h8m-8 4h5m-8 6 1.5-3.5A8 8 0 1 1 9 19.6L5 20Z" />
);
