import type { Metadata } from 'next';
import './globals.css';
import './dusk.css';
import Navigation from '@/components/Navigation';

export const metadata: Metadata = {
  title: 'Finomaly — Keystroke Biometrics Prototype',
  description: 'A research prototype exploring keystroke dynamics as an auxiliary identity signal.',
  applicationName: 'Finomaly',
  icons: {
    icon: '/favicon.svg',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#101315" />
      </head>
      <body>
        <Navigation />
        {children}
      </body>
    </html>
  );
}
