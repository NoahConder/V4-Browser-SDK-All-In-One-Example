/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      screens: {
        // Phones in landscape (and other very short viewports): layouts switch
        // from a stacked column to side-by-side so nothing overlaps or scrolls.
        short: { raw: '(max-height: 500px)' },
      },
      colors: {
        'ios-gray': {
          900: '#1c1c1e',
          800: '#2c2c2e',
          700: '#3a3a3c',
          600: '#48484a',
          500: '#636366',
          400: '#8e8e93',
        },
        'ios-green': '#34c759',
        'ios-red': '#ff3b30',
      },
      fontFamily: {
        'sf': ['SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}