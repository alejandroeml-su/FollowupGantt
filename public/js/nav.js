// Barra de navegación común para páginas internas
function renderTopNav(active) {
  const links = [
    { href: '/dashboard', label: 'Dashboard', key: 'dashboard' },
    { href: '/kanban', label: 'Kanban', key: 'kanban' },
    { href: '/gantt', label: 'Gantt', key: 'gantt' },
    { href: '/sprints', label: 'Sprints', key: 'sprints' },
    { href: '/itil', label: 'Service Desk', key: 'itil' },
    { href: '/projects', label: 'Proyectos', key: 'projects' },
  ];

  return `
    <header class="topnav sticky top-0 z-40 border-b border-gray-200">
      <div class="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
        <a href="/" class="flex items-center gap-2 shrink-0">
          <div class="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold">F</div>
          <span class="font-bold">FollowupGantt</span>
        </a>
        <nav class="flex items-center gap-1 overflow-x-auto text-sm">
          ${links.map(l => `
            <a href="${l.href}" class="px-3 py-2 rounded-lg whitespace-nowrap ${active === l.key ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-100'}">${l.label}</a>
          `).join('')}
        </nav>
        <div class="flex items-center gap-2">
          <label class="text-xs text-gray-500 hidden md:block">Proyecto</label>
          <select id="project-selector" class="border border-gray-300 rounded-lg text-sm px-3 py-1.5 bg-white"></select>
        </div>
      </div>
    </header>
  `;
}

window.renderTopNav = renderTopNav;
