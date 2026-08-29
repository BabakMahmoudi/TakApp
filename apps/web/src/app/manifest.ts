import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'TakApp',
    short_name: 'TakApp',
    description: 'Non-custodial Stellar wallet for buying coffee with TAK.',
    start_url: '/',
    display: 'standalone',
    background_color: '#1c1109',
    theme_color: '#1c1109',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
