'use client';

/**
 * 友達を誘うためのボタン。
 * スマホなら共有シート、パソコンならコピーになる。
 */

import { useState } from 'react';

export function ShareInvite({ url, handle }: { url: string; handle: string }) {
  const [copied, setCopied] = useState<string | null>(null);

  const message =
    `ノーマネー予想対戦、一緒にやりませんか。\n` +
    `お金は使いません。毎月50,000ptが配られて、収支を競うだけです。\n\n` +
    `${url}\n\n` +
    `登録したら、フレンド検索で「${handle}」を探して申請してください。`;

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied('失敗');
    }
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && (navigator as any).share) {
      try {
        await (navigator as any).share({ title: 'ノーマネー予想対戦', text: message });
        return;
      } catch {
        // 共有をやめただけなのでそのまま
      }
    }
    copy(message, 'メッセージ');
  };

  return (
    <div className="space-y-2">
      <button
        onClick={share}
        className="w-full rounded-xl bg-ink py-3 text-sm font-bold text-white"
      >
        友達に送る
      </button>

      <div className="flex gap-2">
        <button
          onClick={() => copy(url, 'URL')}
          className="flex-1 rounded-xl border border-line py-2.5 text-xs font-semibold"
        >
          URLだけコピー
        </button>
        <button
          onClick={() => copy(handle, 'ユーザーID')}
          className="flex-1 rounded-xl border border-line py-2.5 text-xs font-semibold"
        >
          ユーザーIDをコピー
        </button>
      </div>

      {copied && (
        <p className="text-center text-[11px] text-green-700">
          {copied === '失敗' ? 'コピーできませんでした' : `${copied}をコピーしました`}
        </p>
      )}
    </div>
  );
}
