/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        'xs': '475px',
        '3xl': '1920px',
      },
      colors: {
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#172554',
        },
        surface: {
          0:   '#ffffff',
          50:  '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
        },
        success: { 50:'#f0fdf4', 100:'#dcfce7', 500:'#22c55e', 600:'#16a34a', 700:'#15803d' },
        warning: { 50:'#fffbeb', 100:'#fef3c7', 500:'#f59e0b', 600:'#d97706', 700:'#b45309' },
        danger:  { 50:'#fef2f2', 100:'#fee2e2', 500:'#ef4444', 600:'#dc2626', 700:'#b91c1c' },
        info:    { 50:'#eff6ff', 100:'#dbeafe', 500:'#3b82f6', 600:'#2563eb', 700:'#1d4ed8' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      // Fluid typography — grows smoothly from mobile to desktop.
      fontSize: {
        'display':  ['clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem)',   { lineHeight: '1.15', letterSpacing: '-0.02em', fontWeight: '700' }],
        'h1':       ['clamp(1.375rem, 1.15rem + 1vw, 1.75rem)',  { lineHeight: '1.25', letterSpacing: '-0.015em', fontWeight: '700' }],
        'h2':       ['clamp(1.125rem, 1rem + 0.5vw, 1.25rem)',   { lineHeight: '1.3',  letterSpacing: '-0.01em', fontWeight: '600' }],
        'h3':       ['1rem',      { lineHeight: '1.4',  fontWeight: '600' }],
        'body':     ['0.9375rem', { lineHeight: '1.55' }],
        'body-sm':  ['0.8125rem', { lineHeight: '1.5' }],
        'caption':  ['0.75rem',   { lineHeight: '1.4', letterSpacing: '0.01em' }],
      },
      borderRadius: {
        'sm':  '0.375rem',
        'md':  '0.5rem',
        'lg':  '0.75rem',
        'xl':  '1rem',
        '2xl':'1.25rem',
      },
      boxShadow: {
        'card':       '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 4px 6px -1px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        'pop':        '0 10px 25px -5px rgb(15 23 42 / 0.12), 0 4px 6px -2px rgb(15 23 42 / 0.06)',
        'focus':      '0 0 0 3px rgb(59 130 246 / 0.35)',
      },
      transitionTimingFunction: {
        'out-quart': 'cubic-bezier(0.25, 1, 0.5, 1)',
      },
      keyframes: {
        'fade-in':   { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'scale-in':  { '0%': { opacity: '0', transform: 'scale(0.96)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
      },
      animation: {
        'fade-in':  'fade-in 0.2s ease-out',
        'scale-in': 'scale-in 0.15s cubic-bezier(0.25, 1, 0.5, 1)',
      },
    },
  },
  plugins: [],
}
