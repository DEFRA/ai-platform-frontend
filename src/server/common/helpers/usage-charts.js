// Charts as server-rendered SVG, so they need no script and no inline style (the
// content security policy allows neither): colours come from classes, sizes from
// attributes. Every chart is paired with a table in the page, which is what a
// screen reader gets.

const WIDTH = 760
const HEIGHT = 300
const LEFT = 56
const RIGHT = 8
const TOP = 16
const BOTTOM = 34
const GAP_RATIO = 0.25
const SERIES_CLASSES = 6

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function seriesClass(index) {
  return `app-chart__s${index % SERIES_CLASSES}`
}

function round(value) {
  return Math.round(value * 100) / 100
}

/**
 * A round upper bound for an axis, so the gridlines fall on tidy numbers.
 * @param {number} value
 * @returns {number}
 */
export function niceMax(value) {
  if (!(value > 0)) {
    return 1
  }

  const magnitude = 10 ** Math.floor(Math.log10(value))
  const fraction = value / magnitude
  const step = [1, 2, 2.5, 5, 10].find((candidate) => fraction <= candidate)

  return step * magnitude
}

/**
 * Bars for a few categories, each stacked from its parts, with an optional
 * pale cap on top for a forecast.
 * @param {{label: string, categories: Array<{label: string, parts: Array<{series: number, value: number}>, forecast?: number}>, format: (value: number) => string, marker?: {value: number, label: string}}} options
 * @returns {string} Markup, safe to put in a page.
 */
export function stackedBars({ label, categories, format, marker }) {
  const totals = categories.map(
    (category) =>
      category.parts.reduce((sum, part) => sum + part.value, 0) +
      (category.forecast ?? 0)
  )
  const top = niceMax(Math.max(0, ...totals, marker?.value ?? 0))
  const plotWidth = WIDTH - LEFT - RIGHT
  const plotHeight = HEIGHT - TOP - BOTTOM
  const slot = plotWidth / Math.max(categories.length, 1)
  const barWidth = slot * (1 - GAP_RATIO)
  const y = (value) => TOP + plotHeight - (value / top) * plotHeight
  const labelEvery = Math.max(1, Math.ceil(categories.length / 15))
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((share) => {
      const value = top * share
      const line = round(y(value))

      return `<line class="app-chart__grid" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${line}" y2="${line}"/><text class="app-chart__tick" x="${LEFT - 6}" y="${line + 4}" text-anchor="end">${escapeHtml(format(value))}</text>`
    })
    .join('')
  const bars = categories
    .map((category, index) => {
      const x = LEFT + slot * index + (slot - barWidth) / 2
      let stacked = 0
      const rects = category.parts
        .filter((part) => part.value > 0)
        .map((part) => {
          const rect = `<rect class="${seriesClass(part.series)}" x="${round(x)}" y="${round(y(stacked + part.value))}" width="${round(barWidth)}" height="${round(y(stacked) - y(stacked + part.value))}"/>`

          stacked += part.value

          return rect
        })

      if (category.forecast > 0) {
        rects.push(
          `<rect class="app-chart__forecast" x="${round(x)}" y="${round(y(stacked + category.forecast))}" width="${round(barWidth)}" height="${round(y(stacked) - y(stacked + category.forecast))}"/>`
        )
      }

      const text =
        index % labelEvery === 0
          ? `<text class="app-chart__label" x="${round(x + barWidth / 2)}" y="${HEIGHT - 12}" text-anchor="middle">${escapeHtml(category.label)}</text>`
          : ''

      return rects.join('') + text
    })
    .join('')
  const line = marker
    ? `<line class="app-chart__marker" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${round(y(marker.value))}" y2="${round(y(marker.value))}"/><text class="app-chart__marker-label" x="${LEFT + 6}" y="${round(y(marker.value)) - 6}">${escapeHtml(marker.label)}</text>`
    : ''

  return `<svg class="app-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeHtml(label)}. The same figures are in the table below.">${grid}${bars}${line}</svg>`
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * A ring split into parts, with a figure in the middle.
 * @param {{label: string, parts: Array<{series: number, value: number}>, centre: string, caption?: string}} options
 * @returns {string} Markup, safe to put in a page.
 */
export function donut({ label, parts, centre, caption = '' }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  let offset = 0
  const arcs =
    total > 0
      ? parts
          .filter((part) => part.value > 0)
          .map((part) => {
            const length = (part.value / total) * CIRCUMFERENCE
            const arc = `<circle class="${seriesClass(part.series)}" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="14" stroke-dasharray="${round(length)} ${round(CIRCUMFERENCE - length)}" stroke-dashoffset="${round(-offset)}" transform="rotate(-90 50 50)"/>`

            offset += length

            return arc
          })
          .join('')
      : ''

  return `<svg class="app-donut" viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(label)}. The same figures are in the table beside it."><circle class="app-donut__track" cx="50" cy="50" r="${RADIUS}" fill="none" stroke-width="14"/>${arcs}<text class="app-donut__centre" x="50" y="${caption ? 50 : 54}" text-anchor="middle">${escapeHtml(centre)}</text>${caption ? `<text class="app-donut__caption" x="50" y="63" text-anchor="middle">${escapeHtml(caption)}</text>` : ''}</svg>`
}
