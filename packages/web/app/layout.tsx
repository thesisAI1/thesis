import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import "./tokens.css";
import "./globals.css";

/**
 * Fonts via next/font:
 *  - Geist (display/sans) self-hosted by the `geist` package → --font-geist-sans
 *  - JetBrains Mono (data/labels/addresses) from Google → --font-jbmono
 * tokens.css wires both into --sans / --mono. No render-blocking @import.
 */
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jbmono",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "THESIS — the committee that trades your theses",
  description:
    "An autonomous AI committee that reads token theses on X, grades them A–F, and trades them on Base. It pays the thesis author 25% of every winning trade.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${mono.variable}`}>
      <body>
        {/* Fixed grid + glow void behind everything */}
        <div className="bg-field" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
