import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-brico", axes: ["wdth", "opsz"] });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jet" });

export const metadata: Metadata = {
  title: "WARRANT · an AI that must earn the right to act",
  description:
    "A decision layer that prices every proposed action in expected regret, then issues a signed warrant (execute) or a stay (ask, defer, escalate, refuse).",
};

export const viewport: Viewport = { themeColor: "#efe8d8" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>
        {children}
        <div aria-hidden className="grain" />
        {/* ink-bleed filter for stamps and seals */}
        <svg aria-hidden width="0" height="0" className="absolute">
          <filter id="rough">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" result="n" />
            <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" />
          </filter>
        </svg>
      </body>
    </html>
  );
}
