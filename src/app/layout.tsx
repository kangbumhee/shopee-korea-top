import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Korea Top',
  description: 'Shopee 한국 발송 랭킹',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
