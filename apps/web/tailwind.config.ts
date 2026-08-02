import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink:  '#0f1720',
        sub:  '#6b7785',
        line: '#e3e8ee',
        // 艇番の色。実際のボートレースの枠色に合わせている。
        lane: {
          1: '#ffffff', 2: '#111827', 3: '#e5342b',
          4: '#2563eb', 5: '#f2c200', 6: '#22a06b',
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
