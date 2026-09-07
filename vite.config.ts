import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The realtime backend does not send CORS headers, so in dev we proxy /api
// through the same origin (no preflight, no CORS) to VITE_REALTIME_API_BASE.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd());
  const target = env.VITE_REALTIME_API_BASE;

  return {
    plugins: [react()],
    server: {
      port: 5173,
      fs: { strict: true },
      proxy: target
        ? {
            '/api': {
              target,
              changeOrigin: true,
              secure: true
            }
          }
        : undefined
    },
    build: {
      target: 'es2022',
      rolldownOptions: {
        output: {
          // Keep large, stable rendering and mapping dependencies cacheable
          // across application-only releases.
          codeSplitting: {
            groups: [
              { name: 'three', test: /node_modules\/three\//, maxSize: 450 * 1024 },
              { name: 'maps', test: /node_modules\/(leaflet|@mapbox|pbf)\// },
              { name: 'react', test: /node_modules\/(react|react-dom)\// }
            ]
          }
        }
      }
    }
  };
});
