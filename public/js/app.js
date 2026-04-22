// Estado global compartido entre páginas
const AppState = {
  currentProjectId: localStorage.getItem('currentProjectId') || null,
  projects: [],

  async init() {
    try {
      this.projects = await api.projects.list();
      if (!this.currentProjectId && this.projects.length) {
        this.setProject(this.projects[0].id);
      }
    } catch (e) {
      console.warn('No projects or API offline:', e.message);
    }
    this.renderProjectSelector();
  },

  setProject(id) {
    this.currentProjectId = id;
    localStorage.setItem('currentProjectId', id);
  },

  renderProjectSelector() {
    const sel = document.getElementById('project-selector');
    if (!sel) return;
    sel.innerHTML = this.projects.map(p =>
      `<option value="${p.id}" ${p.id === this.currentProjectId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('') || '<option value="">Sin proyectos</option>';
    sel.addEventListener('change', () => {
      this.setProject(sel.value);
      window.location.reload();
    });
  },
};

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

function priorityBadge(p) {
  const colors = { low: 'bg-gray-200 text-gray-700', medium: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', critical: 'bg-red-100 text-red-700' };
  return `<span class="px-2 py-0.5 rounded text-xs font-medium ${colors[p] || colors.medium}">${p}</span>`;
}

function statusBadge(s) {
  const colors = { todo: 'bg-gray-200', in_progress: 'bg-yellow-200', review: 'bg-purple-200', done: 'bg-green-200', blocked: 'bg-red-200', cancelled: 'bg-gray-300', open: 'bg-blue-200', pending: 'bg-yellow-200', resolved: 'bg-green-200', closed: 'bg-gray-200' };
  return `<span class="px-2 py-0.5 rounded text-xs ${colors[s] || 'bg-gray-200'}">${s}</span>`;
}

window.AppState = AppState;
window.escapeHtml = escapeHtml;
window.fmt = fmt;
window.priorityBadge = priorityBadge;
window.statusBadge = statusBadge;

document.addEventListener('DOMContentLoaded', () => {
  if (window.api) AppState.init();
});
