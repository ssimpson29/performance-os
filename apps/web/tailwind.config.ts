import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#e8ecf2',
        panel: '#101826',
        panelAlt: '#0d1420',
        line: '#243247',
        brand: '#6ee7b7',
        brand2: '#7dd3fc',
        muted: '#8fa0b7',
        danger: '#fca5a5',
        warning: '#fcd34d',
      },
      boxShadow: {
        glow: '0 18px 60px rgba(125, 211, 252, 0.12)',
      },
      backgroundImage: {
        grid: 'radial-gradient(circle at 1px 1px, rgba(143,160,183,0.18) 1px, transparent 0)',
      },
    },
  },
  plugins: [],
};

export default config;
