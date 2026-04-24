const fs = require('fs');
const path = require('path');

const routes = [
  { path: 'list', title: 'List View', desc: 'Edición masiva, priorización y organización jerárquica.', icon: 'List' },
  { path: 'calendar', title: 'Calendar View', desc: 'Planificación temporal y sincronización.', icon: 'Calendar' },
  { path: 'workload', title: 'Workload View', desc: 'Control de capacidad operativa y recursos.', icon: 'Users' },
  { path: 'table', title: 'Table DB View', desc: 'Base de datos relacional y gestión de inventario.', icon: 'Table' },
  { path: 'mindmaps', title: 'Mind Maps', desc: 'Diagramas lógicos vinculados a tareas reales.', icon: 'Network' },
  { path: 'whiteboards', title: 'Whiteboards', desc: 'Espacios de colaboración visual.', icon: 'Presentation' },
  { path: 'docs', title: 'Docs & Wiki', desc: 'Editor de texto colaborativo integrado.', icon: 'FileText' },
  { path: 'forms', title: 'Formularios', desc: 'Captura de requerimientos y tickets.', icon: 'ClipboardList' },
  { path: 'automations', title: 'Automatizaciones', desc: 'Reglas lógicas para reducir el trabajo operativo.', icon: 'Zap' },
  { path: 'dashboards', title: 'Dashboards KPI', desc: 'Paneles de control en tiempo real.', icon: 'LayoutTemplate' }
];

routes.forEach(r => {
  const dirPath = path.join(__dirname, 'src', 'app', r.path);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  const content = `import { ${r.icon}, Sparkles, Info } from "lucide-react";

export default function ${r.path.charAt(0).toUpperCase() + r.path.slice(1)}Page() {
  return (
    <div className="flex-1 overflow-y-auto bg-slate-950 p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-center justify-between border-b border-slate-800 pb-6">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-indigo-500/10 p-3 ring-1 ring-indigo-500/20">
              <${r.icon} className="h-8 w-8 text-indigo-400" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-white">${r.title}</h1>
              <p className="mt-1 text-sm text-slate-400 flex items-center gap-2">
                 <Info className="h-4 w-4" /> {r.desc}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 transition-colors">
              <Sparkles className="h-4 w-4" />
              ClickUp Brain
            </button>
          </div>
        </header>

        <div className="flex h-[60vh] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-700 bg-slate-900/50">
          <div className="rounded-full bg-slate-800 p-4 mb-4">
            <${r.icon} className="h-10 w-10 text-slate-500" />
          </div>
          <h2 className="text-xl font-semibold text-white">Módulo ${r.title} en Construcción</h2>
          <p className="mt-2 text-slate-400 max-w-md text-center">
            Esta vista premium ha sido provisionada arquitectónicamente para el Release correspondiente. Las integraciones con Prisma y los componentes React están en la cola de desarrollo del SDLC Autónomo.
          </p>
        </div>
      </div>
    </div>
  );
}
`;

  fs.writeFileSync(path.join(dirPath, 'page.tsx'), content);
});

console.log('Dummy pages generated successfully.');
