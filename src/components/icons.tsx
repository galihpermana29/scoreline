import type { SVGProps } from "react";

/**
 * SF Symbols-flavoured glyphs drawn on a 20pt grid: 1.6pt strokes, round
 * caps, no fills except where the symbol is a solid shape. Kept inline so
 * the sidebar, tab bar and toolbars share one visual weight.
 */
export type IconName =
  | "home"
  | "search"
  | "live"
  | "football"
  | "badminton"
  | "basketball"
  | "flag"
  | "trophy"
  | "table"
  | "sport"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "play"
  | "stop"
  | "fullscreen"
  | "fullscreen-exit"
  | "close"
  | "more"
  | "calendar"
  | "arrow-up-right"
  | "clear"
  | "sidebar"
  | "sun"
  | "moon";

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PATHS: Record<IconName, React.ReactNode> = {
  sidebar: (
    <>
      <rect {...STROKE} x="2.8" y="4" width="14.4" height="12" rx="2.4" />
      <path {...STROKE} d="M7.6 4v12" />
      <path {...STROKE} d="M4.8 7h1.2M4.8 9.4h1.2" strokeWidth={1.4} />
    </>
  ),
  home: <path {...STROKE} d="M3.2 9.6 10 3.6l6.8 6V16.5h-4.4v-4.6H7.6v4.6H3.2z" />,
  search: (
    <>
      <circle {...STROKE} cx="8.6" cy="8.6" r="5.4" />
      <path {...STROKE} d="m12.6 12.6 4.2 4.2" />
    </>
  ),
  live: (
    <>
      <circle cx="10" cy="10" r="2" fill="currentColor" />
      <path {...STROKE} d="M6.3 6.3a5.2 5.2 0 0 0 0 7.4M13.7 6.3a5.2 5.2 0 0 1 0 7.4" />
      <path {...STROKE} d="M3.6 3.6a9 9 0 0 0 0 12.8M16.4 3.6a9 9 0 0 1 0 12.8" opacity="0.55" />
    </>
  ),
  football: (
    <>
      <circle {...STROKE} cx="10" cy="10" r="7.4" />
      <path {...STROKE} d="m10 6.4 2.9 2.1-1.1 3.4H8.2L7.1 8.5z" />
      <path {...STROKE} d="M10 6.4V2.8M12.9 8.5l3.4-1.1M11.8 11.9l2.1 2.9M8.2 11.9l-2.1 2.9M7.1 8.5 3.7 7.4" />
    </>
  ),
  badminton: (
    <>
      <circle cx="6.4" cy="13.6" r="2.6" fill="currentColor" />
      <path {...STROKE} d="M8.3 11.7 16.6 3.4M8.3 11.7l3-7M8.3 11.7l7-3M11.3 4.7l4 4" />
    </>
  ),
  basketball: (
    <>
      <circle {...STROKE} cx="10" cy="10" r="7.4" />
      <path {...STROKE} d="M2.6 10h14.8M10 2.6v14.8M4.8 4.8c3 2.6 3 7.8 0 10.4M15.2 4.8c-3 2.6-3 7.8 0 10.4" />
    </>
  ),
  flag: (
    <>
      <path {...STROKE} d="M4.4 17.4V3.2" />
      <path {...STROKE} d="M4.4 3.6h11.4l-2 3.6 2 3.6H4.4z" />
      <path fill="currentColor" d="M6.2 5.2h2.4v2.4H6.2zM10.8 5.2h2.4v2.4h-2.4zM8.6 7.6H11V10H8.6z" opacity="0.9" />
    </>
  ),
  trophy: (
    <>
      <path {...STROKE} d="M6.2 3.2h7.6v4.2a3.8 3.8 0 0 1-7.6 0z" />
      <path {...STROKE} d="M6.2 4.4H3.8a2.4 2.4 0 0 0 2.4 3.4M13.8 4.4h2.4a2.4 2.4 0 0 1-2.4 3.4M10 11.2v2.6M7.2 16.8h5.6M8.2 13.8h3.6" />
    </>
  ),
  table: (
    <>
      <rect {...STROKE} x="3.2" y="4" width="13.6" height="12" rx="2" />
      <path {...STROKE} d="M3.2 8.8h13.6M3.2 12.6h13.6M8 8.8v7.2" />
    </>
  ),
  sport: (
    <>
      <circle {...STROKE} cx="10" cy="10" r="7.4" />
      <path {...STROKE} d="M10 2.6c-3 2.2-3 12.6 0 14.8M10 2.6c3 2.2 3 12.6 0 14.8M2.6 10h14.8" />
    </>
  ),
  "chevron-left": <path {...STROKE} strokeWidth={2} d="M12.4 4.4 6.8 10l5.6 5.6" />,
  "chevron-right": <path {...STROKE} strokeWidth={2} d="m7.6 4.4 5.6 5.6-5.6 5.6" />,
  "chevron-down": <path {...STROKE} strokeWidth={2} d="m4.4 7.6 5.6 5.6 5.6-5.6" />,
  play: <path fill="currentColor" d="M6 3.6v12.8c0 .7.8 1.2 1.4.8l10-6.4c.6-.4.6-1.2 0-1.6l-10-6.4C6.8 2.4 6 2.9 6 3.6z" />,
  stop: <rect fill="currentColor" x="4.5" y="4.5" width="11" height="11" rx="2" />,
  fullscreen: <path {...STROKE} d="M3.4 7.6V3.4h4.2M16.6 7.6V3.4h-4.2M3.4 12.4v4.2h4.2M16.6 12.4v4.2h-4.2" />,
  "fullscreen-exit": <path {...STROKE} d="M7.6 3.4v4.2H3.4M12.4 3.4v4.2h4.2M7.6 16.6v-4.2H3.4M12.4 16.6v-4.2h4.2" />,
  close: <path {...STROKE} strokeWidth={2} d="m5 5 10 10M15 5 5 15" />,
  more: (
    <>
      <circle cx="4.6" cy="10" r="1.6" fill="currentColor" />
      <circle cx="10" cy="10" r="1.6" fill="currentColor" />
      <circle cx="15.4" cy="10" r="1.6" fill="currentColor" />
    </>
  ),
  calendar: (
    <>
      <rect {...STROKE} x="3.2" y="4.4" width="13.6" height="12" rx="2.2" />
      <path {...STROKE} d="M3.2 8.6h13.6M7 2.8v3M13 2.8v3" />
    </>
  ),
  "arrow-up-right": <path {...STROKE} d="M6 14 14 6M7.6 6H14v6.4" />,
  clear: (
    <>
      <circle cx="10" cy="10" r="8" fill="currentColor" />
      <path d="m7.2 7.2 5.6 5.6M12.8 7.2l-5.6 5.6" stroke="var(--bg)" strokeWidth="1.8" strokeLinecap="round" />
    </>
  ),
  sun: (
    <>
      <circle {...STROKE} cx="10" cy="10" r="3.6" />
      <path
        {...STROKE}
        d="M10 2.4v2M10 15.6v2M2.4 10h2M15.6 10h2M4.6 4.6l1.4 1.4M14 14l1.4 1.4M4.6 15.4 6 14M14 6l1.4-1.4"
      />
    </>
  ),
  moon: <path {...STROKE} d="M16.4 12.2A6.8 6.8 0 0 1 7.8 3.6a6.8 6.8 0 1 0 8.6 8.6z" />,
};

export const Icon = ({ name, size = 20, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) => (
  <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden focusable="false" {...rest}>
    {PATHS[name]}
  </svg>
);
