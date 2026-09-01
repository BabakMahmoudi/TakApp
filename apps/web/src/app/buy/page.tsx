'use client';

import Link from 'next/link';
import { trpc } from '../../lib/trpc/trpc';
import { useWallet } from '../../lib/wallet-provider';

export default function BuyPage() {
  const { session, busy, error, setError, signPayment, submitPayment } = useWallet();
  const shopsQuery = trpc.shops.list.useQuery(undefined, {
    enabled: !!session,
    retry: false,
  });

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

  function buyCoffee(shop: { id: number; name: string; ownerPublicKey: string | null }): void {
    setError(null);
    if (!shop.ownerPublicKey) {
      setError({ message: 'This shop has no payment account yet' });
      return;
    }
    signPayment(async (secretKey) => {
      await submitPayment({
        secretKey,
        destination: shop.ownerPublicKey as string,
        amountLumens: '1',
        stroops: '10000000',
        coffeeShopId: shop.id,
      });
    });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 p-6">
      <section className="rounded-xl bg-coffee-900 p-6 shadow">
        <h2 className="text-sm font-medium text-coffee-300">Buy coffee</h2>
        {shopsQuery.isLoading ? (
          <p className="mt-2 text-coffee-300">Loading shops…</p>
        ) : shopsQuery.isError ? (
          <p className="mt-2 text-red-400">{shopsQuery.error.message}</p>
        ) : (
          <ul className="mt-2 divide-y divide-coffee-800">
            {shopsQuery.data?.shops.map((shop) => (
              <li key={shop.id} className="flex items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm text-coffee-100">{shop.name}</p>
                  <p className="text-xs text-coffee-400">{shop.address ?? '—'}</p>
                </div>
                <button
                  onClick={() => buyCoffee(shop)}
                  disabled={busy}
                  className="rounded-md bg-coffee-600 px-3 py-1.5 text-sm font-medium text-coffee-50 disabled:opacity-50"
                >
                  Buy coffee (1 TAK)
                </button>
              </li>
            ))}
            {(shopsQuery.data?.shops.length ?? 0) === 0 && (
              <li className="py-3 text-coffee-300">No shops available</li>
            )}
          </ul>
        )}
      </section>
      {error && <p className="text-sm text-red-400">{error.message}</p>}
    </main>
  );
}
