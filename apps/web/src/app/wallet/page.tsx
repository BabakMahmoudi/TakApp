'use client';

import Link from 'next/link';
import { lumensFromStroops } from '@takapp/shared/money';
import { useWallet } from '../../lib/wallet-provider';

export default function WalletPage() {
  const { session, balanceQuery } = useWallet();

  if (!session) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
        <p className="text-coffee-300">Please log in</p>
        <Link href="/" className="rounded-md bg-coffee-600 px-4 py-2.5 text-center font-medium text-coffee-50">
          Go to login
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold text-coffee-100">Wallet</h1>

      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">Balances</h2>
        {balanceQuery.isLoading ? (
          <p className="mt-2 text-coffee-300">Loading balances…</p>
        ) : balanceQuery.isError ? (
          <p className="mt-2 text-red-400">{balanceQuery.error.message}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {balanceQuery.data?.balances.map((entry) => (
              <li key={entry.asset} className="flex items-center justify-between py-3">
                <span className="text-coffee-300">{entry.asset}</span>
                <span className="font-mono text-lg text-coffee-100">{lumensFromStroops(entry.stroops)}</span>
              </li>
            ))}
            {balanceQuery.data?.balances.length === 0 && (
              <li className="py-3 text-coffee-300">No balances yet</li>
            )}
          </ul>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link
          href="/tak"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          Get TAK
        </Link>
        <Link
          href="/send"
          className="rounded-xl bg-coffee-900 p-6 shadow text-center text-lg font-semibold text-coffee-100"
        >
          Send
        </Link>
      </section>
    </main>
  );
}
