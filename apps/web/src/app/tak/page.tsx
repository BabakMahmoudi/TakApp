'use client';

import Link from 'next/link';
import { useWallet } from '../../lib/wallet-provider';

const takMethods = [
  {
    id: 'faucet',
    title: 'Testnet faucet',
    description: 'Get TAK from the Stellar testnet faucet or an exchange that lists it.',
  },
] as const;

export default function TakPage() {
  const { session } = useWallet();

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
      <h1 className="text-xl font-semibold text-coffee-100">Get TAK</h1>
      <ul className="flex flex-col gap-4">
        {takMethods.map((method) => (
          <li key={method.id} className="rounded-xl bg-coffee-900 p-6 shadow">
            <h2 className="text-sm font-medium text-coffee-300">{method.title}</h2>
            <p className="mt-1 text-xs text-coffee-400">{method.description}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
