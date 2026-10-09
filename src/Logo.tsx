/**
 * The slop.cash mark: a dripping S inside a square tile. The default tile is
 * orange with a black mark; `inverse` swaps them for use on orange surfaces.
 */
export function SlopMark({
  size = 36,
  inverse = false,
}: {
  size?: number;
  inverse?: boolean;
}) {
  const tile = inverse ? "#0f0e0c" : "#ff5a19";
  const ink = inverse ? "#ff5a19" : "#0f0e0c";
  return (
    <svg
      aria-hidden="true"
      className="slop-mark"
      focusable="false"
      height={size}
      viewBox="0 0 64 64"
      width={size}
    >
      <rect fill={tile} height="64" rx="6" width="64" />
      <g transform="translate(4.5 4) scale(0.86)">
        <path
          d="M44 18C40 12 22 11 21 22C20 32 44 31 43 42C42 53 24 53 19 46"
          fill="none"
          stroke={ink}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="9"
        />
        <path
          d="M16 46h6v9a3 3 0 0 1-6 0ZM25 51h6v7a3 3 0 0 1-6 0ZM34.5 49.5h5v5.5a2.5 2.5 0 0 1-5 0ZM41 18h6v10a3 3 0 0 1-6 0ZM28.9 13.6h5v6.5a2.5 2.5 0 0 1-5 0Z"
          fill={ink}
        />
      </g>
    </svg>
  );
}

export function Wordmark({ domain }: { domain: string }) {
  const dot = domain.indexOf(".");
  if (dot < 0) return <>{domain}</>;
  return (
    <>
      {domain.slice(0, dot)}
      <span className="wordmark-dot">.</span>
      {domain.slice(dot + 1)}
    </>
  );
}
