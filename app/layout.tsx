import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/providers/auth-provider";
import { BabaProvider } from "@/components/providers/baba-provider";
import { PwaRegister } from "@/components/pwa-register";

export const metadata: Metadata = {
  title: { default: "Baba Psyzon", template: "%s · Baba Psyzon" },
  description: "Organize seu baba, acompanhe partidas e rankings em tempo real.",
  applicationName: "Baba Psyzon",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Baba Psyzon" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/icon-180.png" },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media: "(prefers-color-scheme: light)", color: "#f4f7fb" }, { media: "(prefers-color-scheme: dark)", color: "#09111f" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR" suppressHydrationWarning><body><AuthProvider><BabaProvider>{children}</BabaProvider></AuthProvider><PwaRegister /></body></html>;
}
