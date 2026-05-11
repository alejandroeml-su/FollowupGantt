import type { Metadata, Viewport } from "next";
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
  title: "Sync · Plataforma de gestión de proyectos",
  description:
    "Sync · Plataforma de gestión PMI + Agile + ITIL de la Unidad de Transformación Digital de Complejo Avante.",
  applicationName: "Sync",
  // Wave P20-A: `manifest.webmanifest` es el nuevo canonico (MIME
  // `application/manifest+json`). El `/manifest.json` legado sigue
  // sirviendose para compatibilidad con clientes que ya lo cachearon
  // via el SW heredado `/sw.js`.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Sync",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icon-sync.svg", type: "image/svg+xml" },
      // PNG placeholders (Wave P20-A) requeridos por algunos clientes
      // (Safari) y el manifest.webmanifest. Ver `public/icons/`.
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { url: "/icon-192.svg", sizes: "192x192", type: "image/svg+xml" },
      { url: "/icon-512.svg", sizes: "512x512", type: "image/svg+xml" },
    ],
    apple: [{ url: "/icons/icon-192.png", sizes: "192x192" }],
  },
};

export const viewport: Viewport = {
  // Wave P20-A: theme_color se alinea con manifest.webmanifest
  // (`#4f46e5`). Aceptamos override por color-scheme en navegadores
  // que respeten `prefers-color-scheme` con dos valores.
  themeColor: "#4f46e5",
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
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { PwaUpdateBanner } from "@/components/pwa/PwaUpdateBanner";
import UserMenu from "@/components/auth/UserMenu";
import WorkspaceSwitcherSlot from "@/components/workspace/WorkspaceSwitcherSlot";
import { SupportChatbot } from "@/components/support/SupportChatbot";

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
          {/* Wave P20-A: PWA installable + update banner. PwaUpdateBanner
              registra el SW canonico `/service-worker.js`. */}
          {!hideChrome && <InstallPrompt />}
          <PwaUpdateBanner />
          {/* Support Chatbot flotante · oculto a sí mismo en /login,
              /invite/*, /forgot-password, /reset-password vía
              usePathname. Disponible para cualquier rol autenticado. */}
          {!hideChrome && <SupportChatbot />}
        </ThemeProvider>
      </body>
    </html>
  );
}
