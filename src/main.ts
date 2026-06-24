import './style.css';
import { AppController } from './app/AppController';

// Main application mount point from index.html.
const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

// Start the simulator app and surface startup errors in the existing loading overlay.
new AppController(app).start().catch((error: unknown) => {
  console.error(error);

  const loading = document.querySelector<HTMLElement>('.loading');
  if (loading) loading.textContent = error instanceof Error ? error.message : String(error);
});
