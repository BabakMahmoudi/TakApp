'use client';

import Link from 'next/link';
import AdminPanel from '../../components/admin-panel';
import { useWallet } from '../../lib/wallet-provider';

export default function AdminPage() {
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
      <AdminPanel />
    </main>
  );
}
