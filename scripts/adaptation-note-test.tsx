/** The pace sentence the student reads: a labelled assumption below four finished readings with reported time, an observed figure after. */
import { renderToStaticMarkup } from 'react-dom/server'
import { AdaptationNote } from '../src/components/review/AdaptationNote'
import { makeCheck } from './lib/e2eSession'

const { check, finish } = makeCheck()
const base: any = { mode: 'opening', factor: 0.6, committed: 0.6, headline: 'Standard opening load.', reasons: ['First week.'], usedCycles: 0, setAside: 0, lighter: false, waiting: [], optionalMinutes: 0, reconciliation: null }
const text = (pace: any) => renderToStaticMarkup(AdaptationNote({ adaptation: { ...base, pace } } as any) as any).replace(/<!-- -->/g, '')

const few = text({ source: 'assumption', minutesPerEffortUnit: 85, observedModules: 2, needed: 4 })
check('below four readings it is called a planning assumption', few.includes('planning assumption of 85 minutes') && few.includes('2 so far') && !few.includes('from time you reported'))
check('and says reporting time is optional', few.includes('Reporting time is optional'))
const enough = text({ source: 'observed', minutesPerEffortUnit: 62, observedModules: 5, needed: 4 })
check('with enough reported time it shows the observed estimate and its basis', enough.includes('about 62 minutes per unit of effort, from time you reported on finished readings') && !enough.includes('planning assumption of'))
check('it never calls pace a measure of understanding', !/understand(ing)? (is|of)/i.test(enough + few))
finish()
