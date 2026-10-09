import { formatDate } from './format-date.js'
import { formatCurrency } from './format-currency.js'
import { formatLabel, formatLabelList, formatDataZone } from './format-label.js'

function assign(object, ...sources) {
  for (const source of sources) {
    if (source == null) {
      continue
    }

    for (const key of Object.keys(source)) {
      if (key === '__proto__') {
        Object.defineProperty(object, key, {
          value: source[key],
          writable: true,
          enumerable: true,
          configurable: true
        })
        continue
      }

      object[key] = source[key]
    }
  }

  return object
}

export {
  assign,
  formatDate,
  formatCurrency,
  formatLabel,
  formatLabelList,
  formatDataZone
}
