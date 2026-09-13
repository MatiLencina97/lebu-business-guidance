import './globals.css';
import type { Metadata, Viewport } from 'next';
import Script from 'next/script';
import PwaRegister from './PwaRegister';

export const metadata: Metadata = {
  title: { default: 'Lebu', template: '%s · Lebu' },
  description: 'Lebu vigila el ritmo de tu negocio, entiende tus números y te guía hacia tu objetivo de ganancia.',
  applicationName: 'Lebu',
  manifest: '/manifest.webmanifest',
  formatDetection: { telephone: false },
  appleWebApp: {
    capable: true,
    title: 'Lebu',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#f7f8f4',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body>
        <Script
          id="lebu-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('lebu.appearance.v1')||'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);var t=d?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.dataset.themePreference=p;document.documentElement.style.colorScheme=t;var c=d?'#08171a':'#f7f8f4';document.querySelectorAll('meta[name=theme-color]').forEach(function(m){m.setAttribute('content',c);});}catch(e){}})();`,
          }}
        />
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
