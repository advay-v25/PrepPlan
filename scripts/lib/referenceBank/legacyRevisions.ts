import type { BankItem } from '../bankLoader'
/** Revisions are copied into a new draft namespace; original legacy files/versions are preserved. */
export function reviseLegacy(item: BankItem): BankItem {
  const r = structuredClone(item)
  if (r.o === 'r027-b' && r.t === 'H') r.q = 'Which description of responsibilities in financial reporting is least accurate?'
  if (r.o === 'r036-c' && r.t === 'H') r.q = 'Which accounting choice is least likely to make current-period reporting aggressive?'
  if (r.o === 'r093-g' && r.t === 'H') r.q = 'Which statement about the relationship between ethical and legal standards is least accurate?'
  if (r.o === 'r094-a' && r.t === 'H') r.q = 'Which situation is least likely, by itself, to initiate a Professional Conduct Program investigation?'
  if (r.o === 'r028-e' && r.t === 'H') {
    r.ok = r.ok!.replace('4', 'four')
    r.w = r.w.map(w => [w[0].replace('4', 'four'), w[1], w[2]])
  }
  if (r.o === 'r029-a' && r.t === 'H') r.w[0][0] = r.w[0][0].replace('40', 'forty')
  if (r.o === 'r099-c' && r.t === 'E') {
    r.ok = 'For a minimum of seven years'
    r.w[0][0] = 'For just one year after the report'
    r.w[1][0] = 'Until the recommendation is distributed'
  }
  if (r.o === 'r101-b' && r.t === 'M') r.w[0][0] = r.w[0][0].replace('2028', 'the projected year')
  return r
}
