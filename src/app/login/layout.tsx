/**
 * Layout dedicado para `/login`. Anula el Sidebar/MobileHeader del root
 * layout para presentar una pantalla de auth limpia. Los hijos heredan
 * `<html>` + `<body>` + `<ThemeProvider>` del root.
 */
export default function LoginLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
