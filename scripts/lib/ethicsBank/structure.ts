/** Ethics outcome structure (readings r093–r102). Edit here; re-run scripts/seed-ethics-structure.ts. */
type L = [code: string, title: string, page: number]
export const ETHICS: { id: string; no: string; title: string; los: L[] }[] = [
  { id: 'r093', no: '1.1', title: 'Ethics and Trust in the Investment Profession', los: [
    ['a', 'Explain what ethics is and how it differs from personal opinion', 4],
    ['b', 'Describe what a code of ethics and standards of conduct do for a profession', 7],
    ['c', 'Describe what makes an occupation a profession and how professions earn trust', 8],
    ['d', 'Explain why high ethical standards matter especially in investment management', 11],
    ['e', 'Explain what professionalism means in investment management', 10],
    ['f', 'Identify the challenges that make ethical behavior difficult', 13],
    ['g', 'Contrast ethical standards with legal standards', 15],
    ['h', 'Describe a framework for ethical decision-making', 18],
  ] },
  { id: 'r094', no: '2.1', title: 'Code of Ethics and Standards of Professional Conduct', los: [
    ['a', 'Describe how the Professional Conduct Program enforces the Code and Standards', 37],
    ['b', 'Identify the six components of the Code of Ethics and the seven Standards', 43],
    ['c', 'Explain the responsibilities each Standard and sub-section imposes', 44],
  ] },
  { id: 'r095', no: '3.1', title: 'Guidance for Standard I: Professionalism', los: [
    ['a', 'Apply Standard I(A) Knowledge of the Law', 54],
    ['b', 'Apply Standard I(B) Independence and Objectivity', 61],
    ['c', 'Apply Standard I(C) Misrepresentation', 70],
    ['d', 'Apply Standard I(D) Misconduct', 82],
    ['e', 'Apply Standard I(E) Competence', 86],
  ] },
  { id: 'r096', no: '4.1', title: 'Guidance for Standard II: Integrity of Capital Markets', los: [
    ['a', 'Apply Standard II(A) Material Nonpublic Information', 96],
    ['b', 'Apply Standard II(B) Market Manipulation', 105],
  ] },
  { id: 'r097', no: '5.1', title: 'Guidance for Standard III: Duties to Clients', los: [
    ['a', 'Apply Standard III(A) Loyalty, Prudence, and Care', 116],
    ['b', 'Apply Standard III(B) Fair Dealing', 125],
    ['c', 'Apply Standard III(C) Suitability', 133],
    ['d', 'Apply Standard III(D) Performance Presentation', 140],
    ['e', 'Apply Standard III(E) Preservation of Confidentiality', 143],
  ] },
  { id: 'r098', no: '6.1', title: 'Guidance for Standard IV: Duties to Employers', los: [
    ['a', 'Apply Standard IV(A) Loyalty', 158],
    ['b', 'Apply Standard IV(B) Additional Compensation Arrangements', 165],
    ['c', 'Apply Standard IV(C) Responsibilities of Supervisors', 168],
  ] },
  { id: 'r099', no: '7.1', title: 'Guidance for Standard V: Investment Analysis, Recommendations, and Actions', los: [
    ['a', 'Apply Standard V(A) Diligence and Reasonable Basis', 182],
    ['b', 'Apply Standard V(B) Communication with Clients and Prospective Clients', 191],
    ['c', 'Apply Standard V(C) Record Retention', 201],
  ] },
  { id: 'r100', no: '8.1', title: 'Guidance for Standard VI: Conflicts of Interest', los: [
    ['a', 'Apply Standard VI(A) Avoid or Disclose Conflicts', 208],
    ['b', 'Apply Standard VI(B) Priority of Transactions', 213],
    ['c', 'Apply Standard VI(C) Referral Fees', 217],
  ] },
  { id: 'r101', no: '9.1', title: 'Guidance for Standard VII: Responsibilities as a CFA Institute Member or CFA Candidate', los: [
    ['a', 'Apply Standard VII(A) Conduct as Participants in CFA Institute Programs', 224],
    ['b', 'Apply Standard VII(B) Reference to CFA Institute, the CFA Designation, and the CFA Program', 229],
  ] },
  { id: 'r102', no: '10.1', title: 'Application of the Code and Standards: Level I', los: [
    ['a', 'Evaluate a practice, policy, or piece of conduct against the Code and Standards', 238],
    ['b', 'Explain how and why conduct does or does not violate the Code and Standards, and what would conform', 238],
  ] },
]

