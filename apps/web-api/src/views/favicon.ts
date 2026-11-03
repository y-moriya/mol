export const FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect x="2" y="2" width="60" height="60" rx="12" fill="#0b0d14" stroke="#eef0f5" stroke-opacity="0.12" stroke-width="2" />
  <path d="M16 45 L21 19 L32 35 L43 19 L48 45" stroke="#eef0f5" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" />
  <circle cx="32" cy="35" r="4.5" fill="#4cc38a" />
</svg>`;

const FAVICON_ICO_BASE64 =
  "AAABAAEAICAAAAEAIAAMAQAAFgAAAIlQTkcNChoKAAAADUlIRFIAAAAgAAAAIAgGAAAAc3p69AAAANNJREFUeJztl7ENgzAQRWlTRKLKAOnTsSBjZJRUGYLMwQogF5Z+nLsYn/nGCE76DYd4T2dZ2E2jVPvqpzWjcajQJBnfvFxv1IgSpeCqREk4StQhUHr8P8uwC4FueJog92HMF3Bwn1S4j1kA4SkSCNckTBN4fN6LBNx7q0wABdxHfWJwisASCexTBEKIBqcKIAwrFKMKuEiFU6Fsw5jAv+2YLRD2NhcIJaQ+XSCWUyBLwPojkuCSRP0TQAkLHCWk518n42Ofiqu4mGx+NavicsqW0TgzHQtVKgjuRuYAAAAASUVORK5CYII=";

export const FAVICON_ICO_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(
  Array.from(atob(FAVICON_ICO_BASE64), (c) => c.charCodeAt(0)),
);
