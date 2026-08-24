import './globals.css';
import { COPY } from '@/lib/copy';

export const metadata = {
  title: COPY.pageTitle,
  description: 'Recent poll results and watch state for the Campground Crawler poller.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
