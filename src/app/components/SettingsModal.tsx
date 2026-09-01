// 接続設定モーダル。
//
// サーバ版と役目が変わっている。cookie を貼る欄は無い。認証はブラウザの x.com のセッションを
// そのまま使うので、ここで確かめるのは「権限が下りているか」と「ログインしているか」だけである。
// queryId の上書きも background.ts が勝手に集めるため、cURL 欄はその手当が届かないときの控えとして残す。

import { useCallback, useEffect, useState } from 'react';
import type { ExtStatus } from '../lib/x.ts';
import { applyCurl, clearOverrides, extStatus, requestPermissions } from '../lib/x.ts';

export interface SettingsModalProps {
  open: boolean;
  onClose(): void;
  onChanged(status: ExtStatus): void;
}

interface Message {
  text: string;
  bad: boolean;
}

export function SettingsModal({ open, onClose, onChanged }: SettingsModalProps) {
  const [curl, setCurl] = useState('');
  const [msg, setMsg] = useState<Message | null>(null);
  const [status, setStatus] = useState<ExtStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<ExtStatus | null> => {
    try {
      const s = await extStatus();
      setStatus(s);
      onChanged(s);
      return s;
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '状況を取得できませんでした。', bad: true });
      return null;
    }
  }, [onChanged]);

  // 開くたびに取り直す。権限は拡張機能の管理画面からも変えられるので、こちらの記憶は当てにしない。
  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleGrant = useCallback(async () => {
    setBusy(true);
    try {
      const ok = await requestPermissions();
      setMsg(
        ok
          ? { text: '許可されました。', bad: false }
          : { text: '許可されませんでした。', bad: true },
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const handleCurl = useCallback(async () => {
    const text = curl.trim();
    if (!text) {
      setMsg({ text: 'cURL を貼り付けてください。', bad: true });
      return;
    }
    setBusy(true);
    try {
      setMsg({ text: await applyCurl(text), bad: false });
      setCurl('');
      await refresh();
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '取り込めませんでした。', bad: true });
    } finally {
      setBusy(false);
    }
  }, [curl, refresh]);

  const handleClear = useCallback(async () => {
    setBusy(true);
    try {
      await clearOverrides();
      setMsg({ text: '上書きを消しました。以後はライブラリの既定値だけで動きます。', bad: false });
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  if (!open) return null;

  const ops = Object.entries(status?.queryIds ?? {});

  return (
    <div
      className="modal"
      // オーバーレイ自身をクリックしたときだけ閉じる（シート内の操作で閉じない）
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header>
          <h2>接続設定</h2>
          <button type="button" className="ghost" onClick={onClose}>
            閉じる
          </button>
        </header>

        <p className="lede">
          この拡張機能は、ブラウザが持っている x.com のセッションをそのまま使います。
          cookie を貼り付ける必要はありません。x.com にログインしていれば、それだけで動きます。
        </p>

        <div className="statusbox">
          <div className={status?.granted ? 'ok' : 'ng'}>
            {status?.granted ? '● x.com への権限: あり' : '● x.com への権限: なし'}
          </div>
          <div className={status?.loggedIn ? 'ok' : 'ng'}>
            {status?.loggedIn ? '● x.com のログイン: あり' : '● x.com のログイン: なし'}
          </div>
          <div>
            {ops.length === 0
              ? '● queryId の上書き: なし（既定値のみ）'
              : `● queryId の上書き: ${ops.length} 件`}
          </div>
          {ops.map(([op, id]) => (
            <div key={op} className="sub">
              {op}: {id}
            </div>
          ))}
          <div>
            {status && status.featureCount > 0
              ? `● features の上書き: ${status.featureCount} 件`
              : '● features の上書き: なし（既定値のみ）'}
          </div>
        </div>

        <div className="actions">
          {status && !status.granted && (
            <button type="button" className="primary" onClick={() => void handleGrant()} disabled={busy}>
              権限を許可
            </button>
          )}
          {status && status.granted && !status.loggedIn && (
            <a className="msg" href="https://x.com/login" target="_blank" rel="noreferrer noopener">
              x.com を開いてログイン
            </a>
          )}
          {msg && <span className={msg.bad ? 'msg bad' : 'msg'}>{msg.text}</span>}
        </div>

        <details>
          <summary>queryId を手で差し替える</summary>
          <p className="lede">
            queryId は x.com のタブが投げているリクエストを見て自動で追いかけます。
            その操作を x.com 側で一度も行っていないと拾えないので、そのときだけここを使います。
            DevTools の <b>Network</b> で、エラーに出た名前のリクエストを <b>Copy as cURL</b> して貼り付けてください。
            読み取るのは queryId と features だけで、cookie や bearer は取り込みません。
          </p>
          <label className="field">
            <span>cURL を貼り付け</span>
            <textarea
              rows={5}
              value={curl}
              onChange={(e) => setCurl(e.currentTarget.value)}
              placeholder="curl 'https://x.com/i/api/graphql/xxxx/FavoriteTweet' ..."
            />
          </label>
          <div className="actions">
            <button type="button" onClick={() => void handleCurl()} disabled={busy}>
              取り込む
            </button>
            <button type="button" className="ghost" onClick={() => void handleClear()} disabled={busy}>
              上書きを全部消す
            </button>
          </div>
        </details>

        <p className="fine">
          保存するのは queryId と features の上書きだけで、認証情報は保存しません。
          X の非公開 API を叩くため、レート制限や仕様変更で動かなくなることがあります。自分のアカウントの範囲でご利用ください。
        </p>
      </div>
    </div>
  );
}
