/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-strong': 'var(--surface-strong)',
        muted: 'var(--surface-muted)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        subtle: 'var(--subtle)',
        line: 'var(--border)',
        'line-strong': 'var(--border-strong)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        focus: 'var(--focus)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"DM Sans"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(255,255,255,0.6) inset, 0 8px 30px -12px rgba(18,45,69,0.18)',
      },
    },
  },
  plugins: [],
}
