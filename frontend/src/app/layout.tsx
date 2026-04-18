import type { Metadata } from "next";
import { manrope, newsreader } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Déléguè — IA WhatsApp pour le Maroc",
  description:
    "Déléguez vos conversations WhatsApp à l'IA. Service client automatisé qui comprend le Darija, le Français et l'Anglais.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      className={`${manrope.variable} ${newsreader.variable} h-full antialiased`}
      suppressHydrationWarning
      data-scroll-behavior="smooth"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
