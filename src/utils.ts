import { Session } from 'koishi-core';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mwbot = require('mwbot');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBot(session: Session<never, 'mwApi'>): any {
  const apiUrl = session?.channel?.mwApi || '';
  if (!apiUrl) return null;
  return new Mwbot({
    apiUrl,
  });
}

export function getUrl(base: string, params = {}, script = 'index'): string {
  let query = '';
  if (Object.keys(params).length) {
    query = '?' + new URLSearchParams(params);
  }
  return `${base.replace(
    '/api.php',
    `/${script ? script.trim() : 'index'}.php`,
  )}${query}`;
}

export function isValidApi(api: string | URL): boolean {
  let url: URL;
  try {
    url = new URL(api);
  } catch (err) {
    return false;
  }
  const { protocol, pathname } = url;
  if (protocol.startsWith('http') && pathname.endsWith('/api.php')) {
    return true;
  }
  return false;
}

export function resolveBrackets(str: string): string {
  return str
    .replace(new RegExp('&#91;', 'g'), '[')
    .replace(new RegExp('&#93;', 'g'), ']');
}
