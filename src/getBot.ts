const Mwbot = require('mwbot')

module.exports = session => {
  const apiUrl = session?.channel?.mwApi || ''
  if (!apiUrl) return null
  return new Mwbot({
    apiUrl,
  })
}
