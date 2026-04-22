// Pequeño cliente HTTP para la API de NestJS
const API_BASE = window.location.origin + '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${msg}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

const api = {
  projects: {
    list: () => apiFetch('/projects'),
    get: (id) => apiFetch(`/projects/${id}`),
    create: (body) => apiFetch('/projects', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/projects/${id}`, { method: 'DELETE' }),
  },
  tasks: {
    list: (projectId) => apiFetch(`/tasks${projectId ? '?project_id=' + projectId : ''}`),
    create: (body) => apiFetch('/tasks', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
    move: (id, column_id, position) => apiFetch(`/tasks/${id}/move`, { method: 'PATCH', body: JSON.stringify({ column_id, position }) }),
  },
  kanban: {
    board: (projectId) => apiFetch(`/kanban/board?project_id=${projectId}`),
    createColumn: (body) => apiFetch('/kanban/columns', { method: 'POST', body: JSON.stringify(body) }),
    updateColumn: (id, body) => apiFetch(`/kanban/columns/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeColumn: (id) => apiFetch(`/kanban/columns/${id}`, { method: 'DELETE' }),
  },
  gantt: {
    timeline: (projectId) => apiFetch(`/gantt/timeline?project_id=${projectId}`),
  },
  dependencies: {
    list: (projectId) => apiFetch(`/dependencies${projectId ? '?project_id=' + projectId : ''}`),
    create: (body) => apiFetch('/dependencies', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/dependencies/${id}`, { method: 'DELETE' }),
  },
  baselines: {
    list: (projectId) => apiFetch(`/baselines?project_id=${projectId}`),
    create: (body) => apiFetch('/baselines', { method: 'POST', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/baselines/${id}`, { method: 'DELETE' }),
    variance: (id) => apiFetch(`/baselines/${id}/variance`),
  },
  itil: {
    tickets: () => apiFetch('/itil/tickets'),
    createTicket: (body) => apiFetch('/itil/tickets', { method: 'POST', body: JSON.stringify(body) }),
    updateTicket: (id, body) => apiFetch(`/itil/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    removeTicket: (id) => apiFetch(`/itil/tickets/${id}`, { method: 'DELETE' }),
    slaPolicies: () => apiFetch('/itil/sla-policies'),
  },
  kpis: {
    summary: (projectId) => apiFetch(`/kpis/summary${projectId ? '?project_id=' + projectId : ''}`),
  },
  sprints: {
    list: (projectId) => apiFetch(`/sprints${projectId ? '?project_id=' + projectId : ''}`),
    create: (body) => apiFetch('/sprints', { method: 'POST', body: JSON.stringify(body) }),
    update: (id, body) => apiFetch(`/sprints/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    remove: (id) => apiFetch(`/sprints/${id}`, { method: 'DELETE' }),
  },
  users: {
    list: () => apiFetch('/users'),
  },
};

window.api = api;
