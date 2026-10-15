/**
 * Phase 0 Curriculum Capability Registry
 * 
 * Defines the initial supported slice of the CFA Level I curriculum.
 * A module must be registered here to be considered "supported" for
 * diagnostic tests, exact source mapping, and specialized coaching.
 */

export interface CurriculumCapability {
  hasReviewedDiagnostics: boolean;
  hasStudyGuidance: boolean;
  hasLiveGeneration: boolean;
  hasExplanationRubric: boolean;
}

export interface LearningModuleRegistryEntry {
  id: string; // Internal stable ID
  topicId: string; // e.g. "FSA"
  name: string;
  sourceReference: string; // e.g. "2027 CFAI Curriculum, Volume 3"
  reviewStatus: 'draft' | 'reviewed' | 'provisional';
  capabilities: CurriculumCapability;
}

export const FSA_REGISTRY: Record<string, LearningModuleRegistryEntry> = {
  'fsa-intro': {
    id: 'fsa-intro',
    topicId: 'FSA',
    name: 'Introduction to Financial Statement Analysis',
    sourceReference: '2027 CFAI Curriculum, Volume 3, Module 1',
    reviewStatus: 'reviewed',
    capabilities: {
      hasReviewedDiagnostics: true,
      hasStudyGuidance: true,
      hasLiveGeneration: false, // Not yet supported
      hasExplanationRubric: false
    }
  },
  'fsa-income': {
    id: 'fsa-income',
    topicId: 'FSA',
    name: 'Analyzing the Income Statement',
    sourceReference: '2027 CFAI Curriculum, Volume 3, Module 2',
    reviewStatus: 'reviewed',
    capabilities: {
      hasReviewedDiagnostics: true,
      hasStudyGuidance: true,
      hasLiveGeneration: false,
      hasExplanationRubric: false
    }
  },
  'fsa-balance': {
    id: 'fsa-balance',
    topicId: 'FSA',
    name: 'Analyzing the Balance Sheet',
    sourceReference: '2027 CFAI Curriculum, Volume 3, Module 3',
    reviewStatus: 'reviewed',
    capabilities: {
      hasReviewedDiagnostics: true,
      hasStudyGuidance: true,
      hasLiveGeneration: false,
      hasExplanationRubric: false
    }
  }
};

/**
 * Checks if a given module ID is supported and what its capabilities are.
 */
export function getModuleCapabilities(moduleId: string): CurriculumCapability | null {
  const entry = FSA_REGISTRY[moduleId];
  if (!entry || entry.reviewStatus !== 'reviewed') {
    return null;
  }
  return entry.capabilities;
}

/**
 * Validates if the module has reviewed diagnostics.
 */
export function canDeliverDiagnostic(moduleId: string): boolean {
  const caps = getModuleCapabilities(moduleId);
  return caps?.hasReviewedDiagnostics ?? false;
}
