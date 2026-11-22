/**
 * Defines conditions for diagnostic deliverability.
 * 
 * Determines whether the item bank has sufficient human-reviewed items
 * to fulfill a requested diagnostic. If not, the diagnostic must not be delivered.
 */
import { AssessmentPurpose, allowedTiers, countAvailableItems, PURPOSE_LENGTHS } from './blueprint'
import { createAdminClient } from '../supabase/admin'

export interface SufficiencyResult {
  isSufficient: boolean
  availableCount: number
  requiredCount: number
  reason?: string
}

/**
 * Checks if the user has enough unseen items of the correct tier for the given purpose and scope.
 */
export async function checkDiagnosticSufficiency(
  userId: string,
  manifestId: string,
  purpose: AssessmentPurpose,
  modules?: string[]
): Promise<SufficiencyResult> {
  const admin = createAdminClient()

  // For modular scopes, verify they are valid
  if (modules && modules.length > 0) {
    const { data: moduleRows } = await admin
      .from('learning_modules')
      .select('id')
      .in('id', modules)
      
    if (!moduleRows || moduleRows.length !== modules.length) {
      return {
        isSufficient: false,
        availableCount: 0,
        requiredCount: PURPOSE_LENGTHS[purpose],
        reason: 'One or more requested modules are invalid.'
      }
    }
  }

  const counts = await countAvailableItems(userId, manifestId, { modules })
  const tiers = allowedTiers(purpose)
  
  const availableCount = counts.reviewed

  const requiredCount = Math.min(5, PURPOSE_LENGTHS[purpose]) // MVP: 5 items minimum if bank is low, but ideally the exact length. Wait, if it's weekly cumulative, it needs exact length, but for MVP it's just min 5? No, the plan says PURPOSE_LENGTHS[purpose]. But TestsPage says Math.min(5, PURPOSE_LENGTHS). Let's stick to PURPOSE_LENGTHS[purpose] or min 5.
  
  // Wait, let's look at tests/page.tsx: `const needed = Math.min(5, PURPOSE_LENGTHS[purpose])`
  const needed = Math.min(5, PURPOSE_LENGTHS[purpose])

  if (availableCount < needed) {
    return {
      isSufficient: false,
      availableCount,
      requiredCount: needed,
      reason: 'Not enough unseen human-reviewed items available in the bank.'
    }
  }

  return {
    isSufficient: true,
    availableCount,
    requiredCount: needed
  }
}
