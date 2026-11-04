// Небольшой набор линейных иконок, нарисованных вручную
type P = { size?: number };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
});

export const ChevronLeft = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M10 3.5 5.5 8l4.5 4.5" />
  </svg>
);

export const ChevronRight = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M6 3.5 10.5 8 6 12.5" />
  </svg>
);

export const Refresh = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M13 8a5 5 0 1 1-1.5-3.6" />
    <path d="M13 2.5V5h-2.5" />
  </svg>
);

export const Plus = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const Close = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="m4 4 8 8M12 4l-8 8" />
  </svg>
);

export const External = ({ size = 14 }: P) => (
  <svg {...base(size)}>
    <path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" />
  </svg>
);

export const Repeat = ({ size = 12 }: P) => (
  <svg {...base(size)}>
    <path d="M3 7V6a2 2 0 0 1 2-2h7.5M10.5 2 12.5 4l-2 2M13 9v1a2 2 0 0 1-2 2H3.5M5.5 14l-2-2 2-2" />
  </svg>
);

export const Sun = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
  </svg>
);

export const Moon = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5Z" />
  </svg>
);

export const Auto = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11a5.5 5.5 0 0 0 0-11Z" fill="currentColor" />
  </svg>
);

export const Gear = ({ size = 16 }: P) => (
  <svg {...base(size)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1" />
    <circle cx="8" cy="8" r="4.4" />
  </svg>
);
