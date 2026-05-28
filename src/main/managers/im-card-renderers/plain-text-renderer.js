function renderPlainText(value) {
  return typeof value === 'string' ? value : ''
}

module.exports = {
  renderPlainText,
}
