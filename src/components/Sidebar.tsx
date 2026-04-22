'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Columns, CalendarDays, Target, FolderKanban } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

const routes = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Gestión Proyectos', path: '/projects', icon: FolderKanban },
  { name: 'Kanban Board', path: '/kanban', icon: Columns },
  { name: 'Gantt Timeline', path: '/gantt', icon: CalendarDays },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-screen w-64 flex-col bg-slate-900 text-slate-300 border-r border-slate-800">
      <div className="flex h-16 shrink-0 items-center px-6 border-b border-slate-800 bg-slate-950/50">
        <Target className="h-6 w-6 text-indigo-500 mr-3" />
        <span className="text-lg font-bold text-white tracking-wide">Avante Orq</span>
      </div>
      
      <div className="flex flex-1 flex-col overflow-y-auto pt-6 px-4">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4 px-2">
          Orquestación Híbrida
        </div>
        <nav className="flex-1 space-y-1">
          {routes.map((route) => {
            const isActive = pathname === route.path;
            const Icon = route.icon;
            
            return (
              <Link
                key={route.name}
                href={route.path}
                className={twMerge(
                  clsx(
                    'group flex items-center px-3 py-2.5 text-sm font-medium rounded-lg transition-all duration-200',
                    isActive
                      ? 'bg-indigo-500/10 text-indigo-400'
                      : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                  )
                )}
              >
                <Icon
                  className={twMerge(
                    clsx(
                      'mr-3 h-5 w-5 flex-shrink-0 transition-colors duration-200',
                      isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-white'
                    )
                  )}
                  aria-hidden="true"
                />
                {route.name}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-800">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-slate-800/50">
          <div className="h-8 w-8 rounded-full bg-indigo-600 flex items-center justify-center text-sm font-bold text-white shadow-lg">
            EM
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium text-white">Edwin Martinez</span>
            <span className="text-[10px] text-slate-400">PM Híbrido</span>
          </div>
        </div>
      </div>
    </div>
  );
}
