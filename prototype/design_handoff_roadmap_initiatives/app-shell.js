/* Real Follett Marketing app shell — sidebar nav + view toggle + kanban + list.
   Drives the same data.js the Roadmap React app reads. */
(function () {
  const D = window.ROADMAP_DATA;
  const TODAY = new Date(D.today + 'T00:00:00');

  // ---- Departments map (matches the real app's keys) ----
  const DEPTS = ['All Marketing', 'B2B Marketing', 'B2C Marketing', 'Personal', 'Rev Ops'];
  const DEPT_KEY = { 'Rev Ops':'revops', 'B2B Marketing':'b2b', 'B2C Marketing':'b2c', 'All Marketing':'allmkt', 'Personal':'personal' };

  // ---- Pull a flat task list out of initiatives + inbox ----
  function allTasks() {
    const out = [];
    D.initiatives.forEach(i => {
      i.tasks.forEach(t => out.push({
        ...t,
        department: t.department || i.department,
        initiativeId: i.id,
        initiativeName: i.name,
      }));
    });
    (D.inboxTasks || []).forEach(t => out.push({ ...t, initiativeId: null, initiativeName: null }));
    return out;
  }

  // ---- State ----
  const state = {
    view: 'kanban',                  // 'list' | 'kanban' | 'roadmap'
    deptFilter: 'all',
    priorityFilter: 'all',
    search: '',
    showBacklog: false,
    showCompleted: true,
    activeNav: 'tasks',
  };

  function getFiltered() {
    return allTasks().filter(t => {
      if (state.deptFilter !== 'all' && t.department !== state.deptFilter) return false;
      if (state.priorityFilter !== 'all' && t.priority !== state.priorityFilter) return false;
      if (state.search && !t.title.toLowerCase().includes(state.search.toLowerCase())) return false;
      return true;
    });
  }

  // ---- Stats ----
  function renderStats() {
    const tasks = allTasks();
    const today = D.today;
    const overdue = tasks.filter(t => t.status !== 'Completed' && t.due < today).length;
    const thisWk = tasks.filter(t => t.status === 'Completed' && t.completedAt).length; // approx
    const delegated = tasks.filter(t => t.status === 'Delegated').length;
    el('stat-overdue').textContent = overdue;
    el('stat-delegated').textContent = delegated;
    el('stat-completed').textContent = thisWk;
  }

  // ---- Sidebar dept counts ----
  function renderSidebarDepts() {
    const host = el('sidebar-dept-spaces');
    const tasks = allTasks().filter(t => t.status !== 'Completed');
    host.innerHTML = DEPTS.map(d => {
      const count = tasks.filter(t => t.department === d).length;
      const k = DEPT_KEY[d];
      const active = state.deptFilter === d ? 'active' : '';
      return `<button class="sidebar-dept-item ${active}" data-dept="${d}">
        <span class="dept-dot dept-${k}"></span>
        <span>${d}</span>
        <span class="sidebar-count">${count}</span>
      </button>`;
    }).join('');
    host.querySelectorAll('[data-dept]').forEach(b => {
      b.onclick = () => { state.deptFilter = b.dataset.dept; rerender(); };
    });
    // My Tasks count = all open
    const myCount = tasks.length;
    el('sidebar-count-my-tasks').textContent = myCount;
  }

  // ---- Kanban (mirrors public/js/app.js renderKanban) ----
  const KB_COLS = [
    { status: 'Backlog',     label: 'Backlog',     color: '#7398A9', toggleable: true },
    { status: 'Not Started', label: 'Not Started', color: 'var(--follett-dark-gray)' },
    { status: 'In Progress', label: 'In Progress', color: 'var(--follett-medium-blue)' },
    { status: 'Blocked',     label: 'Blocked',     color: 'var(--follett-coral)' },
    { status: 'Approved',    label: 'Approved',    color: 'var(--follett-sage)' },
    { status: 'Completed',   label: 'Completed',   color: 'var(--color-text-light)', toggleable: true },
  ];

  function renderKanban() {
    let cols = KB_COLS.filter(c => {
      if (c.status === 'Backlog' && !state.showBacklog) return false;
      if (c.status === 'Completed' && !state.showCompleted) return false;
      return true;
    });
    const tasks = getFiltered();
    const board = el('kanban-board');
    board.innerHTML = cols.map(col => {
      const colTasks = tasks.filter(t => t.status === col.status)
        .sort((a,b) => {
          const p = { High:0, Medium:1, Low:2 };
          const pd = (p[a.priority]||1) - (p[b.priority]||1);
          return pd !== 0 ? pd : (a.due||'9999').localeCompare(b.due||'9999');
        });
      const cards = colTasks.map(t => {
        const overdue = t.status !== 'Completed' && t.due < D.today;
        const prioCls = t.priority === 'High' ? 'kb-prio-high' : t.priority === 'Low' ? 'kb-prio-low' : '';
        const owner = D.people[t.owner];
        const due = t.due ? t.due.substring(5) : '';
        const initPill = t.initiativeName
          ? `<span class="kb-init-pill" title="${esc(t.initiativeName)}">${esc(t.initiativeName)}</span>`
          : `<span class="kb-init-pill kb-init-pill--inbox">Inbox</span>`;
        return `<div class="kb-card ${prioCls}" data-task-id="${t.id}">
          <div class="kb-card-title">${esc(t.title)}</div>
          <div class="kb-card-row">${initPill}</div>
          <div class="kb-card-meta">
            ${owner ? `<span>${esc(owner.initials)}</span>` : ''}
            ${due ? `<span class="${overdue ? 'kb-overdue' : ''}">${due}</span>` : ''}
            <span class="kb-prio-dot kb-prio-dot-${(t.priority||'medium').toLowerCase()}"></span>
          </div>
        </div>`;
      }).join('');
      return `<div class="kb-column" data-status="${col.status}">
        <div class="kb-column-header" style="border-top-color:${col.color};">
          <span class="kb-column-title">${col.label}</span>
          <span class="kb-column-count">${colTasks.length}</span>
        </div>
        <div class="kb-column-body" data-status="${col.status}">
          ${cards || '<div class="kb-empty">No tasks</div>'}
        </div>
      </div>`;
    }).join('');
  }

  // ---- List (mirrors task-item style) ----
  function renderList() {
    const tasks = getFiltered();
    // Group by status order
    const order = ['In Progress', 'Blocked', 'Not Started', 'Approved', 'Backlog', 'Completed'];
    tasks.sort((a,b) => order.indexOf(a.status) - order.indexOf(b.status));
    const list = el('task-list');
    list.innerHTML = tasks.map(t => {
      const sk = 'status-' + t.status.toLowerCase().replace(/\s+/g,'-');
      const dept = t.department, dk = DEPT_KEY[dept] || 'b2b';
      const owner = D.people[t.owner];
      const due = t.due;
      const overdue = t.status !== 'Completed' && due < D.today;
      const dueTxt = overdue ? Math.round((TODAY - new Date(due+'T00:00:00'))/86400000) + 'd overdue'
        : new Date(due+'T00:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'});
      return `<div class="task-item ${sk}" data-task-id="${t.id}">
        <select class="status-select ${sk}">
          <option ${t.status==='Backlog'?'selected':''}>Backlog</option>
          <option ${t.status==='Not Started'?'selected':''}>Not Started</option>
          <option ${t.status==='In Progress'?'selected':''}>In Progress</option>
          <option ${t.status==='Blocked'?'selected':''}>Blocked</option>
          <option ${t.status==='Approved'?'selected':''}>Approved</option>
          <option ${t.status==='Delegated'?'selected':''}>Delegated</option>
          <option ${t.status==='Completed'?'selected':''}>Completed</option>
        </select>
        <div class="task-body" style="flex:1;min-width:0;">
          <div class="task-title">${esc(t.title)}</div>
          <div class="task-meta">
            <span class="badge dept-${dk}">${esc(dept)}</span>
            ${t.initiativeName ? `<span class="kb-init-pill" style="font-size:.7rem;">${esc(t.initiativeName)}</span>` : '<span class="kb-init-pill kb-init-pill--inbox" style="font-size:.7rem;">Inbox</span>'}
            <span style="color:${overdue?'var(--follett-coral)':'var(--color-text-muted)'};font-size:.78rem;font-weight:600;">${dueTxt}</span>
            ${owner ? `<span style="font-size:.78rem;color:var(--color-text-muted);">· ${esc(owner.name)}</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('') || '<div class="empty-state"><p class="empty-title">No tasks match these filters</p></div>';
  }

  // ---- View switching ----
  function setView(v) {
    state.view = v;
    el('view-list-wrap').style.display       = v === 'list'    ? 'block' : 'none';
    el('kanban-view').style.display          = v === 'kanban'  ? 'block' : 'none';
    el('view-roadmap').style.display         = v === 'roadmap' ? 'block' : 'none';
    el('kb-col-toggles').style.display       = v === 'kanban'  ? 'flex'  : 'none';
    // Stats bar left: show task chips on list/board, roadmap chips on roadmap
    document.querySelectorAll('.stats-bar-left:not(.stats-bar-left--roadmap)').forEach(n => n.style.display = v === 'roadmap' ? 'none' : 'flex');
    el('stats-bar-left-roadmap').style.display = v === 'roadmap' ? 'flex' : 'none';
    el('btn-view-list').classList.toggle('active', v === 'list');
    el('btn-view-kanban').classList.toggle('active', v === 'kanban');
    el('btn-view-roadmap').classList.toggle('active', v === 'roadmap');

    // Sidebar nav active state
    document.querySelectorAll('.sidebar-nav-item[data-view]').forEach(b => b.classList.remove('active'));
    const navTarget = v === 'roadmap' ? 'roadmap' : 'tasks';
    const navBtn = document.querySelector(`.sidebar-nav-item[data-view="${navTarget}"]`);
    if (navBtn) navBtn.classList.add('active');

    if (v === 'kanban') renderKanban();
    if (v === 'list') renderList();
    if (v === 'roadmap' && window.__mountRoadmap) window.__mountRoadmap();
  }

  function rerender() {
    renderSidebarDepts();
    renderStats();
    if (state.view === 'kanban') renderKanban();
    if (state.view === 'list') renderList();
  }

  // ---- Wiring ----
  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s||'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function init() {
    // View toggle
    el('btn-view-list').onclick    = () => setView('list');
    el('btn-view-kanban').onclick  = () => setView('kanban');
    el('btn-view-roadmap').onclick = () => setView('roadmap');

    // Sidebar nav
    document.querySelectorAll('.sidebar-nav-item[data-view]').forEach(b => {
      b.onclick = () => {
        const v = b.dataset.view;
        if (v === 'tasks') setView('kanban');
        else if (v === 'roadmap') setView('roadmap');
      };
    });

    // Kanban col toggles
    el('kb-toggle-backlog').onclick = (e) => {
      state.showBacklog = !state.showBacklog;
      e.currentTarget.classList.toggle('active', state.showBacklog);
      renderKanban();
    };
    el('kb-toggle-completed').onclick = (e) => {
      state.showCompleted = !state.showCompleted;
      e.currentTarget.classList.toggle('active', state.showCompleted);
      renderKanban();
    };

    // Filters
    el('filter-priority').onchange = (e) => { state.priorityFilter = e.target.value; rerender(); };
    el('global-search').oninput = (e) => { state.search = e.target.value; rerender(); };

    // Roadmap filter chips
    const rmfChips = document.querySelectorAll('[data-rmf]');
    rmfChips.forEach(b => {
      b.onclick = () => {
        rmfChips.forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        window.__rmFilter = b.dataset.rmf;
        window.dispatchEvent(new CustomEvent('roadmap:filter', { detail: b.dataset.rmf }));
      };
    });
    // Compute roadmap chip counts from data
    const rd = window.ROADMAP_DATA;
    if (rd) {
      const inits = rd.initiatives || [];
      const atRisk = inits.filter(i => i.health === 'at-risk').length;
      el('rmf-atrisk').textContent = atRisk;
    }

    // Sidebar mobile toggle
    el('sidebar-toggle').onclick = () => el('app-sidebar').classList.toggle('open');
    el('sidebar-close').onclick = () => el('app-sidebar').classList.remove('open');
    el('sidebar-overlay').onclick = () => el('app-sidebar').classList.remove('open');

    // Initial render
    el('app-container').style.display = '';
    rerender();
    setView('kanban');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
