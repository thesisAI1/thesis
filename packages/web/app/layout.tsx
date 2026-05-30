import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import "./tokens.css";
import "./globals.css";
import { GatesIntro } from "@/components/intro/GatesIntro";

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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // First-visit gate decided server-side: the overlay renders in the correct
  // state on first paint (covering the page for new visitors, absent for
  // returning ones). The cookie is written client-side when the intro ends.
  const firstVisit = (await cookies()).get("thesis_intro_seen")?.value !== "1";

  return (
    <html lang="en" className={`${GeistSans.variable} ${mono.variable}`}>
      <body>
        {/* Cinematic first-visit entrance — overlays everything, then dissolves. */}
        <GatesIntro firstVisit={firstVisit} />
        {/* Fixed grid + glow void behind everything */}
        <div className="bg-field" aria-hidden="true" />
        {children}
      </body>
    </html>
  );
}
