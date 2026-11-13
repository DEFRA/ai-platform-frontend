// The reason an admin gives for disabling or revoking credentials (plan D12):
// one rule, 1 to 500 characters after trimming, the same the backend checks.
// It is saved in the audit log and nowhere else, so it is never logged here.

export const MAX_REASON_LENGTH = 500

/**
 * Reads the reason a form came with.
 * @param {unknown} value - What the form's field held.
 * @returns {{reason?: string, error?: string, text: string}} The reason to
 *   send, or what is wrong with it, and the text to show again as typed.
 */
export function readReason(value) {
  const text = typeof value === 'string' ? value : ''
  // A browser posts a new line as two characters; the page counts one.
  const reason = text.replaceAll('\r\n', '\n').trim()

  if (reason.length === 0) {
    return { error: 'Enter a reason', text }
  }

  if (reason.length > MAX_REASON_LENGTH) {
    return {
      error: `Reason must be ${MAX_REASON_LENGTH} characters or fewer`,
      text
    }
  }

  return { reason, text }
}
