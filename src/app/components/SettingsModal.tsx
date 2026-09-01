// 接続設定モーダル。cURL / cookie を保存し、現在の設定状況を表示する。

import { useCallback, useEffect, useState } from 'react';
import type { ConfigPatchRequest, ConfigStatus } from '../../shared/types.ts';
import { fetchConfigStatus, saveConfig } from '../lib/api.ts';

export interface SettingsModalProps {
  open: boolean;
  onClose(): void;
  onSaved(status: ConfigStatus): void;
}

interface Message {
  text: string;
  bad: boolean;
}

/**
 * 認証情報そのものは持たないので、状況は素朴なテキストで並べる。
 *
 * queryId と features はライブラリの既定値に対する「上書き」であって、実際に使われる値の全量ではない。
 * 一覧をそのまま並べると既定値と読み違えるので、上書きが 0 件のときは件数ではなくその旨を書く。
 */
function formatStatus(s: ConfigStatus): string {
  const ops = Object.entries(s.queryIds);
  const queryLines =
    ops.length === 0
      ? 'queryId の上書き: なし（既定値のみ）'
      : `queryId の上書き: ${ops.length} 件\n` + ops.map(([k, v]) => `  ${k}: ${v}`).join('\n');
  const featureLine =
    s.featureCount === 0
      ? 'features の上書き: なし（既定値のみ）'
      : `features の上書き: ${s.featureCount} 件`;

  return (
    `認証: ${s.configured ? 'OK' : '未設定'}\n` +
    `cookie の項目: ${s.cookieKeys.join(', ') || '(なし)'}\n` +
    `${queryLines}\n` +
    `${featureLine}\n` +
    `保存先: ${s.file}`
  );
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [curl, setCurl] = useState('');
  const [cookie, setCookie] = useState('');
  const [msg, setMsg] = useState<Message | null>(null);
  const [statusText, setStatusText] = useState('');
  const [saving, setSaving] = useState(false);

  // 開くたびに取り直す。保存直後だけでなく、他の経路で config.json が変わった場合にも追随するため。
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetchConfigStatus().then(
      (s) => { if (!cancelled) setStatusText(formatStatus(s)); },
      () => { if (!cancelled) setStatusText('サーバに接続できません。'); },
    );
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const handleSave = useCallback(async () => {
    const c = curl.trim();
    const ck = cookie.trim();
    if (!c && !ck) {
      setMsg({ text: 'cURL か cookie を入力してください。', bad: true });
      return;
    }
    const body: ConfigPatchRequest = {};
    if (c) body.curl = c;
    if (ck) body.cookie = ck;

    setSaving(true);
    setMsg({ text: '保存中…', bad: false });
    try {
      const res = await saveConfig(body);
      setMsg({ text: res.note ?? '保存しました。', bad: false });
      // サーバが保存後の状況を返すので、取り直さずそのまま反映する
      setStatusText(formatStatus(res.status));
      setCurl(''); // cURL は使い捨て。cookie 欄は入力内容の確認用に残す
      onSaved(res.status);
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : '保存に失敗しました。', bad: true });
    } finally {
      setSaving(false);
    }
  }, [curl, cookie, onSaved]);

  if (!open) return null;

  return (
    <div
      className="modal"
      // オーバーレイ自身をクリックしたときだけ閉じる（シート内の操作で閉じない）
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="sheet">
        <header>
          <h2>接続設定</h2>
          <button type="button" className="ghost" onClick={onClose}>閉じる</button>
        </header>

        <p className="lede">
          x.com にログインしたブラウザの DevTools →
          <b>Network</b> タブで <code>i/api/graphql/…/UserMedia</code> のようなリクエストを右クリックし
          <b>Copy as cURL</b>。貼り付けると cookie が登録され、そのリクエストの queryId と features が<b>上書き</b>として保存されます。
        </p>

        <p className="lede">
          queryId と features の既定値はライブラリが x.com から取得するので、普段は cookie を入れるだけで動きます。
          cURL を貼り直すのは、その既定値が古びて「queryId が古くなっています」と出たときです。
          エラーに出た名前（<code>UserMedia</code> など）のリクエストを貼れば、そのエンドポイントの分だけを新しい queryId で塞げます。
        </p>

        <label className="field">
          <span>cURL を貼り付け（cookie の登録と、古びた queryId の差し替え）</span>
          <textarea
            rows={6}
            value={curl}
            onChange={(e) => setCurl(e.currentTarget.value)}
            placeholder="curl 'https://x.com/i/api/graphql/xxxx/UserMedia?variables=...' -H 'authorization: Bearer ...' -H 'cookie: auth_token=...; ct0=...' ..."
          />
        </label>

        <details>
          <summary>cookie だけを直接入力する</summary>
          <label className="field">
            <span>cookie ヘッダ全文（最低限 <code>auth_token</code> と <code>ct0</code>）</span>
            <textarea
              rows={3}
              value={cookie}
              onChange={(e) => setCookie(e.currentTarget.value)}
              placeholder="auth_token=xxxxxxxx; ct0=yyyyyyyy"
            />
          </label>
        </details>

        <div className="actions">
          {/* 二重送信で config.json を上書きし合わないよう、保存中は押させない */}
          <button type="button" className="primary" onClick={handleSave} disabled={saving}>保存</button>
          {msg && <span className={msg.bad ? 'msg bad' : 'msg'}>{msg.text}</span>}
        </div>

        <div className="statusbox">{statusText}</div>

        <p className="fine">
          認証情報はこの PC の <code>config.json</code>（権限 600）にだけ保存され、外部には送信されません。
          X の非公開 API を叩くため、レート制限や仕様変更で動かなくなることがあります。自分のアカウントの範囲でご利用ください。
        </p>
      </div>
    </div>
  );
}
