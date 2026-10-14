/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        card: '#101726',
        border: 'rgba(255, 255, 255, 0.08)',
        cyan: {
          400: '#22d3ee',
          500: '#06b6d4',
        },
        violet: {
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        emerald: {
          400: '#34d399',
          500: '#10b981',
        }
      },
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'Inter', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'laser-scan': 'scan 2.5s ease-in-out infinite alternate',
      },
      keyframes: {
        scan: {
          '0%': { top: '5%' },
          '100%': { top: '95%' }
        }
      }
    },
  },
  plugins: [],
}
