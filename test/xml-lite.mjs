/**
 * 极简 XML 标签平衡校验（零依赖）：只做"标签配对"这一件事，够用来抓本轮的真实缺陷
 * （非贪婪正则插入导致 `<g>` 未闭合 / 多闭合）。属性里的 `>` 用引号状态跳过。
 */
export function XMLParser(src) {
  const stack = []
  const re = /<(\/?)([A-Za-z_][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let m
  let sawRoot = false
  while ((m = re.exec(src))) {
    const [, closing, name, , selfClose] = m
    if (name === '?xml' || name.startsWith('!')) continue
    if (!sawRoot && !closing) sawRoot = true
    if (selfClose) continue
    if (closing) {
      const top = stack.pop()
      if (top !== name) throw new Error(`mismatch: </${name}> closes <${top ?? 'nothing'}>`)
    } else {
      stack.push(name)
    }
  }
  if (stack.length) throw new Error(`unclosed: <${stack.join('>, <')}>`)
  if (!sawRoot) throw new Error('no root element')
  return true
}
