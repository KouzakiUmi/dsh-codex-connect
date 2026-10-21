import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { mathFromMarkdown } from 'mdast-util-math'
import { math, mathHtml, type HtmlOptions } from 'micromark-extension-math'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const mathRequire = createRequire(require.resolve('micromark-extension-math'))
const nestedKatex = mathRequire('katex') as typeof import('katex')
const directKatex = require('katex') as typeof import('katex')
const markdownRequire = createRequire(require.resolve('mdast-util-from-markdown'))
const { micromark } = await import(pathToFileURL(markdownRequire.resolve('micromark')).href) as {
  micromark(source: string, options: {
    extensions: ReturnType<typeof math>[]
    htmlExtensions: ReturnType<typeof mathHtml>[]
  }): string
}

function render(source: string, options?: HtmlOptions): string {
  return micromark(source, { extensions: [math()], htmlExtensions: [mathHtml(options)] })
}

// Exercise the actual overridden consumer, not only the separate direct KaTeX copy.
describe('math extension dependency compatibility and trust boundary', () => {
  it('resolves the existing patched direct renderer from the math extension', () => {
    expect(nestedKatex.version).toBe(directKatex.version)
    const [major = 0, minor = 0, patch = 0] = nestedKatex.version.split('.').map(Number)
    expect(major > 0 || minor > 18 || (minor === 18 && patch >= 2)).toBe(true)
  })

  it.each([
    ['Inline $x^2 + y^2$ text', 'math-inline', 'x^2 + y^2'],
    ['$$\n\\frac{1}{2}\n$$', 'math-display', '\\frac{1}{2}'],
  ])('renders inline and display math through the extension (%#)', (source, mode, expression) => {
    const html = render(source)
    expect(html).toContain(mode)
    expect(html).toContain('class="katex')
    expect(html).toContain('encoding="application/x-tex"')
    expect(html).toContain(expression)
  })

  it('retains macro options without sharing mutations between renders', () => {
    const html = render('$\\RR$', { macros: { '\\RR': '\\mathbb{R}' } })
    expect(html).toContain('class="katex')
    expect(html).not.toContain('katex-error')
    expect(() => render('$\\RR$')).toThrow()
  })

  it('retains strict errors and escaped nonthrowing error output', () => {
    expect(() => render('$\\unknowncommand$')).toThrow()
    const html = render('$\\frac{1}{ <tag>$', { throwOnError: false })
    expect(html).toContain('katex-error')
    expect(html).toContain('&lt;tag&gt;')
    expect(html).not.toContain('<tag>')
  })

  it('keeps trusted link rendering explicit with a harmless nonresolving URL', () => {
    const source = '$\\href{https://example.invalid/math}{x}$'
    expect(render(source)).not.toContain('href="https://example.invalid/math"')
    expect(render(source, { trust: false })).not.toContain('href="https://example.invalid/math"')
    expect(render(source, { trust: true })).toContain('href="https://example.invalid/math"')
  })

  it('does not inherit trust from a renderer options prototype', () => {
    // No global prototype mutation, HTML insertion, network request or executable URL.
    const options = Object.create({ trust: true }) as import('katex').KatexOptions
    const html = nestedKatex.renderToString('\\href{https://example.invalid/math}{x}', options)
    expect(html).not.toContain('href="https://example.invalid/math"')
  })

  it('preserves markdown math AST values alongside ordinary text', () => {
    const tree = fromMarkdown('Before $x^2$ after\n\n$$\n\\frac{1}{2}\n$$', {
      extensions: [math()], mdastExtensions: [mathFromMarkdown()],
    })
    expect(tree.children[0]).toMatchObject({ type: 'paragraph', children: [
      { type: 'text', value: 'Before ' },
      { type: 'inlineMath', value: 'x^2' },
      { type: 'text', value: ' after' },
    ] })
    expect(tree.children[1]).toMatchObject({ type: 'math', value: '\\frac{1}{2}' })
  })
})
