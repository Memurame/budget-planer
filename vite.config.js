import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  base: './', // damit Electron die gebauten Dateien per file:// laden kann
  plugins: [react(), tailwindcss()],
})
