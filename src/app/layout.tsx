import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stumblr.dev"),
  title: "Stumblr",
  description: "Explore the internet as your forefathers intended",
  alternates: { canonical: "https://stumblr.dev" },
  openGraph: {
    type: "website",
    url: "https://stumblr.dev",
    siteName: "Stumblr",
    title: "Stumblr",
    description: "Explore the internet as your forefathers intended",
    images: [{ url: "https://stumblr.dev/brand/stumblr-share-square.png", width: 512, height: 512, type: "image/png", alt: "Stumblr logo" }],
  },
  twitter: {
    card: "summary",
    title: "Stumblr",
    description: "Explore the internet as your forefathers intended",
    images: [{ url: "https://stumblr.dev/brand/stumblr-share-square.png", alt: "Stumblr logo" }],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
