/**
 * Layout dedicado para `/forms/[slug]`. Anula el Sidebar/MobileHeader del
 * root layout para presentar el formulario público sin distractores
 * internos del producto. Los hijos heredan `<html>` + `<body>` +
 * `<ThemeProvider>`.
 */
export default function PublicFormLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <>{children}</>
}
