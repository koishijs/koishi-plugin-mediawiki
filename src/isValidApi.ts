module.exports = api => {
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
