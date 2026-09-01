'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useWallet } from '../lib/wallet-provider';

export default function NavBar() {
  const { session, logout, isAdmin } = useWallet();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);

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
    { href: '/', label: 'Home' },
    { href: '/wallet', label: 'Wallet' },
    { href: '/buy', label: 'Buy Coffee' },
    { href: '/send', label: 'Send TAK' },
    { href: '/tak', label: 'Get TAK' },
    { href: '/profile', label: 'Profile' },
    ...(isAdmin ? [{ href: '/admin', label: 'Admin Panel' }] : []),
  ];

  return (
    <header ref={headerRef} className="relative mx-auto flex w-full max-w-md items-center justify-between px-6 pt-6">
      <Link href="/" className="text-2xl font-semibold text-coffee-200">
        TakApp
      </Link>
      <button
        onClick={() => setOpen((current) => !current)}
        aria-label="Menu"
        aria-expanded={open}
        className="rounded-md border border-coffee-700 p-2 text-coffee-200"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14" />
        </svg>
      </button>
      {open && (
        <nav className="absolute right-6 top-full mt-2 w-48 rounded-xl border border-coffee-700 bg-coffee-950 p-2 shadow">
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
            className="mt-1 block w-full rounded-md border border-coffee-700 px-3 py-2 text-left text-sm text-coffee-200"
          >
            Log out
          </button>
        </nav>
      )}
    </header>
  );
}
