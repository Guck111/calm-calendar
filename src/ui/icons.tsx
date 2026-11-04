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
