// Resolves an app-relative path against Vite's base URL, so one build works at
// the domain root (dev server, LAN player) and under a sub-path (hosted demo).
// Outside Vite, for example in node tests, the base falls back to "/".
const BASE_URL = import.meta.env?.BASE_URL ?? '/';

export function appUrl(path) {
  return `${BASE_URL}${String(path).replace(/^\/+/, '')}`;
}
