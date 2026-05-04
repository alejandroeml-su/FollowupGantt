'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard, CalendarDays, Target, FolderKanban, Building2,
  List, Users, Table, Network, FileText, ClipboardList,
  Zap, LayoutTemplate, Sparkles, ChevronDown, Settings, Briefcase,
  Menu, PanelLeftClose, BarChart3, Rocket, Clock, Compass, Key, Cable, ScrollText,
  Bell, PenSquare, Brain, Scale, FileBarChart, Plug, FileSignature, Workflow,
  DatabaseBackup, UserPlus,
  type LucideIcon
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// ─── Route types ─────────────────────────────────────────────────
//
// Ola P4 · P4-4 — `name`/`label` ahora son keys de i18n
// (`sidebar.items.*`, `sidebar.groups.*`). Cada NavLink llama `t(name)`
// al renderizar. Ruta y key viajan desacopladas para que el Sidebar
// pueda traducirse sin hardcodear strings.
//
// Ola P5 · D1 — `roles` declara qué roles pueden ver el item; los
// filtros se aplican luego en `filteredMenuGroups`/`filteredTopRoutes`.
// Si el campo se omite, se considera visible para todos los roles.
type DebugRole = 'SUPER_ADMIN' | 'ADMIN' | 'AGENTE';

interface RouteItem {
  /** Clave i18n bajo `sidebar.items.*` o `sidebar.*` para items top. */
  name: string;
  path: string;
  icon: LucideIcon;
  /** Roles autorizados. Por defecto: todos. */
  roles?: ReadonlyArray<DebugRole>;
}

interface RouteGroup {
  /** Clave i18n bajo `sidebar.groups.*`. */
  label: string;
  icon: LucideIcon;
  color: string;       // accent color class for the group icon
  routes: RouteItem[];
  /** Roles autorizados a ver el grupo entero. Por defecto: todos. */
  roles?: ReadonlyArray<DebugRole>;
}

const ALL_ROLES: ReadonlyArray<DebugRole> = ['SUPER_ADMIN', 'ADMIN', 'AGENTE'];
const ADMIN_ROLES: ReadonlyArray<DebugRole> = ['SUPER_ADMIN', 'ADMIN'];
const SUPER_ONLY: ReadonlyArray<DebugRole> = ['SUPER_ADMIN'];

// ─── Navigation structure ────────────────────────────────────────

// Top-level (siempre visibles): items que el usuario abre 10 veces al
// día. Ola P5 · D1 añadimos Tareas (atajo a /list), Calendario,
// Notificaciones (con badge inyectado en el footer) y Pizarras.
const topRoutes: RouteItem[] = [
  { name: 'sidebar.dashboard', path: '/', icon: LayoutDashboard },
  { name: 'sidebar.items.list', path: '/list', icon: List },
  { name: 'sidebar.items.gantt', path: '/gantt', icon: CalendarDays },
  { name: 'sidebar.items.calendar', path: '/calendar', icon: CalendarDays },
  { name: 'sidebar.items.table', path: '/table', icon: Table },
  { name: 'sidebar.items.mindmaps', path: '/mindmaps', icon: Network },
  { name: 'sidebar.items.notifications', path: '/notifications', icon: Bell },
  { name: 'sidebar.items.whiteboards', path: '/whiteboards', icon: PenSquare },
  { name: 'sidebar.brain', path: '/brain', icon: Sparkles },
];

const menuGroups: RouteGroup[] = [
  // ── Estrategia (amber) ──────────────────────────────────────────
  // OKRs, reportes ejecutivos y AI Insights. Visible a todos los
  // roles; AGENTE puede consultar status reports de sus proyectos.
  {
    label: 'sidebar.groups.strategy',
    icon: Target,
    color: 'text-amber-400',
    routes: [
      { name: 'sidebar.items.goals', path: '/goals', icon: Compass },
      { name: 'sidebar.items.executiveReports', path: '/reports', icon: FileBarChart },
      { name: 'sidebar.items.aiInsights', path: '/insights', icon: Brain },
    ],
  },
  // ── Operación (cyan) ────────────────────────────────────────────
  // Tracking diario: sprints, plantillas, timesheets, workload y
  // resource leveling.
  {
    label: 'sidebar.groups.operations',
    icon: Zap,
    color: 'text-cyan-400',
    routes: [
      { name: 'sidebar.items.sprints', path: '/sprints', icon: Rocket },
      { name: 'sidebar.items.templates', path: '/templates', icon: LayoutTemplate },
      { name: 'sidebar.items.timesheets', path: '/timesheets', icon: Clock },
      { name: 'sidebar.items.workload', path: '/workload', icon: ClipboardList },
      { name: 'sidebar.items.leveling', path: '/leveling', icon: Scale },
    ],
  },
  // ── Documentación & Procesos (gestión cualitativa) ─────────────
  // Mantenemos un grupo aparte para artefactos que no son ni
  // estrategia ni operación pura (docs, KPIs, formularios públicos
  // de captura, automatizaciones de tareas).
  {
    label: 'sidebar.groups.management',
    icon: Briefcase,
    color: 'text-rose-400',
    routes: [
      { name: 'sidebar.items.docs', path: '/docs', icon: FileText },
      { name: 'sidebar.items.forms', path: '/forms', icon: ClipboardList },
      { name: 'sidebar.items.automations', path: '/automations', icon: Zap },
      { name: 'sidebar.items.kpiDashboards', path: '/dashboards', icon: LayoutTemplate },
      { name: 'sidebar.items.projectKpis', path: '/project-kpis', icon: BarChart3 },
    ],
  },
  // ── Workspace (emerald, NUEVO) ──────────────────────────────────
  // Ola P4 · P4-1 — Multi-tenant. Solo ADMIN/SUPER_ADMIN gestionan
  // workspaces, miembros e invitaciones.
  {
    label: 'sidebar.groups.workspace',
    icon: Briefcase,
    color: 'text-emerald-400',
    roles: ADMIN_ROLES,
    routes: [
      { name: 'sidebar.items.workspaces', path: '/settings/workspace', icon: Briefcase },
      { name: 'sidebar.items.members', path: '/settings/workspace/members', icon: Users },
      { name: 'sidebar.items.invitations', path: '/settings/workspace/members?tab=invitations', icon: UserPlus },
    ],
  },
  // ── Configuración (violet) ──────────────────────────────────────
  // Solo ADMIN/SUPER_ADMIN. Tokens API y Backup global son
  // exclusivos de SUPER_ADMIN.
  {
    label: 'sidebar.groups.settings',
    icon: Settings,
    color: 'text-violet-400',
    roles: ADMIN_ROLES,
    routes: [
      { name: 'sidebar.items.rolesPermissions', path: '/settings/roles', icon: Settings },
      { name: 'sidebar.items.teams', path: '/settings/teams', icon: Users },
      { name: 'sidebar.items.gerencias', path: '/gerencias', icon: Building2 },
      { name: 'sidebar.items.projects', path: '/projects', icon: FolderKanban },
      { name: 'sidebar.items.users', path: '/settings/users', icon: Users },
      { name: 'sidebar.items.calendars', path: '/settings/calendars', icon: CalendarDays },
      // Ola P3 · P3-2 · Audit Log centralizado (compliance ITIL/SOC2).
      { name: 'sidebar.items.audit', path: '/audit-log', icon: ScrollText },
      // Ola P5 · D1 — Integraciones, formularios admin, automatizaciones.
      { name: 'sidebar.items.integrations', path: '/settings/integrations', icon: Plug },
      { name: 'sidebar.items.formsAdmin', path: '/settings/forms', icon: FileSignature },
      { name: 'sidebar.items.automationsAdmin', path: '/settings/automation', icon: Workflow },
      // Ola P4 · P4-2 · API REST + Webhooks. Restringidos a SUPER_ADMIN.
      { name: 'sidebar.items.apiTokens', path: '/settings/api', icon: Key, roles: SUPER_ONLY },
      { name: 'sidebar.items.webhooks', path: '/settings/webhooks', icon: Cable, roles: SUPER_ONLY },
      // Backup/Restore vive a nivel proyecto (UI en /projects/[id]).
      // Exponemos un atajo al listado para SUPER_ADMIN; el botón real
      // sigue dentro del detalle de cada proyecto. Usamos `?backup=1`
      // como anchor para diferenciar el key del item "Proyectos" (mismo
      // pathname) y opcionalmente abrir el panel correspondiente.
      {
        name: 'sidebar.items.backupRestore',
        path: '/projects?backup=1',
        icon: DatabaseBackup,
        roles: SUPER_ONLY,
      },
    ],
  },
];

import { useUIStore } from '@/lib/stores/ui';
import { ThemeToggle } from './ThemeToggle';
import { NotificationsBell } from './notifications/NotificationsBell';
import { useTranslation } from '@/lib/i18n/use-translation';
import { X, ShieldAlert, ShieldCheck, UserCog } from 'lucide-react';

// ─── Helpers de filtrado por rol ─────────────────────────────────

function isVisibleForRole(
  role: DebugRole,
  allowed: ReadonlyArray<DebugRole> | undefined,
): boolean {
  return !allowed || allowed.includes(role);
}

function filterTopRoutes(role: DebugRole): RouteItem[] {
  return topRoutes.filter((r) => isVisibleForRole(role, r.roles ?? ALL_ROLES));
}

function filterMenuGroups(role: DebugRole): RouteGroup[] {
  return menuGroups
    .filter((g) => isVisibleForRole(role, g.roles ?? ALL_ROLES))
    .map((g) => ({
      ...g,
      routes: g.routes.filter((r) =>
        isVisibleForRole(role, r.roles ?? ALL_ROLES),
      ),
    }))
    .filter((g) => g.routes.length > 0);
}

// ─── Active path helper ──────────────────────────────────────────

/**
 * Coincidencia activa por exactitud o por prefijo "razonable":
 *   - `/` solo coincide consigo mismo (evita marcar Dashboard en todas
 *     las páginas).
 *   - Cualquier otra ruta coincide si `pathname === path` o si
 *     `pathname` empieza con `path + '/'` (sub-rutas), o si comparten
 *     el mismo "section root" (e.g. `/list` activo en `/kanban` cuando
 *     ambos son vistas de tareas — D1 alinea esto con el comportamiento
 *     del MobileBottomNav existente).
 */
function isActivePath(itemPath: string, currentPath: string): boolean {
  if (itemPath === '/') return currentPath === '/';

  // Strip query string para comparar paths (ej: invitaciones usa ?tab=)
  const cleanItem = itemPath.split('?')[0];
  if (currentPath === cleanItem) return true;
  if (currentPath.startsWith(cleanItem + '/')) return true;

  // Section root: las vistas de tareas (/list, /kanban, /table, /gantt,
  // /calendar) son intercambiables — marcar /list como activo si el
  // usuario está en /kanban o /table mantiene la "tab Tareas" iluminada.
  const taskViews = ['/list', '/kanban', '/table'];
  if (taskViews.includes(cleanItem) && taskViews.includes(currentPath)) {
    return true;
  }

  return false;
}

// ─── Sidebar ─────────────────────────────────────────────────────

/**
 * Slot opcional para inyectar un footer de usuario server-rendered (ver
 * `<UserMenu/>`). Si se pasa `userSlot`, reemplaza el bloque "Usuario"
 * hardcoded con debug roles del MVP previo. Esto permite que el flujo de
 * Auth real (Ola P1) muestre al usuario autenticado vía cookie/Session
 * sin que el Sidebar (client component) tenga que importar lógica
 * server-only.
 *
 * Ola P4 · Equipo P4-1 — `workspaceSwitcherSlot` permite inyectar el
 * `<WorkspaceSwitcher/>` con los datos resueltos en server. Si no se
 * pasa, el header del sidebar conserva su layout original.
 */
export default function Sidebar({
  userSlot,
  workspaceSwitcherSlot,
}: {
  userSlot?: React.ReactNode
  workspaceSwitcherSlot?: React.ReactNode
} = {}) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const mobileOpen = useUIStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useUIStore((s) => s.setMobileSidebarOpen);
  const collapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleCollapsed = useUIStore((s) => s.toggleSidebarCollapsed);

  // ─── Control de Roles para Pruebas ────────────────────────────────
  // Ola P5 · D1 — el filtrado real se hace por `roles?: DebugRole[]`
  // declarados en cada item/grupo. AGENTE no ve "Configuración" ni
  // "Workspace"; SUPER_ADMIN ve todo.
  const [debugRole, setDebugRole] = useState<DebugRole>('SUPER_ADMIN');

  const filteredTopRoutes = filterTopRoutes(debugRole);
  const filteredMenuGroups = filterMenuGroups(debugRole);

  // ─────────────────────────────────────────────────────────────────

  // Determine which groups should start open (if a child is active)
  const initialOpen = filteredMenuGroups.reduce<Record<string, boolean>>((acc, group) => {
    acc[group.label] = group.routes.some((r) => isActivePath(r.path, pathname));
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
            aria-label={t('sidebar.menuClose')}
          >
            <X className="h-5 w-5 text-muted-foreground" />
          </button>

          {/* Botón hamburguesa / colapsar (sólo desktop) */}
          <button
            className="hidden lg:flex items-center justify-center p-1.5 rounded-lg hover:bg-accent text-muted-foreground transition-colors"
            onClick={() => toggleCollapsed()}
            aria-label={collapsed ? t('sidebar.menuExpand') : t('sidebar.menuCollapse')}
            title={collapsed ? t('sidebar.menuExpand') : t('sidebar.menuCollapse')}
          >
            {collapsed ? <Menu className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>

        {/* ── Navigation ───────────────────────────────────── */}
        <div className={clsx(
          "flex flex-1 flex-col overflow-y-auto pt-5 custom-scrollbar",
          collapsed ? "lg:px-2 px-3" : "px-3"
        )}>
          {/* Workspace switcher (Ola P4 · slot server-rendered) */}
          {workspaceSwitcherSlot && (
            <div className="mb-4">
              {workspaceSwitcherSlot}
            </div>
          )}

          {/* Section label */}
          <div className={clsx(
            "text-[10px] font-semibold text-muted-foreground uppercase tracking-[0.15em] mb-3 px-2",
            collapsed && "lg:hidden"
          )}>
            {t('sidebar.title')}
          </div>

          <nav
            className="flex-1 space-y-0.5"
            aria-label={t('sidebar.title')}
            data-testid="sidebar-nav"
          >
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
              const hasActiveChild = group.routes.some((r) => isActivePath(r.path, pathname));
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
                <div key={group.label} className="mb-1" data-testid={`sidebar-group-${group.label}`}>
                  {/* Group header (toggle) */}
                  <button
                    onClick={() => toggle(group.label)}
                    aria-expanded={isOpen}
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
                      {t(group.label)}
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
                      isOpen ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0'
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

          {/* Notificaciones + Tema */}
          <div className={clsx(
            "flex items-center px-2",
            collapsed ? "lg:justify-center lg:px-0 justify-between" : "justify-between"
          )}>
             <span className={clsx(
               "text-xs font-semibold text-muted-foreground uppercase tracking-widest",
               collapsed && "lg:hidden"
             )}>
               {t('sidebar.themeLabel')}
             </span>
             <div className="flex items-center gap-1">
               <NotificationsBell collapsed={collapsed} />
               <ThemeToggle />
             </div>
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
  const { t } = useTranslation();
  const isActive = isActivePath(route.path, pathname);
  const Icon = route.icon;
  const label = t(route.name);

  return (
    <Link
      href={route.path}
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
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
      <span className={clsx(collapsed && 'lg:hidden')}>{label}</span>
    </Link>
  );
}
