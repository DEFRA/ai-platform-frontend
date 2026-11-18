/**
 * A select's items: the first says "all", then the choices, and a value that
 * is asked for but not on the list still shows, so the form says what was
 * asked.
 * @param {object} options
 * @param {string} options.all - What the first item, with no value, says.
 * @param {Array<{value: string, text: string}>} options.choices
 * @param {string} options.selected - The value asked for, or ''.
 * @param {(value: string) => string} options.unknownText - What a value not on the list says.
 * @returns {Array<{value: string, text: string, selected: boolean}>}
 */
export function selectItems({ all, choices, selected, unknownText }) {
  const known = choices.some(({ value }) => value === selected)
  const extra =
    selected && !known ? [{ value: selected, text: unknownText(selected) }] : []

  return [{ value: '', text: all }, ...choices, ...extra].map((item) => ({
    ...item,
    selected: item.value === selected
  }))
}
