/** @type {import('tailwindcss').Config} */
// Every colour is a theme token (CSS variable set by src/lib/themes.ts). No screen or component carries a colour of its own.
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface-muted)',
        'surface-strong': 'var(--surface-strong)',
        muted: 'var(--surface-muted)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        subtle: 'var(--subtle)',
        line: 'var(--divider)',
        'line-strong': 'var(--outline)',
        outline: 'var(--outline)',
        card: 'var(--card)',
        'card-ink': 'var(--card-ink)',
        paper: 'var(--paper)',
        accent: 'var(--accent)',
        'accent-ink': 'var(--accent-ink)',
        focus: 'var(--focus)',
        success: 'rgb(var(--success-rgb) / <alpha-value>)',
        danger: 'rgb(var(--danger-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        'on-success': 'var(--on-success)',
        'on-danger': 'var(--on-danger)',
        'on-warn': 'var(--on-warn)',
      },
      // One ultra-heavy face for all text. Only hashes and addresses use a monospace face (also at its heaviest weight).
      fontFamily: {
        display: ['"Archivo Black"', '"Arial Black"', 'Impact', 'sans-serif'],
        sans: ['"Archivo Black"', '"Arial Black"', 'Impact', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      // The type scale is defined once, here. Every size is rem x --text-scale (set by the Text size setting), so one setting
      // controls the whole app. At Small (scale 1) the smallest text is 14px and body text is 16px. Headlines scale half as fast.
      fontSize: {
        xs: ['calc(0.875rem * var(--text-scale, 1))', { lineHeight: '1.3' }],
        sm: ['calc(1rem * var(--text-scale, 1))', { lineHeight: '1.35' }],
        base: ['calc(1.0625rem * var(--text-scale, 1))', { lineHeight: '1.35' }],
        lg: ['calc(1.25rem * var(--text-scale, 1))', { lineHeight: '1.25' }],
        xl: ['calc(1.5rem * var(--text-scale-h, 1))', { lineHeight: '1.2' }],
        '2xl': ['calc(1.75rem * var(--text-scale-h, 1))', { lineHeight: '1.15' }],
        '3xl': ['calc(2.125rem * var(--text-scale-h, 1))', { lineHeight: '1.1' }],
        '4xl': ['calc(2.5rem * var(--text-scale-h, 1))', { lineHeight: '1.05' }],
        '5xl': ['calc(3rem * var(--text-scale-h, 1))', { lineHeight: '1' }],
        '6xl': ['calc(3.75rem * var(--text-scale-h, 1))', { lineHeight: '1' }],
        // Balance figures inside half-width cards, and the small stat numbers.
        bal: ['calc(1.6rem * var(--text-scale-h, 1))', { lineHeight: '1.1' }],
        stat: ['calc(1.4rem * var(--text-scale-h, 1))', { lineHeight: '1.1' }],
        // Bottom tab bar labels: five labels share one pill, so they grow only slightly.
        tab: ['calc(0.8125rem * var(--tab-scale, 1))', { lineHeight: '1.1' }],
      },
      boxShadow: {
        card: '5px 5px 0 var(--shadow-c)',
        pop: '3px 3px 0 var(--shadow-c)',
        press: '1px 1px 0 var(--shadow-c)',
      },
      borderWidth: {
        3: '3px',
      },
    },
  },
  plugins: [],
}
