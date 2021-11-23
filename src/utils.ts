const Mwbot = require('mwbot')

export function getBot(session) {
  const apiUrl = session?.channel?.mwApi || ''
  if (!apiUrl) return null
  return new Mwbot({
    apiUrl,
  })
}

export function getUrl(base, params = {}, script = 'index') {
  let query = ''
  if (Object.keys(params).length) {
    query = '?' + new URLSearchParams(params)
  }
  return `${base.replace(
    '/api.php',
    `/${script ? script.trim() : 'index'}.php`
  )}${query}`
}

export function isValidApi(api) {
  let url
  try {
    url = new URL(api)
  } catch (err) {
    return false
  }
  const { protocol, pathname } = url
  if (protocol.startsWith('http') && pathname.endsWith('/api.php')) {
    return true
  }
  return false
}

export function resolveBrackets(str) {
  return str
    .replace(new RegExp('&#91;', 'g'), '[')
    .replace(new RegExp('&#93;', 'g'), ']')
}
