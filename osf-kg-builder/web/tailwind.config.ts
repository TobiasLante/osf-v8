import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          0: '#050507',
          1: '#0c0c10',
          2: '#141418',
          3: '#1c1c22',
          4: '#24242c',
        },
        accent: '#10b981',
        'accent-hover': '#059669',
        muted: '#71717a',
        dim: '#52525b',
      },
      borderRadius: {
        sm: '8px',
        md: '12px',
        lg: '16px',
      },
    },
  },
  plugins: [],
};
export default config;
