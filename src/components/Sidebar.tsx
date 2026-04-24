'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  LayoutDashboard, Columns, CalendarDays, Target, FolderKanban, Building2,
  List, Users, Table, Network, FileText, ClipboardList, 
  Zap, LayoutTemplate, Sparkles, ChevronDown, Eye, Settings, Briefcase,
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
    ],
  },
  {
    label: 'Configuración',
    icon: Settings,
    color: 'text-violet-400',
    routes: [
      { name: 'Gerencias', path: '/gerencias', icon: Building2 },
      { name: 'Proyectos', path: '/projects', icon: FolderKanban },
      { name: 'Usuarios', path: '/workload', icon: Users },
      { name: 'Equipos', path: '/settings/teams', icon: Users },
      { name: 'Roles & Permisos', path: '/settings/roles', icon: Settings },
    ],
  },
];

import { useUIStore } from '@/lib/stores/ui';
import { ThemeToggle } from './ThemeToggle';
import { X } from 'lucide-react';

// ─── Sidebar ─────────────────────────────────────────────────────

export default function Sidebar() {
  const pathname = usePathname();
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);

  // ─── Simulación de Usuario y Roles (Mapeo de Vistas) ────────────────
  // En producción, esto vendría de la base de datos (prisma.user.findUnique...)
  const currentUser = {
    roles: [
      { 
        name: 'SUPER_ADMIN', 
        permissions: { allowedViews: ['list', 'kanban', 'gantt', 'table', 'docs', 'forms', 'gerencias', 'projects', 'workload', 'teams', 'roles', 'settings'] } 
      }
    ]
  };

  const allowedViews = currentUser.roles.flatMap(r => r.permissions?.allowedViews || []);
  const isAdmin = currentUser.roles.some(r => r.name === 'ADMIN' || r.name === 'SUPER_ADMIN');

  // Filtrar rutas basadas en permisos
  const filteredTopRoutes = isAdmin ? topRoutes : topRoutes.filter(r => {
    const viewName = r.path === '/' ? '' : r.path.replace('/', '');
    return allowedViews.includes(viewName);
  });

  const filteredMenuGroups = isAdmin ? menuGroups : menuGroups.map(group => ({
    ...group,
    routes: group.routes.filter(r => {
      const viewName = r.path.split('/').pop() || '';
      return allowedViews.includes(viewName);
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
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card text-foreground border-r border-border transition-all duration-300 ease-in-out lg:static lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )
      )}>
        {/* ── Logo ─────────────────────────────────────────── */}
        <div className="flex h-16 shrink-0 items-center justify-between px-6 border-b border-border bg-muted/30">
          <div className="flex items-center">
            <Target className="h-6 w-6 text-primary mr-3" />
            <span className="text-lg font-bold text-foreground tracking-wide">Avante Orq</span>
          </div>
          <button 
            className="p-1.5 rounded-lg hover:bg-accent lg:hidden"
            onClick={() => setMobileOpen(false)}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>
        </div>

        {/* ── Navigation ───────────────────────────────────── */}
        <div className="flex flex-1 flex-col overflow-y-auto pt-5 px-3 custom-scrollbar">
          {/* Section label */}
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-3 px-2">
            Orquestación Híbrida
          </div>

          <nav className="flex-1 space-y-0.5">
            {/* ── Top-level routes ──────────────────────────── */}
            {filteredTopRoutes.map(route => (
              <NavLink key={route.path} route={route} pathname={pathname} onClick={() => setMobileOpen(false)} />
            ))}

            {/* ── Divider ──────────────────────────────────── */}
            <div className="!my-3 border-t border-border/60" />

            {/* ── Collapsible groups ────────────────────────── */}
            {filteredMenuGroups.map(group => {
              const isOpen = openGroups[group.label] ?? false;
              const hasActiveChild = group.routes.some(r => r.path === pathname);
              const GroupIcon = group.icon;

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
                        <NavLink key={route.path} route={route} pathname={pathname} compact onClick={() => setMobileOpen(false)} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </nav>
        </div>

        {/* ── User footer ──────────────────────────────────── */}
        <div className="p-4 border-t border-border bg-muted/10 space-y-4">
          <div className="flex items-center justify-between px-2">
             <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Tema</span>
             <ThemeToggle />
          </div>
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-accent/40 border border-border/50">
            <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center text-sm font-bold text-primary-foreground shadow-md">
              EM
            </div>
            <div className="flex flex-col">
              <span className="text-xs font-medium text-foreground">Edwin Martinez</span>
              <span className="text-[10px] text-muted-foreground">PM Híbrido</span>
            </div>
          </div>
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
  onClick,
}: {
  route: RouteItem;
  pathname: string;
  compact?: boolean;
  onClick?: () => void;
}) {
  const isActive = pathname === route.path;
  const Icon = route.icon;

  return (
    <Link
      href={route.path}
      onClick={onClick}
      className={twMerge(
        clsx(
          'group flex items-center rounded-lg transition-all duration-200',
          compact ? 'px-2.5 py-1.5 text-[13px]' : 'px-3 py-2.5 text-sm font-medium',
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
            compact ? 'mr-2.5 h-4 w-4' : 'mr-3 h-5 w-5',
            isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
          )
        )}
        aria-hidden="true"
      />
      {route.name}
    </Link>
  );
}
