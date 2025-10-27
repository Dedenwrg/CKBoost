import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import Script from "next/script";
import { parseLogLevel, setLogLevel, type LogLevel } from "ssri-ckboost";

export const metadata: Metadata = {
  title: "CKBoost",
  description:
    "Decentralized campaign platform on CKB blockchain for community contribution rewards",
  generator: "Next.js",
};

const defaultLogLevel: LogLevel =
  process.env.NODE_ENV === "production" ? "error" : "debug";

const configuredLogLevel = parseLogLevel(
  process.env.NEXT_PUBLIC_CKBOOST_LOG_LEVEL ??
    process.env.NEXT_PUBLIC_LOG_LEVEL ??
    process.env.CKBOOST_LOG_LEVEL ??
    process.env.LOG_LEVEL,
  defaultLogLevel
);

setLogLevel(configuredLogLevel);

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>
          {children}
          {/* WUUNU SNIPPET - DON'T CHANGE THIS (START) */}
          {process.env.NODE_ENV !== "production" && (
            <>
              <Script id="wuunu-ws" strategy="afterInteractive">
                {`window.__WUUNU_WS__ = "http://127.0.0.1:54481/";`}
              </Script>
              <Script
                id="wuunu-widget"
                src="https://cdn.jsdelivr.net/npm/@wuunu/widget@0.1?cacheParam=440"
                strategy="afterInteractive"
                crossOrigin="anonymous"
              />
            </>
          )}
          {/* WUUNU SNIPPET - DON'T CHANGE THIS (END) */}
        </Providers>
      </body>
    </html>
  );
}
