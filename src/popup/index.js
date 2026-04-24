import { createRoot } from 'react-dom/client';
import { App } from './App';
import './popup.scss';

const container = document.getElementById('root');
createRoot(container).render(<App />);
