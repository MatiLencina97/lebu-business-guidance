import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Lebu',
    short_name: 'Lebu',
    description: 'Vigila, entiende, te guía. Sabé cuánto necesitás vender para alcanzar tu objetivo de ganancia.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f7f8f4',
    theme_color: '#04383c',
    orientation: 'portrait-primary',
    categories: ['business', 'finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
