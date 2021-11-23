import { Session } from 'koishi-core';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Mwbot = require('mwbot');

const MOCK_HEADER = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36 Edg/92.0.902.78',
};
const USE_MOCK_HEADER = ['huijiwiki.com'];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBot(session: Session<never, 'mwApi'>): any {
  const apiUrl = session?.channel?.mwApi || '';
  if (!apiUrl) return null;

  const bot = new Mwbot({ apiUrl });
  if (USE_MOCK_HEADER.some((sub) => apiUrl.includes(sub)))
    bot.globalRequestOptions.headers = MOCK_HEADER;
  return bot
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
