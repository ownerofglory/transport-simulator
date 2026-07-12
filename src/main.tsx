import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { App } from './app/App';

const container = document.getElementById('app');
if (!container) throw new Error('Missing #app');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
