import type { Config } from 'tailwindcss'

export default {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg-app)',
        app2: 'var(--bg-app-2)',
        surface: 'var(--bg-surface)',
        subtle: 'var(--bg-subtle)',
        hover: 'var(--bg-hover)',
        sunken: 'var(--bg-sunken)',
        line: { DEFAULT: 'var(--border)', strong: 'var(--border-strong)' },
        ink: {
          DEFAULT: 'var(--text)',
          secondary: 'var(--text-secondary)',
          muted: 'var(--text-muted)',
          inverse: 'var(--text-inverse)',
        },
        brand: {
          DEFAULT: 'var(--brand)',
          emphasis: 'var(--brand-emphasis)',
          subtle: 'var(--brand-subtle)',
        },
        accent: { DEFAULT: 'var(--accent)', subtle: 'var(--accent-subtle)' },
        navy: {
          DEFAULT: 'var(--navy)',
          deep: 'var(--navy-2)',
          deeper: 'var(--navy-3)',
        },
        gold: { DEFAULT: 'var(--gold)', subtle: 'var(--gold-subtle)' },
        ai: {
          DEFAULT: 'var(--ai)',
          emphasis: 'var(--ai-emphasis)',
          subtle: 'var(--ai-subtle)',
        },
        success: { DEFAULT: 'var(--success)', subtle: 'var(--success-subtle)' },
        warning: { DEFAULT: 'var(--warning)', subtle: 'var(--warning-subtle)' },
        danger: { DEFAULT: 'var(--danger)', subtle: 'var(--danger-subtle)' },
        info: { DEFAULT: 'var(--info)', subtle: 'var(--info-subtle)' },
      },
      borderColor: { DEFAULT: 'var(--border)' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        arabic: ['"IBM Plex Sans Arabic"', 'Inter', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        xs: ['0.75rem', { lineHeight: '1.1rem' }],
        sm: ['0.8125rem', { lineHeight: '1.25rem' }],
        base: ['0.875rem', { lineHeight: '1.4rem' }],
        lg: ['1rem', { lineHeight: '1.5rem' }],
        xl: ['1.25rem', { lineHeight: '1.7rem', letterSpacing: '-0.01em' }],
        '2xl': ['1.625rem', { lineHeight: '2rem', letterSpacing: '-0.02em' }],
        '3xl': ['2.125rem', { lineHeight: '2.5rem', letterSpacing: '-0.02em' }],
        '4xl': ['2.75rem', { lineHeight: '3rem', letterSpacing: '-0.025em' }],
      },
      borderRadius: {
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
        '2xl': '22px',
        '3xl': '28px',
      },
      boxShadow: {
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
        'e-ai': 'var(--shadow-ai)',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(.22,1,.36,1)',
        emphasized: 'cubic-bezier(.16,1,.3,1)',
        exit: 'cubic-bezier(.4,0,.2,1)',
      },
      transitionDuration: {
        micro: '180ms',
        base: '320ms',
        page: '600ms',
        load: '900ms',
        reveal: '700ms',
      },
      keyframes: {
        sheen: {
          '0%': { backgroundPosition: '-140% 0' },
          '100%': { backgroundPosition: '140% 0' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.55', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.03)' },
        },
        dots: {
          '0%, 80%, 100%': { opacity: '0.25' },
          '40%': { opacity: '1' },
        },
        floaty: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
      animation: {
        sheen: 'sheen 1.6s ease-in-out infinite',
        breathe: 'breathe 2.4s ease-in-out infinite',
        dots: 'dots 1.2s ease-in-out infinite',
        floaty: 'floaty 4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config
