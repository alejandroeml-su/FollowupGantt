'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, Columns, CalendarDays, Target, FolderKanban, Building2,
  List, Users, Table, Network, FileText, ClipboardList,
  Zap, LayoutTemplate, Sparkles, ChevronDown, Eye, Settings, Briefcase,
  Menu, PanelLeftClose, BarChart3,
  type LucideIcon
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ─── Route types ─────────────────────────────────────────────────
interface RouteItem {
  name: string;
  path: string;
  icon: LucideIcon;
}

interface RouteGroup {
  label: string;
  icon: LucideIcon;
  color: string;       // accent color class for the group icon
  routes: RouteItem[];
}

// ─── Navigation structure ────────────────────────────────────────

const topRoutes: RouteItem[] = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Avante Brain AI', path: '/brain', icon: Sparkles },
];

const menuGroups: RouteGroup[] = [
  {
    label: 'Vistas',
    icon: Eye,
    color: 'text-cyan-400',
    routes: [
      { name: 'Lista', path: '/list', icon: List },
      { name: 'Kanban', path: '/kanban', icon: Columns },
      { name: 'Gantt', path: '/gantt', icon: CalendarDays },
      { name: 'Tabla', path: '/table', icon: Table },
      { name: 'Mind Maps', path: '/mindmaps', icon: Network },
    ],
  },
  {
    label: 'Gestión',
    icon: Briefcase,
    color: 'text-amber-400',
    routes: [
      { name: 'Docs & Wiki', path: '/docs', icon: FileText },
      { name: 'Formularios', path: '/forms', icon: ClipboardList },
      { name: 'Automatizaciones', path: '/automations', icon: Zap },
      { name: 'Dashboards KPI', path: '/dashboards', icon: LayoutTemplate },
      { name: 'KPIs de Proyectos', path: '/project-kpis', icon: BarChart3 },
    ],
  },
  {
    label: 'Configuración',
    icon: Settings,
    color: 'text-violet-400',
    routes: [
      { name: 'Roles & Permisos', path: '/settings/roles', icon: Settings },
      { name: 'Equipos', path: '/settings/teams', icon: Users },
      { name: 'Gerencias', path: '/gerencias', icon: Building2 },
      { name: 'Proyectos', path: '/projects', icon: FolderKanban },
      { name: 'Usuarios', path: '/settings/users', icon: Users },
      { name: 'Capacidad (WIP)', path: '/workload', icon: ClipboardList },
    ],
  },
];

import { useUIStore } from '@/lib/stores/ui';
import { ThemeToggle } from './ThemeToggle';
import { X, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';

// ─── Sidebar ─────────────────────────────────────────────────────

/**
 * Slot opcional para inyectar un footer de usuario server-rendered (ver
 * `<UserMenu/>`). Si se pasa `userSlot`, reemplaza el bloque "Usuario"
 * hardcoded con debug roles del MVP previo. Esto permite que el flujo de
 * Auth real (Ola P1) muestre al usuario autenticado vía cookie/Session
 * sin que el Sidebar (client component) tenga que importar lógica
 * server-only.
 */
export default function Sidebar({ userSlot }: { userSlot?: React.ReactNode } = {}) {
  const pathname = usePathname();
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);

  // ─── Control de Roles para Pruebas ────────────────────────────────
  const [debugRole, setDebugRole] = useState<'SUPER_ADMIN' | 'ADMIN' | 'AGENTE'>('SUPER_ADMIN');

  const isAdmin = debugRole === 'ADMIN' || debugRole === 'SUPER_ADMIN';

  // Filtrar rutas (Si es SUPER_ADMIN, no hay filtros)
  const filteredTopRoutes = debugRole === 'SUPER_ADMIN' ? topRoutes : topRoutes.filter(r => {
    // Lógica de permisos simplificada para la demo
    if (debugRole === 'ADMIN') return true;
    return r.path === '/' || r.path === '/list' || r.path === '/kanban';
  });

  const filteredMenuGroups = debugRole === 'SUPER_ADMIN' ? menuGroups : menuGroups.map(group => ({
    ...group,
    routes: group.routes.filter(r => {
      if (debugRole === 'ADMIN') return true;
      // Agente solo ve lo básico
      return ['list', 'kanban', 'table'].includes(r.path.split('/').pop() || '');
    })
  })).filter(group => group.routes.length > 0);

  // ─────────────────────────────────────────────────────────────────

  // Determine which groups should start open (if a child is active)
  const initialOpen = filteredMenuGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.label] = group.routes.some(r => r.path === pathname);
    return acc;
  }, {});

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(initialOpen);

  const toggle = (label: string) =>
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }));

  return (
    <>
      {/* Backdrop (Mobile only) */}
      {mobileOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity duration-300" 
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={twMerge(
        clsx(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-card text-foreground border-r border-border transition-all duration-300 ease-in-out lg:static lg:translate-x-0",
          // En mobile siempre usamos ancho pleno (w-72). En desktop (lg) respetamos colapso.
          "w-72",
          collapsed ? "lg:w-16" : "lg:w-72",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )
      )}>
        {/* ── Logo ─────────────────────────────────────────── */}
        <div className={clsx(
          "flex h-16 shrink-0 items-center border-b border-border bg-muted/30 transition-all duration-300",
          collapsed ? "lg:px-0 lg:justify-center px-6 justify-between" : "px-6 justify-between"
        )}>
          {/* Logo + título (oculto en colapsado desktop) */}
          <div className={clsx(
            "flex items-center overflow-hidden",
            collapsed && "lg:hidden"
          )}>
            <Target className="h-6 w-6 text-primary flex-shrink-0 mr-3" />
            <span className="text-lg font-bold text-foreground tracking-wide whitespace-nowrap">
              Avante Orq PRO
            </span>
          </div>

          {/* Cerrar (sólo mobile) */}
          <button
            className="p-1.5 rounded-lg hover:bg-accent lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>

          {/* Botón hamburguesa / colapsar (sólo desktop) */}
          <button
            className="hidden lg:flex items-center justify-center p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
            onClick={() => toggleCollapsed()}
            aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
            title={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        {/* ── Navigation ───────────────────────────────────── */}
        <div className={clsx(
          "flex flex-1 flex-col overflow-y-auto pt-5 custom-scrollbar",
          collapsed ? "lg:px-2 px-3" : "px-3"
        )}>
          {/* Section label */}
          <div className={clsx(
            "text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-3 px-2",
            collapsed && "lg:hidden"
          )}>
            Orquestación Híbrida
          </div>

          <nav className="flex-1 space-y-0.5">
            {/* ── Top-level routes ──────────────────────────── */}
            {filteredTopRoutes.map(route => (
              <NavLink
                key={route.path}
                route={route}
                pathname={pathname}
                collapsed={collapsed}
                onClick={() => setMobileOpen(false)}
              />
            ))}

            {/* ── Divider ──────────────────────────────────── */}
            <div className="!my-3 border-t border-border/60" />

            {/* ── Collapsible groups ────────────────────────── */}
            {filteredMenuGroups.map(group => {
              const isOpen = openGroups[group.label] ?? false;
              const hasActiveChild = group.routes.some(r => r.path === pathname);
              const GroupIcon = group.icon;

              // En modo colapsado (desktop) renderizamos los íconos de rutas
              // directamente, sin cabecera de grupo ni sub-colapsables.
              if (collapsed) {
                return (
                  <div key={group.label} className="hidden lg:block mb-1">
                    <div className="my-1 border-t border-border/40" />
                    {group.routes.map(route => (
                      <NavLink
                        key={route.path}
                        route={route}
                        pathname={pathname}
                        collapsed
                        onClick={() => setMobileOpen(false)}
                      />
                    ))}
                  </div>
                );
              }

              return (
                <div key={group.label} className="mb-1">
                  {/* Group header (toggle) */}
                  <button
                    onClick={() => toggle(group.label)}
                    className={twMerge(
                      clsx(
                        'w-full flex items-center justify-between px-3 py-2 text-[13px] font-semibold rounded-lg transition-all duration-200 select-none',
                        hasActiveChild
                          ? 'text-foreground bg-accent/60 shadow-sm'
                          : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
                      )
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <GroupIcon className={clsx('h-4 w-4 flex-shrink-0', group.color)} />
                      {group.label}
                    </span>
                    <ChevronDown
                      className={clsx(
                        'h-3.5 w-3.5 text-muted-foreground transition-transform duration-200',
                        isOpen && 'rotate-180'
                      )}
                    />
                  </button>

                  {/* Sub-routes with animated collapse */}
                  <div
                    className={clsx(
                      'overflow-hidden transition-all duration-200 ease-in-out',
                      isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                    )}
                  >
                    <div className="ml-2 mt-0.5 space-y-0.5 border-l border-border/50 pl-2">
                      {group.routes.map(route => (
                        <NavLink
                          key={route.path}
                          route={route}
                          pathname={pathname}
                          compact
                          onClick={() => setMobileOpen(false)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        {/* ── User footer & Debug ──────────────────────────── */}
        <div className={clsx(
          "border-t border-border bg-muted/10 transition-all duration-300",
          collapsed ? "lg:p-2 lg:space-y-2 p-4 space-y-4" : "p-4 space-y-4"
        )}>
          {/* Debug role switcher (oculto en colapsado desktop) */}
          <div className={clsx(
            "flex flex-col gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20",
            collapsed && "lg:hidden"
          )}>
             <div className="flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-tighter">
                <ShieldAlert className="h-3 w-3" />
                Debug Role Switcher
             </div>
             <div className="flex gap-1">
                {(['SUPER_ADMIN', 'ADMIN', 'AGENTE'] as const).map(r => (
                  <button
                    key={r}
                    onClick={() => setDebugRole(r)}
                    className={clsx(
                      'flex-1 text-[9px] font-bold py-1 px-1 rounded border transition-all',
                      debugRole === r
                        ? 'bg-primary text-primary-foreground border-primary shadow-sm'
                        : 'bg-background text-muted-foreground border-border hover:border-primary/50'
                    )}
                  >
                    {r.replace('_', ' ')}
                  </button>
                ))}
             </div>
          </div>

          {/* Tema */}
          <div className={clsx(
            "flex items-center px-2",
            collapsed ? "lg:justify-center lg:px-0 justify-between" : "justify-between"
          )}>
             <span className={clsx(
               "text-xs font-semibold text-muted-foreground uppercase tracking-widest",
               collapsed && "lg:hidden"
             )}>
               Tema
             </span>
             <ThemeToggle />
          </div>

          {/* Usuario · Auth real (server slot) si está disponible */}
          {userSlot ? (
            userSlot
          ) : (
            <div
              className={clsx(
                "flex items-center rounded-lg bg-accent/40 border border-border/50",
                collapsed ? "lg:justify-center lg:p-1 lg:border-0 lg:bg-transparent gap-3 px-2 py-2" : "gap-3 px-2 py-2"
              )}
              title={collapsed ? `Edwin Martinez — ${debugRole}` : undefined}
            >
              <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shadow-md flex-shrink-0">
                {debugRole === 'AGENTE' ? 'AG' : debugRole === 'ADMIN' ? 'AD' : 'SA'}
              </div>
              <div className={clsx("flex flex-col overflow-hidden", collapsed && "lg:hidden")}>
                <span className="text-xs font-medium text-foreground truncate">Edwin Martinez</span>
                <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                   {debugRole === 'SUPER_ADMIN' ? <ShieldCheck className="h-3 w-3 text-emerald-500" /> : <UserCog className="h-3 w-3 text-indigo-400" />}
                   {debugRole}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}


// ─── Reusable nav link ───────────────────────────────────────────

function NavLink({
  route,
  pathname,
  compact = false,
  collapsed = false,
  onClick,
}: {
  route: RouteItem;
  pathname: string;
  compact?: boolean;
  collapsed?: boolean;
  onClick?: () => void;
}) {
  const isActive = pathname === route.path;
  const Icon = route.icon;

  return (
    <Link
      href={route.path}
      onClick={onClick}
      title={collapsed ? route.name : undefined}
      aria-label={collapsed ? route.name : undefined}
      className={twMerge(
        clsx(
          'group flex items-center rounded-lg transition-all duration-200',
          collapsed
            ? 'lg:justify-center lg:px-2 lg:py-2.5 px-3 py-2.5 text-sm font-medium'
            : compact
              ? 'px-2.5 py-1.5 text-[13px]'
              : 'px-3 py-2.5 text-sm font-medium',
          isActive
            ? 'bg-primary/10 text-primary shadow-sm'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground'
        )
      )}
    >
      <Icon
        className={twMerge(
          clsx(
            'flex-shrink-0 transition-colors duration-200',
            collapsed
              ? 'lg:mr-0 mr-3 h-5 w-5'
              : compact
                ? 'mr-2.5 h-4 w-4'
                : 'mr-3 h-5 w-5',
            isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
          )
        )}
        aria-hidden="true"
      />
      <span className={clsx(collapsed && 'lg:hidden')}>{route.name}</span>
    </Link>
  );
}
