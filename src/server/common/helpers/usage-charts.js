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
const MAX_LABELS = 15
const GRID_INTERVALS = 4
const TICK_GAP = 6
const TICK_DROP = 4
const LABEL_RISE = 12
const MARKER_GAP = 6
const HUNDRED = 100
const TEN = 10
// Tidy multiples of a power of ten, as a fraction of it.
const NICE_STEPS = '1 2 2.5 5 10'.split(' ').map(Number)

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
  return Math.round(value * HUNDRED) / HUNDRED
}

/**
 * A round upper bound for an axis, so the gridlines fall on tidy numbers.
 * @param {number} value
 * @returns {number}
 */
export function niceMax(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }

  const magnitude = TEN ** Math.floor(Math.log10(value))
  const fraction = value / magnitude
  const step = NICE_STEPS.find((candidate) => fraction <= candidate)

  return step * magnitude
}

function gridOf({ top, y, format }) {
  return Array.from(
    { length: GRID_INTERVALS + 1 },
    (_, index) => index / GRID_INTERVALS
  )
    .map((share) => {
      const value = top * share
      const lineY = round(y(value))

      return `<line class="app-chart__grid" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${lineY}" y2="${lineY}"/><text class="app-chart__tick" x="${LEFT - TICK_GAP}" y="${lineY + TICK_DROP}" text-anchor="end">${escapeHtml(format(value))}</text>`
    })
    .join('')
}

function markerOf(marker, y) {
  if (!marker) {
    return ''
  }

  const markerY = round(y(marker.value))

  return `<line class="app-chart__marker" x1="${LEFT}" x2="${WIDTH - RIGHT}" y1="${markerY}" y2="${markerY}"/><text class="app-chart__marker-label" x="${LEFT + MARKER_GAP}" y="${markerY - MARKER_GAP}">${escapeHtml(marker.label)}</text>`
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
  const labelEvery = Math.max(1, Math.ceil(categories.length / MAX_LABELS))
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
          ? `<text class="app-chart__label" x="${round(x + barWidth / 2)}" y="${HEIGHT - LABEL_RISE}" text-anchor="middle">${escapeHtml(category.label)}</text>`
          : ''

      return rects.join('') + text
    })
    .join('')

  return `<svg class="app-chart" viewBox="0 0 ${WIDTH} ${HEIGHT}" role="img" aria-label="${escapeHtml(label)}. The same figures are in the table below.">${gridOf({ top, y, format })}${bars}${markerOf(marker, y)}</svg>`
}

const RADIUS = 40
const CIRCUMFERENCE = 2 * Math.PI * RADIUS
const CENTRE = 50
const RING_WIDTH = 14
const FIGURE_Y = 54
const CAPTION_Y = 63
const BAR_HEIGHT = 4

/**
 * A horizontal bar filled to a share of its length, for a figure against its
 * limit. The fill takes the colour of a chart series, or of a class a page
 * styles itself.
 * @param {{label: string, share: number, series?: number, className?: string}} options - `share` is 0 to 1; `label` says it in words.
 * @returns {string} Markup, safe to put in a page.
 */
export function progressBar({ label, share, series = 0, className }) {
  const filled = round(Math.min(Math.max(share, 0), 1) * HUNDRED)

  return `<svg class="app-bar" viewBox="0 0 ${HUNDRED} ${BAR_HEIGHT}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(label)}"><rect class="app-bar__track" width="${HUNDRED}" height="${BAR_HEIGHT}"/><rect class="${className ?? seriesClass(series)}" width="${filled}" height="${BAR_HEIGHT}"/></svg>`
}

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
            const arc = `<circle class="${seriesClass(part.series)}" cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}" fill="none" stroke-width="${RING_WIDTH}" stroke-dasharray="${round(length)} ${round(CIRCUMFERENCE - length)}" stroke-dashoffset="${round(-offset)}" transform="rotate(-90 ${CENTRE} ${CENTRE})"/>`

            offset += length

            return arc
          })
          .join('')
      : ''
  const figureY = caption ? CENTRE : FIGURE_Y
  const captionText = caption
    ? `<text class="app-donut__caption" x="${CENTRE}" y="${CAPTION_Y}" text-anchor="middle">${escapeHtml(caption)}</text>`
    : ''

  return `<svg class="app-donut" viewBox="0 0 ${HUNDRED} ${HUNDRED}" role="img" aria-label="${escapeHtml(label)}. The same figures are in the table beside it."><circle class="app-donut__track" cx="${CENTRE}" cy="${CENTRE}" r="${RADIUS}" fill="none" stroke-width="${RING_WIDTH}"/>${arcs}<text class="app-donut__centre" x="${CENTRE}" y="${figureY}" text-anchor="middle">${escapeHtml(centre)}</text>${captionText}</svg>`
}
