import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installBufferShim } from '../ext/buffer.ts';
import { App } from './App.tsx';

// 署名の生成が Node の Buffer を前提にしている。最初の取得より前に埋めておく。
installBufferShim();

const container = document.getElementById('root');
if (!container) throw new Error('#root が見つかりません。index.html を確認してください。');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
