import type { Metadata } from "next";
import { Syne, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const syne = Syne({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Anvil — DAT-paid GPU coding agent",
  description:
    "Host the storefront on AWS. Run the coding agent on your P720 with an RTX 3090. Pay with DAT through Sage.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${syne.variable} ${plexMono.variable} min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
