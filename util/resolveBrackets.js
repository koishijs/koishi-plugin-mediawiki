module.exports = str =>
  str
    .replace(new RegExp('&#91;', 'g'), '[')
    .replace(new RegExp('&#93;', 'g'), ']')
