// ブラウザ側のエントリ。index.html から Bun にバンドルされる。

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { installBufferShim } from '../ext/buffer.ts';
import { App } from './App.tsx';

// 署名の生成が Node の Buffer を前提にしている。最初の取得より前に埋めておく。
installBufferShim();

const container = document.getElementById('root');
// index.html と食い違ったときに白画面ではなく理由が分かるよう、ここで止める。
if (!container) throw new Error('#root が見つかりません。index.html を確認してください。');

// StrictMode の二重実行は副作用の書き漏れを炙り出す。useTimeline はそれに耐える作りにしてある。
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
