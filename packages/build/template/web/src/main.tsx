import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@deckbuilderkit/ui/styles.css';
import './i18n';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
