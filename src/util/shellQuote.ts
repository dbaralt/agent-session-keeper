/**
 * POSIX shell quoting for values interpolated into command templates.
 *
 * Values that are clearly a single safe token are returned unchanged; anything
 * else is wrapped in single quotes with embedded quotes escaped, so a crafted
 * session id or title can never smuggle `;`, `$()`, backticks or newlines into
 * a command the extension runs in the user's shell.
 */
const SAFE_TOKEN = /^[A-Za-z0-9._/@%+=:,./-]+$/;

export function shellQuote(value: string): string {
  if (value.length === 0) return "''";
  if (SAFE_TOKEN.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
