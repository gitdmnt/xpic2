import { useEffect, useRef } from 'react';
import { Icon } from './Icon.tsx';

interface ShortcutModalProps {
  open: boolean;
  onClose(): void;
}

const WALL = [
  ['← ↓ ↑ →', 'タイルを移動'],
  ['Enter', '拡大表示'],
  ['l', 'いいね'],
  ['b', 'ブックマーク'],
  ['/', '検索欄へ移動'],
] as const;

const LIGHTBOX = [
  ['← / k', '前へ'],
  ['→ / j', '次へ'],
  ['l', 'いいね'],
  ['b', 'ブックマーク'],
  ['t', 'リポスト'],
  ['Esc', '閉じる'],
] as const;

function List({ items }: { items: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
      {items.map(([key, label]) => (
        <div className="contents" key={key}>
          <dt><kbd className="font-mono text-fg">{key}</kbd></dt>
          <dd className="text-fg-dim">{label}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ShortcutModal({ open, onClose }: ShortcutModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        closeRef.current?.focus();
      } else if (e.key === 'Escape' || e.key === '?') {
        onClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      if (restoreRef.current?.isConnected) restoreRef.current.focus();
      restoreRef.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-90 flex items-center justify-center bg-scrim p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <section
        className="relative grid w-[min(560px,100%)] gap-6 rounded-md border border-line bg-elev p-6 shadow-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-title"
      >
        <h2 id="shortcut-title" className="text-base font-semibold">キーボードショートカット</h2>
        <button ref={closeRef} type="button" className="btn btn-ghost btn-icon absolute top-4 right-4" aria-label="閉じる" onClick={onClose}>
          <Icon name="close" />
        </button>
        <div className="grid gap-3">
          <h3 className="text-xs font-semibold text-fg-dim">一覧表示</h3>
          <List items={WALL} />
        </div>
        <div className="grid gap-3">
          <h3 className="text-xs font-semibold text-fg-dim">拡大表示</h3>
          <List items={LIGHTBOX} />
        </div>
        <p className="text-xs text-fg-faint"><kbd className="font-mono">?</kbd> でも閉じます。</p>
      </section>
    </div>
  );
}
