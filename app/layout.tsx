import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Agent Spend Guard",
  description:
    "Reference integration for agentic stablecoin payments on Fireblocks: x402 request integrity, delegated mandates, and Policy Engine guardrails. Unofficial demo by Kieran Sweeney.",
};

export const viewport: Viewport = { themeColor: "#131629" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${figtree.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
