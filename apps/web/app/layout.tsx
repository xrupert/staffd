import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import RegisterServiceWorker from "./components/RegisterServiceWorker";
import PlausibleScript from "./components/PlausibleScript";
import StaleClientStateCleanup from "./components/StaleClientStateCleanup";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "STAFFD — Tell your staff what to accomplish",
  description:
    "Brief STAFFD in plain language. Your AI business staff plans, executes, reviews, and delivers coordinated work while you remain in control.",
  openGraph: {
    title: "STAFFD — Your AI business staff",
    description:
      "Ask for a business outcome. STAFFD assembles the right specialists, coordinates your tools, reviews the work, and brings you the result.",
    siteName: "STAFFD",
  },
  twitter: {
    card: "summary",
    title: "STAFFD — Your AI business staff",
    description:
      "Ask for a business outcome. STAFFD plans, coordinates, reviews, and delivers the work.",
  },
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
  return (
    <html lang="en" className="dark">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <PlausibleScript />
        <RegisterServiceWorker />
        <StaleClientStateCleanup />
        {children}
      </body>
    </html>
  );
}
