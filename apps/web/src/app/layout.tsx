import type { Metadata, Viewport } from 'next';
import { TRPCProvider } from '../lib/trpc/provider';
import './globals.css';

export const metadata: Metadata = {
  title: 'TakApp',
  description: 'Non-custodial Stellar wallet for buying coffee with TAK.',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#1c1109',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TRPCProvider>{children}</TRPCProvider>
      </body>
    </html>
  );
}
