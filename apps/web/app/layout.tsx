import type { Metadata } from "next";
import localFont from "next/font/local";
import Script from "next/script";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "STAFFD — Your AI-Powered Business",
  description: "STAFFD gives every small business an AI-powered team. Marketing, Sales, Legal, HR, Finance — all working for you.",
  openGraph: {
    title: "STAFFD",
    description: "Your AI-powered business team. Get STAFFD.",
    siteName: "STAFFD",
  },
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
        {children}
      </body>
    </html>
  );
}
