/**
 * Deterministic format gates for a three-option Level I item. These are structural facts a computer can establish; they say nothing
 * about whether the finance is right. They test the QUESTION'S LEAD-IN (its final sentence) and the OPTIONS, never the whole stem, so a
 * legitimate "net loss was not recognised" in a scenario, a negative number, or a standards term such as "not-for-profit" is not flagged.
 */
export type FormatDefect = { code: string; detail: string; blocking: boolean }

const lastSentence = (stem: string) => {
  const parts = stem.trim().replace(/\s+/g, ' ').split(/(?<=[.?!:])\s+(?=[A-Z"(])/)
  return parts[parts.length - 1] ?? stem
}

const COMPOUND = /^(all|none|both|neither)\s+of\s+the\s+(above|following|these)\b|^(a|b|c)\s*(and|&|,)\s*(b|c)\b|^(both|either)\s+(a|b|c)\b/i
const BARE_TRUE_FALSE = /^(true|false|yes|no|correct|incorrect)\.?$/i

/** Numeric value of an option for the ordering check only; NaN when it is not a plain number. */
const orderingValue = (o: string) => {
  const neg = /^\s*[-−–]|^\s*\$?\s*\(.*\)/.test(o)
  const d = o.replace(/[^0-9.]/g, '')
  const v = d === '' || d === '.' ? NaN : parseFloat(d)
  return neg ? -v : v
}

export function checkItemFormat(stem: string, options: string[]): FormatDefect[] {
  const out: FormatDefect[] = []
  const lead = lastSentence(stem)

  if (/\bexcept\b/i.test(lead) || /\ball of the following\b[^.?]*\b(except|but)\b/i.test(lead)) {
    out.push({ code: 'FORMAT_EXCEPT', detail: 'The question uses an "except" construction. Ask which option is "most likely" or "least likely" instead.', blocking: false })
  }
  // A bare negative in the QUESTION ("Which of the following is not ...") hides the task; "least likely" is the permitted form.
  if (/\bwhich\b[^.?]*\b(is|are|does|do|would|will|can)\s+not\b/i.test(lead) || /\bwhich\b[^.?]*\b(false|incorrect|untrue|wrong)\b/i.test(lead)) {
    out.push({ code: 'FORMAT_NEGATIVE_LEAD_IN', detail: 'The lead-in asks which statement is "not" true/false or incorrect. Use "least likely" or "most likely".', blocking: false })
  }
  if (/\bwhich\b[^.?]*\b(true|false)\b/i.test(lead) && !/\b(most|least)\s+likely\b/i.test(lead)) {
    out.push({ code: 'FORMAT_TRUE_FALSE', detail: 'The lead-in is a true/false template. Ask for the best answer, not for truth values.', blocking: false })
  }
  if (options.filter(o => BARE_TRUE_FALSE.test(o.trim())).length >= 2) {
    out.push({ code: 'FORMAT_TRUE_FALSE', detail: 'The options are truth values rather than three alternative answers.', blocking: true })
  }
  if (options.some(o => COMPOUND.test(o.trim()))) {
    out.push({ code: 'FORMAT_COMPOUND_OPTION', detail: 'An option refers to other options ("all of the above", "A and B"). Each option must stand alone.', blocking: true })
  }
  const lengths = options.map(o => o.trim().length)
  const numeric = options.map(orderingValue)
  if (numeric.every(Number.isFinite)) {
    const asc = numeric.every((v, i, a) => i === 0 || v >= a[i - 1]), desc = numeric.every((v, i, a) => i === 0 || v <= a[i - 1])
    if (!asc && !desc) out.push({ code: 'FORMAT_NUMERIC_ORDER', detail: 'Numeric options must be in ascending or descending order.', blocking: false })
  } else if (numeric.some(Number.isFinite) && !numeric.every(Number.isFinite)) {
    out.push({ code: 'FORMAT_MIXED_OPTION_TYPES', detail: 'Some options are numbers and some are words.', blocking: false })
  } else if (Math.max(...lengths) > 3 * Math.max(Math.min(...lengths), 8)) {
    out.push({ code: 'FORMAT_OPTION_LENGTH', detail: 'One option is more than three times as long as another, which gives the answer away.', blocking: false })
  }
  if (!/[?:]\s*$|_{3,}\s*$|\.\s*$/.test(stem.trim())) {
    out.push({ code: 'FORMAT_NO_QUESTION', detail: 'The stem does not end in a question, a colon or a blank to complete.', blocking: false })
  }
  return out
}
