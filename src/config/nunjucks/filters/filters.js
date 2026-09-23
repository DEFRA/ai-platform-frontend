import { formatDate } from './format-date.js'
import { formatCurrency } from './format-currency.js'

function assign(object, ...sources) {
  return Object.assign(object, ...sources)
}

export { assign, formatDate, formatCurrency }
