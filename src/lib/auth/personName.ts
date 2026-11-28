export const NAME_ERROR = 'Use letters for your name, with single spaces, hyphens or apostrophes between them.'

// Letters (with their attached marks) in every script, joined by exactly one space, hyphen or apostrophe (straight ' or curly ’).
// Each separator sits between two letters, so leading, trailing and repeated punctuation, digits, markup and invisible characters are refused.
export function normalizePersonName(input: string): string | null {
  const name = input.normalize('NFC').replace(/ +/g, ' ').replace(/^ | $/g, '')
  if (Array.from(name).length > 100 || /\p{Default_Ignorable_Code_Point}/u.test(name)) return null
  return /^\p{L}[\p{L}\p{M}]*(?:[ '’-]\p{L}[\p{L}\p{M}]*)*$/u.test(name) ? name : null
}
