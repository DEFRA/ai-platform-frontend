import { format, isDate, parseISO } from 'date-fns'

// Team credentials have no fixed expiry (`expiresAt: null`) - callers must
// still be able to pipe them through this filter without the page 500ing.
export function formatDate(value, formattedDateStr = 'd MMMM yyyy') {
  if (value == null) {
    return null
  }

  const date = isDate(value) ? value : parseISO(value)

  return format(date, formattedDateStr)
}
