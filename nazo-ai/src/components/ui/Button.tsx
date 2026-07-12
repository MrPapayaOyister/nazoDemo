import { forwardRef } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-all duration-micro ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 focus-visible:ring-offset-app disabled:opacity-50 disabled:pointer-events-none select-none active:scale-[.98]',
  {
    variants: {
      variant: {
        primary:
          'bg-brand text-white shadow-e1 hover:bg-brand-emphasis hover:shadow-e2',
        navy: 'bg-navy text-white hover:bg-navy-deep shadow-e1',
        secondary:
          'bg-surface text-ink border border-line hover:bg-hover hover:border-line-strong',
        subtle: 'bg-subtle text-ink hover:bg-hover',
        ghost: 'text-ink-secondary hover:bg-hover hover:text-ink',
        ai: 'bg-ai text-white shadow-e1 hover:bg-ai-emphasis hover:shadow-e-ai',
        aiGradient: 'bg-ai-gradient text-white shadow-e1 hover:shadow-e-ai',
        danger: 'bg-danger text-white hover:brightness-95 shadow-e1',
        outline: 'border border-line-strong text-ink hover:bg-hover',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4 text-sm',
        lg: 'h-11 px-6 text-base',
        icon: 'h-9 w-9',
        iconSm: 'h-8 w-8',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp ref={ref} className={cn(button({ variant, size }), className)} {...props} />
    )
  },
)
Button.displayName = 'Button'
