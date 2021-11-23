module.exports = (base, params = {}, script = 'index') => {
  let query = ''
  if (Object.keys(params).length) {
    query = '?' + new URLSearchParams(params)
  }
  return `${base.replace(
    '/api.php',
    `/${script ? script.trim() : 'index'}.php`
  )}${query}`
}
