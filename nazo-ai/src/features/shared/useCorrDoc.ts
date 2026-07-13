// Resolve a correspondence's EFFECTIVE variables/body: a per-instance override
// (item 3b) wins, then the live store template (published/new included), then the
// static seed. Keeps every card/list correct for AI-generated templates.
import { useStore } from '@/store'
import { TEMPLATE_BY_ID } from '@/data/seed'
import type { Correspondence, TemplateVariable } from '@/types'

export function useCorrVariables(corr: Correspondence): TemplateVariable[] {
  const templates = useStore((s) => s.templates)
  return (
    corr.variablesOverride ??
    templates.find((t) => t.id === corr.templateId)?.variables ??
    TEMPLATE_BY_ID[corr.templateId]?.variables ??
    []
  )
}
