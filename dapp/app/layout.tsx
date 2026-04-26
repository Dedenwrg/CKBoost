import type { Metadata } from "next";
import { Layout, Navbar, Footer } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import Link from "next/link";
import Script from "next/script";
import "./globals.css";
import "nextra-theme-docs/style.css";
import { Providers } from "@/components/providers";
import { WalletConnect } from "@/components/wallet-connect";
import { ThemeToggle } from "@/components/theme-toggle";
import { PointsBalance } from "@/components/points-balance";
import { parseLogLevel, setLogLevel, type LogLevel } from "ssri-ckboost";

export const metadata: Metadata = {
  title: "CKBoost",
  description:
    "Decentralized campaign platform on CKB blockchain for community contribution rewards",
  generator: "Next.js",
};

const navbar = (
  <Navbar
    logo={
      <div className="flex items-center gap-2 mr-18">
        <img
          src="/assets/branding/CKBoost Pixel Art Logo - Navigation.svg"
          alt="CKBoost"
          className="h-8 w-auto hidden dark:block"
          style={{ imageRendering: "pixelated" }}
        />
        <img
          src="/assets/branding/CKBoost Pixel Art Logo - Navigation - Inverted.svg"
          alt="CKBoost"
          className="h-8 w-auto block dark:hidden"
          style={{ imageRendering: "pixelated" }}
        />
      </div>
    }
    logoLink="/"
    align="left"
  >
    <div className="hidden md:flex items-center gap-3">
      <Link
        href="/docs"
        className="inline-flex items-center rounded-full border border-[#0000FF] px-4 py-2 text-sm font-medium text-[#0000FF] transition-colors hover:bg-[#0000FF] hover:text-white dark:border-white/30 dark:text-white dark:hover:bg-white/10"
      >
        Docs
      </Link>
      <PointsBalance />
      <WalletConnect />
      <ThemeToggle />
    </div>
  </Navbar>
);

const footer = (
  <div style={{ position: "relative", zIndex: 20, backgroundColor: "#000000" }}>
    <Footer>© {new Date().getFullYear()} CKBoost.</Footer>
  </div>
);

const defaultLogLevel: LogLevel =
  process.env.NODE_ENV === "production" ? "error" : "debug";

const configuredLogLevel = parseLogLevel(
  process.env.NEXT_PUBLIC_CKBOOST_LOG_LEVEL ??
    process.env.NEXT_PUBLIC_LOG_LEVEL ??
    process.env.CKBOOST_LOG_LEVEL ??
    process.env.LOG_LEVEL,
  defaultLogLevel,
);

setLogLevel(configuredLogLevel);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const pageMap = await getPageMap();

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <Providers>
          <Layout
            navbar={navbar}
            footer={footer}
            pageMap={pageMap}
            docsRepositoryBase="https://github.com/Alive24/CKBoost/tree/main/dapp/content"
          >
            {children}
          </Layout>
          {/* WUUNU SNIPPET - DON'T CHANGE THIS (START) */}
          {/* {process.env.NODE_ENV !== "production" && (
            <>
              <Script id="wuunu-ws" strategy="afterInteractive">
                {`window.__WUUNU_WS__ = "http://127.0.0.1:65051/?token=365f185309b1a2d457f3ed34448dbb0f66cf94c5a500fe75";`}
              </Script>
              <Script
                id="wuunu-widget"
                src="https://cdn.jsdelivr.net/npm/@wuunu/widget@0.1?cacheParam=440"
                strategy="afterInteractive"
                crossOrigin="anonymous"
              />
            </>
          )} */}
          {/* WUUNU SNIPPET - DON'T CHANGE THIS (END) */}
        </Providers>
      </body>
    </html>
  );
}
