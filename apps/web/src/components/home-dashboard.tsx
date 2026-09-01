'use client';

import { useState } from 'react';
import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { useWallet } from '../lib/wallet-provider';

export default function HomeDashboard() {
  const { session, balanceQuery, error, setError } = useWallet();

  const [copied, setCopied] = useState(false);

  async function copyPublicKey(): Promise<void> {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError({ message: 'Could not copy your address' });
    }
  }

  const takBalance = balanceQuery.data?.balances.find((entry) => entry.asset === 'TAK');

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">TAK balance</h2>
        <p className="mt-2 flex items-baseline gap-2">
          <span className="text-5xl font-bold text-coffee-100">
            {balanceQuery.isLoading
              ? '…'
              : balanceQuery.isError
                ? '—'
                : lumensFromStroops(takBalance ? takBalance.stroops : '0')}
          </span>
          <span className="text-lg font-semibold text-coffee-300">TAK</span>
        </p>
        <h2 className="mt-6 text-sm font-medium text-coffee-300">Address</h2>
        <code className="mt-2 block break-all font-mono text-xs text-coffee-100">{session?.publicKey}</code>
        <button
          onClick={() => void copyPublicKey()}
          className="mt-3 rounded-md border border-coffee-700 px-3 py-1.5 text-xs text-coffee-200"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <Link
          href="/buy"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          Buy Coffee
        </Link>
        <div className="grid grid-cols-2 gap-3">
          <Link
            href="/send"
            className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            Send
          </Link>
          <Link
            href="/tak"
            className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
          >
            Get
          </Link>
        </div>
      </section>

      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
