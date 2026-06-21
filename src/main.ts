import './style.css';
import { AppController } from './app/AppController';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('Missing #app');

new AppController(app).start().catch((error: unknown) => {
  console.error(error);
  const loading = document.querySelector<HTMLElement>('.loading');
  if (loading) loading.textContent = error instanceof Error ? error.message : String(error);
});
