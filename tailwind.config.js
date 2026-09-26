/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './admin.html', './student.html', './assistant.html', './loader.html'],
  theme: {
    extend: {
      fontFamily: { sans: ['Prompt', 'Sarabun', 'sans-serif'] },
      colors: {
        'school-primary': '#6366f1',
        'school-hover': '#4f46e5',
        'school-soft': '#f8faff',
        'text-active': '#2e343a',
        'school-secondary': '#fbbf24',
        'bg-soft': '#f8fafc'
      }
    }
  },
  plugins: []
};
