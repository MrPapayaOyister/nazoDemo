import { Check, Clock, X, PenTool } from 'lucide-react'
import type { CorrespondenceStatus, RoleId, WorkflowStep } from '@/types'
import { USERS } from '@/data/users'
import { Avatar } from '@/components/common/Avatar'
import { useLocalized } from '@/i18n'
import { cn } from '@/lib/cn'

type StepState = 'signed' | 'current' | 'pending' | 'rejected'

interface ChainStepperProps {
  steps: WorkflowStep[]
  currentIndex?: number
  status?: CorrespondenceStatus
  signedRoles?: RoleId[]
  variant?: 'mini' | 'full'
  className?: string
}

const userByRole = (r: RoleId) => USERS.find((u) => u.role === r)

export function ChainStepper({
  steps,
  currentIndex = -1,
  status = 'Draft',
  signedRoles = [],
  variant = 'mini',
  className,
}: ChainStepperProps) {
  const tr = useLocalized()
  const signed = new Set(signedRoles)
  const firstUnsigned = steps.findIndex((s) => !signed.has(s.role))

  const stateFor = (s: WorkflowStep, i: number): StepState => {
    if (signed.has(s.role)) return 'signed'
    if (status === 'Completed') return 'signed'
    if (status === 'Rejected') return i === firstUnsigned ? 'rejected' : 'pending'
    if (i === currentIndex) return 'current'
    return 'pending'
  }

  return (
    <div
      className={cn('flex items-center', variant === 'mini' ? 'gap-1' : 'gap-2', className)}
    >
      {steps.map((s, i) => {
        const st = stateFor(s, i)
        const u = userByRole(s.role)
        const size = variant === 'mini' ? 26 : 34
        return (
          <div key={s.id} className="flex items-center gap-1 min-w-0">
            <div className="flex flex-col items-center gap-1 shrink-0">
              <div className="relative">
                <Avatar
                  initials={u?.initials ?? '?'}
                  color={u?.color}
                  size={size}
                  className={cn(
                    st === 'current' && 'ring-2 ring-brand ring-offset-1 ring-offset-surface',
                    st === 'pending' && 'opacity-45',
                  )}
                />
                <StateDot state={st} />
              </div>
              {variant === 'full' && (
                <span className="text-[10px] font-medium text-ink-muted text-center leading-tight max-w-[70px] truncate">
                  {tr(u?.nameEn ?? s.role, u?.nameAr ?? s.role)}
                </span>
              )}
            </div>
            {i < steps.length - 1 && (
              <span
                className={cn(
                  'h-0.5 rounded-full shrink-0',
                  variant === 'mini' ? 'w-4' : 'w-8',
                  st === 'signed' ? 'bg-success' : 'bg-line-strong',
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function StateDot({ state }: { state: StepState }) {
  const cfg = {
    signed: { cls: 'bg-success text-white', Icon: Check },
    current: { cls: 'bg-brand text-white', Icon: Clock },
    rejected: { cls: 'bg-danger text-white', Icon: X },
    pending: { cls: 'bg-line-strong text-white', Icon: PenTool },
  }[state]
  const Icon = cfg.Icon
  return (
    <span
      className={cn(
        'absolute -bottom-1 -end-1 grid place-items-center size-3.5 rounded-full ring-2 ring-surface',
        cfg.cls,
      )}
    >
      <Icon className="size-2" strokeWidth={3} />
    </span>
  )
}

/** Roles that have stamped a signature in a correspondence's values. */
export function signedRolesOf(
  values: Record<string, string>,
  variables: { tag: string; type: string; group: string }[],
): RoleId[] {
  return variables
    .filter((v) => v.type === 'Signature' && values[v.tag])
    .map((v) => v.group as RoleId)
}
