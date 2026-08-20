import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: '#0a0a0f',
        surface: {
          1: '#12121c',
          2: '#1a1a28',
          3: '#222233',
          hover: '#252538',
          selected: 'rgba(139, 92, 246, 0.12)',
        },
        bg: {
          main: '#0a0a0f',
          card: '#12121c',
          'card-hover': '#1a1a28',
        },
        border: {
          DEFAULT: 'rgba(255, 255, 255, 0.06)',
          light: 'rgba(255, 255, 255, 0.1)',
          selected: '#8B5CF6',
        },
        brand: {
          DEFAULT: '#8B5CF6',
          strong: '#7C3AED',
          soft: 'rgba(139, 92, 246, 0.15)',
          'soft-light': 'rgba(139, 92, 246, 0.08)',
          hover: '#A78BFA',
        },
        semantic: {
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
        },
        accent: {
          yellow: '#FFD580',
        },
        text: {
          primary: '#F0F0F5',
          secondary: '#A0A0B8',
          tertiary: '#7B7B92',
          disabled: '#4A4A5C',
        },
      },
      borderRadius: {
        sm: '4px',
        btn: '8px',
        card: '12px',
        chip: '999px',
      },
      boxShadow: {
        window: '0 2px 8px rgba(0,0,0,0.55)',
        card: '0 2px 8px rgba(0,0,0,0.4)',
        'card-hover': '0 3px 10px rgba(0,0,0,0.45)',
        popover: '0 2px 8px rgba(0,0,0,0.55)',
        ball: '0 2px 10px rgba(0,0,0,0.5)',
        'ball-hover': '0 4px 14px rgba(0,0,0,0.6)',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'HarmonyOS Sans', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'SF Mono', 'Consolas', 'monospace'],
        display: ['Inter', 'PingFang SC', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
      },
      letterSpacing: {
        tightest: '-0.05em',
        tighter: '-0.03em',
        tight: '-0.015em',
        wide: '0.02em',
      },
    },
  },
  plugins: [],
} satisfies Config;
