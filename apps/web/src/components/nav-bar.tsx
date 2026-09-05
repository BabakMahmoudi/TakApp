'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { trpc } from '../lib/trpc/trpc';
import { useWallet } from '../lib/wallet-provider';

export default function NavBar() {
  const { session, logout, isAdmin } = useWallet();
  const { t } = useI18n();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const mineQuery = trpc.owner.mine.useQuery(undefined, { enabled: !!session, retry: false });
  const ownsShop = (mineQuery.data?.shops.length ?? 0) > 0;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (headerRef.current && !headerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (!session) return null;

  const links = [
    { href: '/', label: t('nav.home') },
    { href: '/wallet', label: t('nav.wallet') },
    { href: '/buy', label: t('nav.buyCoffee') },
    { href: '/orders', label: t('nav.myOrders') },
    { href: '/send', label: t('nav.sendTak') },
    { href: '/tak', label: t('nav.getTak') },
    { href: '/profile', label: t('nav.profile') },
    ...(ownsShop ? [{ href: '/owner', label: t('nav.myShop') }] : []),
    ...(isAdmin ? [{ href: '/admin', label: t('nav.adminPanel') }] : []),
  ];

  return (
    <header ref={headerRef} className="relative mx-auto flex w-full max-w-md items-center justify-between px-6 pt-6">
      <Link href="/" className="text-2xl font-semibold text-coffee-200">
        TakApp
      </Link>
      <button
        onClick={() => setOpen((current) => !current)}
        aria-label={t('nav.menu')}
        aria-expanded={open}
        className="rounded-md border border-coffee-700 p-2 text-coffee-200"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      {open && (
        <nav className="absolute end-6 top-full mt-2 w-48 rounded-xl border border-coffee-700 bg-coffee-950 p-2 shadow">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`block rounded-md px-3 py-2 text-sm ${
                pathname === link.href
                  ? 'bg-coffee-600 text-coffee-50'
                  : 'border border-coffee-700 text-coffee-200'
              }`}
            >
              {link.label}
            </Link>
          ))}
          <button
            onClick={logout}
            className="mt-1 block w-full rounded-md border border-coffee-700 px-3 py-2 text-start text-sm text-coffee-200"
          >
            {t('nav.logOut')}
          </button>
        </nav>
      )}
    </header>
  );
}
