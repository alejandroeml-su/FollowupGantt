import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FollowupGantt — Avante Orq PRO",
  description:
    "Gestión de proyectos PMI + Agile + ITIL de la Unidad de Transformación Digital de Complejo Avante.",
  applicationName: "Avante Orq",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Avante Orq",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icon-192.svg" }],
  },
};

export const viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  // Permitimos zoom para accesibilidad (WCAG 1.4.4); el Gantt define
  // `touch-action: pinch-zoom` localmente para gestos de zoom propios.
  maximumScale: 5,
};

import { headers } from "next/headers";
import Sidebar from "@/components/Sidebar";
import { AppInteractionShell } from "@/components/interactions/AppInteractionShell";
import { ThemeProvider } from "@/components/ThemeProvider";
import { MobileHeader } from "@/components/MobileHeader";
import { MobileBottomNav } from "@/components/mobile/MobileBottomNav";
import { MobileSidebarDrawer } from "@/components/mobile/MobileSidebarDrawer";
import { ServiceWorkerRegistrar } from "@/components/mobile/ServiceWorkerRegistrar";
import UserMenu from "@/components/auth/UserMenu";
import WorkspaceSwitcherSlot from "@/components/workspace/WorkspaceSwitcherSlot";

/**
 * Auth (Ola P1): la página `/login` no debe renderizar el Sidebar ni el
 * MobileHeader (chrome de la app). Detectamos el path desde el header
 * `x-pathname` que setea `proxy.ts`. Fallback: pathname vacío → renderiza
 * chrome (comportamiento previo).
 */
function shouldHideAppChrome(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const h = await headers();
  // Next 16 expone el path en `x-pathname` cuando lo seteamos en proxy.
  // En SSR plano no siempre está disponible, así que toleramos undefined.
  const pathname = h.get("x-pathname") ?? "";
  const hideChrome = shouldHideAppChrome(pathname);

  return (
    <html lang="es" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex h-full bg-background text-foreground overflow-hidden transition-colors duration-300">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
          {hideChrome ? (
            <main className="flex-1 flex flex-col overflow-auto relative w-full">
              {children}
            </main>
          ) : (
            <>
              <div className="flex h-full w-full flex-col lg:flex-row overflow-hidden">
                <MobileHeader />
                {/* Sidebar full en lg+, oculto en mobile (drawer lo reemplaza) */}
                <div className="hidden lg:flex">
                  <Sidebar
                    userSlot={<UserMenu />}
                    workspaceSwitcherSlot={<WorkspaceSwitcherSlot />}
                  />
                </div>
                {/* Drawer lateral mobile (slide-in desde la izquierda) */}
                <MobileSidebarDrawer userSlot={<UserMenu />} />
                <main className="flex-1 flex flex-col overflow-hidden relative pb-16 lg:pb-0">
                  {children}
                </main>
              </div>
              <AppInteractionShell />
              {/* Bottom nav fija en mobile, oculta en desktop */}
              <MobileBottomNav />
            </>
          )}
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
