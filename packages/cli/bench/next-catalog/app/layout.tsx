import type { ReactNode } from 'react';

export const metadata = { title: 'Catalog benchmark (Next.js)' };

// The stylesheet is linked by hand rather than imported, for the same reason
// every other port links it by hand: the measurement script refuses a page
// whose stylesheet did not apply, and it has to be THE shared app.css --
// letting Next inline or hash it would make this port's CSS bytes a different
// thing from everyone else's in the weight table.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
