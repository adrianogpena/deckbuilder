import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@kedalion/ui/styles.css';
import './i18n';
import './explorer.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
