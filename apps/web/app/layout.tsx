import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "STAFFD — Hire your business staff",
  description: "STAFFD staffs your business with specialists across Marketing, Sales, Legal, HR, Finance, Operations, Paid Media, Design, Reputation, and The CEO. On call the moment you sign up.",
  openGraph: {
    title: "STAFFD",
    description: "Staff your business. 83 specialists. 10 departments. On call the moment you hire them.",
    siteName: "STAFFD",
  },
  // Phase 7 — PWA manifest + iOS install hints. Apple ignores the manifest
  // and uses these meta tags instead for "Add to Home Screen".
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "STAFFD",
  },
};

export const viewport: Viewport = {
  themeColor: "#5B21E8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const plausibleUrl = process.env.NEXT_PUBLIC_PLAUSIBLE_URL;
  const plausibleDomain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN ?? "urstaffd.com";

  return (
    <html lang="en" className="dark">
      <head>
        {plausibleUrl && (
          <Script
            defer
            data-domain={plausibleDomain}
            src={`${plausibleUrl}/js/script.js`}
            strategy="afterInteractive"
          />
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <RegisterServiceWorker />
        {children}
      </body>
    </html>
  );
}
