const { stringify } = require('qs')

module.exports = (base, params = {}, script = 'index') => {
  let query = ''
  if (Object.keys(params).length) {
    query = '?' + stringify(params)
  }
  return `${base.replace(
    '/api.php',
    `/${script ? script.trim() : 'index'}.php`
  )}${query}`
}
