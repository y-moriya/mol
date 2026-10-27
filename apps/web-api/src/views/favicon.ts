export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <defs>
    <linearGradient id="mol-grad" x1="8" y1="8" x2="56" y2="56" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#34d399" />
      <stop offset="50%" stop-color="#2dd4bf" />
      <stop offset="100%" stop-color="#22d3ee" />
    </linearGradient>
    <radialGradient id="mol-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#10b981" stop-opacity="0.28" />
      <stop offset="100%" stop-color="#020617" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="#090d16" stroke="url(#mol-grad)" stroke-width="2.5" />
  <circle cx="32" cy="32" r="24" fill="url(#mol-glow)" />
  <path d="M16 45 L19 20 L32 34 L45 20 L48 45" stroke="url(#mol-grad)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" />
  <path d="M19 20 L32 13 L45 20" stroke="#34d399" stroke-opacity="0.45" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="3 3" />
  <circle cx="16" cy="45" r="4.5" fill="#34d399" />
  <circle cx="19" cy="20" r="4.5" fill="#34d399" />
  <circle cx="32" cy="13" r="3" fill="#2dd4bf" />
  <circle cx="45" cy="20" r="4.5" fill="#22d3ee" />
  <circle cx="48" cy="45" r="4.5" fill="#22d3ee" />
  <circle cx="32" cy="34" r="5.5" fill="#ffffff" stroke="#10b981" stroke-width="2.5" />
</svg>`;

const FAVICON_ICO_BASE64 =
  "AAABAAEAICAAAAEAIAAMAQAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAgAAAAIAgGAAAAc3p69AAAANNJREFUeJztl7ENgzAQRWlTRKLKAOnTsSBjZJRUGYLMwQogF5Z+nLsYn/nGCE76DYd4T2dZ2E2jVPvqpzWjcajQJBnfvFxv1IgSpeCqREk4StQhUHr8P8uwC4FueJog92HMF3Bwn1S4j1kA4SkSCNckTBN4fN6LBNx7q0wABdxHfWJwisASCexTBEKIBqcKIAwrFKMKuEiFU6Fsw5jAv+2YLRD2NhcIJaQ+XSCWUyBLwPojkuCSRP0TQAkLHCWk518n42Ofiqu4mGx+NavicsqW0TgzHQtVKgjuRuYAAAAASUVORK5CYII=";

export const FAVICON_ICO_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(
  Array.from(atob(FAVICON_ICO_BASE64), (c) => c.charCodeAt(0)),
);
