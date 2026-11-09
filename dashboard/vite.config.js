import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' para que funcione igual en GitHub Pages (/ocn-observatorio/), Vercel o Netlify.
export default defineConfig({
  base: './',
  plugins: [react()],
})
