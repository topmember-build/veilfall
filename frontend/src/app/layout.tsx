import type { Metadata, Viewport } from "next";
import "@fontsource-variable/bodoni-moda/wght.css";
import "@fontsource-variable/bodoni-moda/wght-italic.css";
import "@fontsource-variable/hanken-grotesk/wght.css";
import "./globals.css";
import { Ambient } from "@/components/Ambient";

export const metadata: Metadata = {
  title: "Veilfall",
  description:
    "Mafia with no host. The contract is the moderator and it can't peek: roles, night moves and votes stay encrypted on-chain with Zama's FHE.",
};

export const viewport: Viewport = { themeColor: "#0a0912", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="night">
      <body>
        <Ambient />
        {children}
      </body>
    </html>
  );
}
