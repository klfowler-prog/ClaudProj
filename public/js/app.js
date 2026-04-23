// === Constants ===
const DEPARTMENTS = ['B2B Marketing', 'B2C Marketing', 'All Marketing', 'Personal'];
const SUB_DEPARTMENTS = {
  'B2B Marketing': ['Biz Dev', 'Growth & Brand', 'Rev Ops', 'Internal Comms'],
  'B2C Marketing': []
};
const ALL_SUB_DEPTS = Object.values(SUB_DEPARTMENTS).flat();
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Backlog', 'Not Started', 'In Progress', 'Blocked', 'Approved', 'Delegated', 'Completed'];
const STORAGE_KEY = 'cmo_tasks';

// === Unified Tag Color System ===
const TAG_COLORS = {
  'Biz Dev': { bg: '#e8f0fe', text: '#1a73e8', border: '#1a73e8' },
  'Growth & Brand': { bg: '#e0f2f1', text: '#00897b', border: '#00897b' },
  'Rev Ops': { bg: '#fde8e7', text: '#DC6B67', border: '#DC6B67' },
  'Internal Comms': { bg: '#eef5ea', text: '#6a9b59', border: '#ABC39B' },
  'Social Media': { bg: '#fce4ec', text: '#d81b60', border: '#d81b60' },
  'PR': { bg: '#fff8e1', text: '#f57f17', border: '#f57f17' },
  'Conferences': { bg: '#ede9fe', text: '#7c3aed', border: '#7c3aed' }
};
const TAG_PALETTE = [
  { bg: '#e3f2fd', text: '#1565c0', border: '#1565c0' },
  { bg: '#fce4ec', text: '#c62828', border: '#c62828' },
  { bg: '#e8f5e9', text: '#2e7d32', border: '#2e7d32' },
  { bg: '#fff3e0', text: '#e65100', border: '#e65100' },
  { bg: '#f3e5f5', text: '#7b1fa2', border: '#7b1fa2' },
  { bg: '#e0f7fa', text: '#00838f', border: '#00838f' },
  { bg: '#fbe9e7', text: '#bf360c', border: '#bf360c' },
  { bg: '#f1f8e9', text: '#558b2f', border: '#558b2f' }
];
const TAG_PRESETS = ['Biz Dev', 'Growth & Brand', 'Rev Ops', 'Internal Comms', 'Social Media', 'PR', 'Conferences', 'Strategy', 'Campaign'];

function getAllKnownTags() {
  const known = new Set(TAG_PRESETS);
  tasks.forEach(t => (t.tags || []).forEach(tag => known.add(tag)));
  return [...known].sort();
}

function buildTagDatalist(id) {
  return `<datalist id="${id}">${getAllKnownTags().map(t => `<option value="${t}">`).join('')}</datalist>`;
}

function getTagColor(tag) {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag];
  const hash = tag.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return TAG_PALETTE[hash % TAG_PALETTE.length];
}

function renderTagChip(tag, opts = {}) {
  const c = getTagColor(tag);
  const removeHtml = opts.removable ? `<span class="note-tag-remove" data-remove-tag="${escapeHtml(tag)}" style="cursor:pointer;opacity:0.6;margin-left:0.2rem;">&times;</span>` : '';
  const size = opts.small ? 'font-size:0.55rem;padding:0.1rem 0.35rem;' : 'font-size:0.65rem;padding:0.15rem 0.5rem;';
  return `<span class="tag-chip" style="${size}background:${c.bg};color:${c.text};border-radius:999px;display:inline-flex;align-items:center;gap:0.15rem;font-weight:500;white-space:nowrap;">${escapeHtml(tag)}${removeHtml}</span>`;
}
const MIGRATION_KEY = 'cmo_migrated_to_cloud';

// === Auth State ===
let authToken = null;
let currentUser = null;
let viewAsUserId = null; // CMO impersonation

// === API Helper ===
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
  };
  if (viewAsUserId) opts.headers['X-View-As'] = viewAsUserId;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    if (res.status === 429) {
      showToast('Slow down — too many requests. Wait a moment and try again.', 'error');
      throw new Error('Rate limit reached');
    }
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

const DEPT_KEYS = {
  'B2B Marketing': 'b2b',
  'Internal Comms': 'comms',
  'Rev Ops': 'revops',
  'B2C Marketing': 'b2c',
  'All Marketing': 'all-mktg',
  'Personal': 'personal'
};

const STATUS_KEYS = {
  'Backlog': 'backlog',
  'Not Started': 'not-started',
  'In Progress': 'in-progress',
  'Blocked': 'blocked',
  'Approved': 'approved',
  'Delegated': 'delegated',
  'Completed': 'completed'
};

// Keywords for auto-detecting department from imported content
const DEPT_KEYWORDS = {
  'B2B Marketing': ['b2b', 'enterprise', 'account-based', 'abm', 'lead gen', 'demand gen', 'sales enablement', 'whitepaper', 'case study', 'webinar', 'linkedin', 'internal', 'comms', 'rev ops', 'hubspot', 'salesforce', 'crm'],
  'B2C Marketing': ['b2c', 'consumer', 'social media', 'instagram', 'tiktok', 'influencer', 'brand', 'campaign', 'creative', 'content marketing', 'seo', 'paid media'],
  'All Marketing': ['cross-functional', 'all teams', 'company-wide', 'org-wide'],
  'Personal': ['personal', 'private', 'reminder', '1:1']
};

// === State ===
let tasks = [];
let filters = { department: 'all', priority: 'all', search: '', sort: 'due-date', statFilter: 'none' };
let activeTaskTagFilter = '';
let pendingAttachments = []; // temp attachments for the add-task form
let pendingLinks = [];       // temp links for the add-task form
let editingTaskId = null;    // null = adding, string = editing
let deleteConfirmId = null;  // track which task is awaiting delete confirm
let notifPollInterval = null; // notification polling interval ID

// === Toast Notifications ===
function showToast(message, type = 'success') {
  const existing = document.getElementById('toast-container');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'toast-container';
  toast.style.cssText = `position:fixed;bottom:1.5rem;left:50%;transform:translateX(-50%);padding:0.625rem 1.25rem;border-radius:var(--radius-lg);font-size:0.85rem;font-family:'Roboto',sans-serif;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;max-width:90%;text-align:center;${type === 'error' ? 'background:#fde8e7;color:#DC6B67;' : 'background:var(--follett-dark-blue);color:white;'}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

// === Persistence (API-backed) ===
let isLoadingTasks = false;
async function loadTasks() {
  if (isLoadingTasks) return;
  isLoadingTasks = true;
  try {
    let url = '/api/tasks';
    if (globalMyTasksView || showMyTasksOnly) url += '?mine=true';
    else if (showMyTeam) url += '?team=true';
    if (activeTaskTagFilter) url += (url.includes('?') ? '&' : '?') + `tag=${encodeURIComponent(activeTaskTagFilter)}`;
    if (activeWorkspaceId) url += (url.includes('?') ? '&' : '?') + `workspaceId=${encodeURIComponent(activeWorkspaceId)}`;
    tasks = await api('GET', url);
  } catch (err) {
    console.error('Failed to load tasks:', err);
    tasks = [];
  } finally {
    isLoadingTasks = false;
  }
}


// === localStorage Migration ===
async function migrateLocalStorage() {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return;
  }

  let localTasks;
  try { localTasks = JSON.parse(data); } catch { return; }
  if (!localTasks || localTasks.length === 0) {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return;
  }

  // Migrate status for old tasks
  localTasks.forEach(t => {
    if (!t.status) {
      t.status = t.completed ? 'Completed' : 'Not Started';
      t.completedAt = t.completed ? (t.completedAt || new Date().toISOString()) : '';
    }
  });

  const count = localTasks.length;
  if (!confirm(`Found ${count} task${count !== 1 ? 's' : ''} saved locally on this device. Import them to your cloud account?`)) {
    return;
  }

  try {
    await api('POST', '/api/tasks/batch', { tasks: localTasks });
    localStorage.setItem(MIGRATION_KEY, 'done');
    showToast(`Successfully imported ${count} task${count !== 1 ? 's' : ''} to the cloud!`);
    await loadTasks();
    render();
  } catch (err) {
    showToast('Migration failed. Your local tasks are still safe.', 'error');
  }
}

// === Rendering ===
// === Calendar View ===
let calendarDate = new Date();
let taskViewMode = 'kanban'; // 'list', 'kanban', or 'calendar'

function setTaskViewMode(mode) {
  taskViewMode = mode;
  if (currentUser) sessionStorage.setItem('taskViewMode_' + currentUser.uid, mode);
  document.getElementById('btn-view-list').classList.toggle('active', mode === 'list');
  document.getElementById('btn-view-kanban').classList.toggle('active', mode === 'kanban');
  document.getElementById('btn-view-calendar').classList.toggle('active', mode === 'calendar');
  document.getElementById('task-list-container').style.display = mode === 'list' ? '' : 'none';
  document.getElementById('task-actions-bar').style.display = '';
  document.getElementById('kanban-view').style.display = mode === 'kanban' ? 'block' : 'none';
  document.getElementById('calendar-view').style.display = mode === 'calendar' ? 'block' : 'none';
  document.getElementById('filter-sort').style.display = mode === 'list' ? '' : 'none';
  if (mode === 'calendar') renderCalendar();
  if (mode === 'kanban') renderKanban();
}

// === Kanban View ===
const KANBAN_COLUMNS = [
  { status: 'Not Started', label: 'Not Started', color: 'var(--color-text-muted)' },
  { status: 'In Progress', label: 'In Progress', color: 'var(--follett-medium-blue)' },
  { status: 'Blocked', label: 'Blocked', color: 'var(--follett-coral)' },
  { status: 'Approved', label: 'Approved', color: 'var(--follett-sage)' },
  { status: 'Completed', label: 'Completed', color: 'var(--color-text-light)' }
];

function renderKanban() {
  let filtered = getFilteredTasks();
  // In normal view, hide delegated and backlog tasks
  // But show them when their specific pill is active
  if (filters.statFilter !== 'delegated') {
    filtered = filtered.filter(t => t.status !== 'Delegated' || t.assignedTo === (myProfile && myProfile.userId));
  }
  if (filters.statFilter !== 'backlog') {
    filtered = filtered.filter(t => t.status !== 'Backlog');
  }
  const today = new Date().toISOString().split('T')[0];
  const board = document.getElementById('kanban-board');

  // When a stat filter is active, only show the relevant column(s)
  let columns = KANBAN_COLUMNS;
  const sf = filters.statFilter;
  if (sf === 'backlog') {
    columns = [{ status: 'Backlog', label: 'Backlog', color: '#7398A9' }];
  } else if (sf === 'delegated') {
    columns = [{ status: 'Delegated', label: 'Delegated', color: '#d4960a' }];
  } else if (sf === 'not-started') {
    columns = KANBAN_COLUMNS.filter(c => c.status === 'Not Started');
  } else if (sf === 'in-progress') {
    columns = KANBAN_COLUMNS.filter(c => c.status === 'In Progress');
  } else if (sf === 'blocked') {
    columns = KANBAN_COLUMNS.filter(c => c.status === 'Blocked');
  } else if (sf === 'approved') {
    columns = KANBAN_COLUMNS.filter(c => c.status === 'Approved');
  } else if (sf === 'completed' || sf === 'overdue') {
    columns = KANBAN_COLUMNS; // Show all columns, filtered tasks will land in correct ones
  }

  board.innerHTML = columns.map(col => {
    const colTasks = filtered.filter(t => {
      if (col.status === 'Not Started') return t.status === 'Not Started' || (t.status === 'Delegated' && t.assignedTo === (myProfile && myProfile.userId));
      return t.status === col.status;
    });
    // Sort: high priority first, then by due date
    colTasks.sort((a, b) => {
      const prio = { High: 0, Medium: 1, Low: 2 };
      const pd = (prio[a.priority] || 1) - (prio[b.priority] || 1);
      if (pd !== 0) return pd;
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });

    const cardsHtml = colTasks.map(t => {
      const overdue = t.status !== 'Completed' && t.dueDate && t.dueDate < today;
      const prioClass = t.priority === 'High' ? 'kb-prio-high' : t.priority === 'Low' ? 'kb-prio-low' : '';
      const assignee = teamMembers.find(m => m.userId === t.assignedTo);
      const assigneeName = assignee ? assignee.displayName.split(' ')[0] : '';
      return `<div class="kb-card ${prioClass}" draggable="true" data-task-id="${t.id}">
        <div class="kb-card-title">${escapeHtml(t.title)}</div>
        ${(t.tags || []).length > 0 ? `<div style="display:flex;gap:0.2rem;flex-wrap:wrap;margin-bottom:0.2rem;">${(t.tags || []).slice(0, 2).map(tg => renderTagChip(tg, { small: true })).join('')}</div>` : ''}
        <div class="kb-card-meta">
          ${assigneeName ? `<span>${escapeHtml(assigneeName)}</span>` : ''}
          ${t.dueDate ? `<span class="${overdue ? 'kb-overdue' : ''}">${t.dueDate.substring(5)}</span>` : ''}
          <span class="kb-prio-dot kb-prio-dot-${t.priority.toLowerCase()}"></span>
        </div>
      </div>`;
    }).join('');

    return `<div class="kb-column" data-status="${col.status}">
      <div class="kb-column-header" style="border-top-color:${col.color};">
        <span class="kb-column-title">${col.label}</span>
        <span class="kb-column-count">${colTasks.length}</span>
      </div>
      <div class="kb-column-body" data-status="${col.status}">
        ${cardsHtml || '<div class="kb-empty">No tasks</div>'}
      </div>
    </div>`;
  }).join('');

  // Event delegation for clicks and drag-and-drop
  let draggedId = null;

  board.onclick = (e) => {
    const card = e.target.closest('.kb-card');
    if (card) showTaskDetail(card.dataset.taskId);
  };

  board.ondragstart = (e) => {
    const card = e.target.closest('.kb-card');
    if (!card) return;
    draggedId = card.dataset.taskId;
    card.classList.add('kb-dragging');
    e.dataTransfer.effectAllowed = 'move';
  };

  board.ondragend = (e) => {
    const card = e.target.closest('.kb-card');
    if (card) card.classList.remove('kb-dragging');
    draggedId = null;
    board.querySelectorAll('.kb-column-body').forEach(col => col.classList.remove('kb-drag-over'));
  };

  board.ondragover = (e) => {
    const col = e.target.closest('.kb-column-body');
    if (!col) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    col.classList.add('kb-drag-over');
  };

  board.ondragleave = (e) => {
    const col = e.target.closest('.kb-column-body');
    if (col) col.classList.remove('kb-drag-over');
  };

  board.ondrop = async (e) => {
    const col = e.target.closest('.kb-column-body');
    if (!col) return;
    e.preventDefault();
    col.classList.remove('kb-drag-over');
    if (!draggedId) return;
    const newStatus = col.dataset.status;
    const task = tasks.find(t => t.id === draggedId);
    if (!task || task.status === newStatus) return;

    try {
      const updates = { status: newStatus };
      if (newStatus === 'Completed') {
        updates.completed = true;
        updates.completedAt = new Date().toISOString();
      } else {
        updates.completed = false;
        updates.completedAt = '';
      }
      if (newStatus === 'Blocked') {
        const reason = prompt('Why is this blocked? (optional)');
        if (reason) updates.blockedReason = reason;
      }
      await api('PUT', `/api/tasks/${draggedId}`, updates);
      Object.assign(task, updates);
      // Auto-create next occurrence for recurring tasks
      if (newStatus === 'Completed') await handleRecurringTaskCompletion(task);
      render();
    } catch (err) { showToast('Failed to update status', 'error'); }
  };
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  // Header
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  document.getElementById('cal-month-title').textContent = `${monthNames[month]} ${year}`;

  // Build grid
  const firstDay = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrev = new Date(year, month, 0).getDate();

  // Get filtered tasks
  const filtered = getFilteredTasks();

  // Group tasks by due date
  const tasksByDate = {};
  filtered.forEach(t => {
    if (!t.dueDate) return;
    if (!tasksByDate[t.dueDate]) tasksByDate[t.dueDate] = [];
    tasksByDate[t.dueDate].push(t);
  });

  let html = '';
  // Day headers
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(d => {
    html += `<div class="cal-day-header">${d}</div>`;
  });

  // Calendar cells
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDay + 1;
    let dateStr, displayNum, isOtherMonth = false;

    if (dayNum < 1) {
      // Previous month
      displayNum = daysInPrev + dayNum;
      const d = new Date(year, month - 1, displayNum);
      dateStr = d.toISOString().split('T')[0];
      isOtherMonth = true;
    } else if (dayNum > daysInMonth) {
      // Next month
      displayNum = dayNum - daysInMonth;
      const d = new Date(year, month + 1, displayNum);
      dateStr = d.toISOString().split('T')[0];
      isOtherMonth = true;
    } else {
      displayNum = dayNum;
      const d = new Date(year, month, dayNum);
      dateStr = d.toISOString().split('T')[0];
    }

    const isToday = dateStr === todayStr;
    const classes = ['cal-day'];
    if (isOtherMonth) classes.push('cal-other-month');
    if (isToday) classes.push('cal-today');

    const dayTasks = tasksByDate[dateStr] || [];
    // Sort: high priority first, then by status
    dayTasks.sort((a, b) => {
      const prio = { High: 0, Medium: 1, Low: 2 };
      return (prio[a.priority] || 1) - (prio[b.priority] || 1);
    });

    const maxShow = 3;
    const taskHtml = dayTasks.slice(0, maxShow).map(t => {
      let cls = t.status === 'Completed' ? 'cal-task-completed' : `cal-task-${t.priority.toLowerCase()}`;
      const firstTag = (t.tags || [])[0];
      const tagStyle = firstTag ? (() => { const c = getTagColor(firstTag); return `background:${c.bg};color:${c.text};border-left:2px solid ${c.border};`; })() : '';
      return `<div class="cal-task ${tagStyle ? '' : cls}" style="${tagStyle}" onclick="event.stopPropagation();showTaskDetail('${t.id}')" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</div>`;
    }).join('');
    const moreHtml = dayTasks.length > maxShow ? `<div class="cal-more">+${dayTasks.length - maxShow} more</div>` : '';

    html += `<div class="${classes.join(' ')}" data-date="${dateStr}">
      <div class="cal-day-num">${displayNum}</div>
      ${taskHtml}${moreHtml}
    </div>`;
  }

  document.getElementById('cal-grid').innerHTML = html;

  // Click empty day to quick-add with date
  document.querySelectorAll('.cal-day').forEach(cell => {
    cell.addEventListener('click', (e) => {
      if (e.target.closest('.cal-task') || e.target.closest('.cal-more')) return;
      const date = cell.dataset.date;
      document.getElementById('input-due-date').value = date;
      editingTaskId = null;
      document.getElementById('modal-add-title').textContent = 'Add Task';
      document.getElementById('input-title').value = '';
      document.getElementById('input-notes').value = '';
      openModal('modal-add');
    });
  });
}

function render() {
  renderStats();
  renderSidebarSpaces();
  renderTaskTagFilter();
  refreshTagSuggestions();
  renderTaskList();
  if (taskViewMode === 'calendar') renderCalendar();
  if (taskViewMode === 'kanban') renderKanban();
}

function refreshTagSuggestions() {
  const tags = getAllKnownTags();
  const options = tags.map(t => `<option value="${t}">`).join('');
  ['task-tag-suggestions', 'tag-suggestions'].forEach(id => {
    const dl = document.getElementById(id);
    if (dl) dl.innerHTML = options;
  });
}

function renderTaskTagFilter() {
  const container = document.getElementById('task-tag-filter');
  if (!container) return;
  const allTags = new Set();
  tasks.forEach(t => (t.tags || []).forEach(tag => allTags.add(tag)));
  if (allTags.size === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  let html = `<span style="font-size:0.65rem;color:var(--color-text-muted);margin-right:0.25rem;">Tags:</span>`;
  html += `<button class="note-tag-filter-btn ${!activeTaskTagFilter ? 'active' : ''}" data-task-tag="">All</button>`;
  [...allTags].sort().forEach(tag => {
    const c = getTagColor(tag);
    const isActive = activeTaskTagFilter === tag;
    html += `<button class="note-tag-filter-btn ${isActive ? 'active' : ''}" data-task-tag="${escapeHtml(tag)}" style="${isActive ? `background:${c.text};color:white;border-color:${c.text};` : `background:${c.bg};color:${c.text};border-color:${c.border};`}">${escapeHtml(tag)}</button>`;
  });
  container.innerHTML = html;
  container.onclick = (e) => {
    const btn = e.target.closest('.note-tag-filter-btn');
    if (!btn) return;
    activeTaskTagFilter = btn.dataset.taskTag;
    render();
  };
}

function toggleSection(listId, caretId) {
  const list = document.getElementById(listId);
  const caret = document.getElementById(caretId);
  if (!list) return;
  const isHidden = list.style.display === 'none' || !list.style.display;
  list.style.display = isHidden ? 'flex' : 'none';
  if (caret) caret.classList.toggle('open', isHidden);
}

function renderStats() {
  const filtered = getFilteredTasks();
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun
  const monday = new Date(now);
  monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  monday.setHours(0, 0, 0, 0);
  const mondayStr = monday.toISOString().split('T')[0];
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const backlog = filtered.filter(t => t.status === 'Backlog').length;
  const notStarted = filtered.filter(t => t.status === 'Not Started').length;
  const inProgress = filtered.filter(t => t.status === 'In Progress').length;
  const blocked = filtered.filter(t => t.status === 'Blocked').length;
  const approved = filtered.filter(t => t.status === 'Approved' && t.createdAt && t.createdAt.split('T')[0] >= twoWeeksAgo).length;
  const delegated = filtered.filter(t => t.status === 'Delegated').length;
  const overdue = filtered.filter(t => t.status !== 'Completed' && t.status !== 'Delegated' && t.status !== 'Backlog' && t.dueDate && t.dueDate < today).length;
  const completed = filtered.filter(t => t.status === 'Completed' && t.completedAt && t.completedAt.split('T')[0] >= mondayStr).length;
  document.getElementById('stat-backlog').textContent = backlog;
  document.getElementById('stat-not-started').textContent = notStarted;
  document.getElementById('stat-in-progress').textContent = inProgress;
  document.getElementById('stat-blocked').textContent = blocked;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-delegated').textContent = delegated;
  document.getElementById('stat-overdue').textContent = overdue;
  document.getElementById('stat-completed').textContent = completed;
}

function renderSidebarSpaces() {
  const container = document.getElementById('sidebar-dept-spaces');
  if (!container) return;

  // Update global My Tasks count
  const globalCount = tasks.filter(t => t.status !== 'Completed').length;
  const globalCountEl = document.getElementById('sidebar-count-my-tasks');
  if (globalCountEl) globalCountEl.textContent = globalCount;

  // Highlight My Tasks / My Notes buttons
  const myTasksBtn = document.getElementById('btn-my-tasks-global');
  const myNotesBtn = document.getElementById('btn-my-notes-global');
  if (myTasksBtn) myTasksBtn.classList.toggle('active', globalMyTasksView && currentView === 'tasks');
  if (myNotesBtn) myNotesBtn.classList.toggle('active', globalMyNotesView && currentView === 'notes');

  // Determine which departments to show
  let visibleDepts;
  if (myProfile && myProfile.role === 'cmo') {
    visibleDepts = DEPARTMENTS;
  } else {
    const myDepts = myProfile ? (myProfile.departments || []) : [];
    const deptsWithTasks = new Set(tasks.map(t => t.department));
    visibleDepts = DEPARTMENTS.filter(d => myDepts.includes(d) || deptsWithTasks.has(d));
  }

  let html = '';
  for (const dept of visibleDepts) {
    const key = DEPT_KEYS[dept];
    const count = tasks.filter(t => t.department === dept && t.status !== 'Completed').length;
    const isExpanded = expandedDepts.has(dept);
    const isActiveTasks = !globalMyTasksView && filters.department === dept && currentView === 'tasks';
    const isActiveNotes = !globalMyNotesView && !globalMyTasksView && currentView === 'notes' && activeFolderId && (folders || []).find(f => f.id === activeFolderId && f.name === dept);

    html += `<button class="sidebar-dept-item ${isActiveTasks || isActiveNotes ? 'active' : ''}" data-dept-toggle="${dept}">
      <span class="dept-dot dept-${key}"></span> ${dept} ${count > 0 ? `<span class="sidebar-count">${count}</span>` : ''}
    </button>`;

    if (isExpanded) {
      html += `<button class="sidebar-dept-item sidebar-dept-sub ${isActiveTasks ? 'active' : ''}" data-dept-action="tasks" data-dept="${dept}">Tasks ${count > 0 ? `<span class="sidebar-count">${count}</span>` : ''}</button>`;
      html += `<button class="sidebar-dept-item sidebar-dept-sub ${isActiveNotes ? 'active' : ''}" data-dept-action="notes" data-dept="${dept}">Notes</button>`;
    }
  }

  container.innerHTML = html;

  // Event delegation for all department clicks (avoids listener accumulation on re-render)
  container.onclick = async (e) => {
    // Department header click — toggle expand/collapse
    const toggle = e.target.closest('[data-dept-toggle]');
    if (toggle) {
      const dept = toggle.dataset.deptToggle;
      if (expandedDepts.has(dept)) expandedDepts.delete(dept);
      else expandedDepts.add(dept);
      renderSidebarSpaces();
      return;
    }

    // Department sub-item click (Tasks / Notes)
    const action = e.target.closest('[data-dept-action]');
    if (!action) return;
    const actionType = action.dataset.deptAction;
    const dept = action.dataset.dept;

    // Clear workspace when switching departments
    if (typeof activeWorkspaceId !== 'undefined' && activeWorkspaceId) {
      activeWorkspaceId = null;
      activeWorkspaceName = '';
      const wsHeader = document.getElementById('workspace-header');
      if (wsHeader) wsHeader.style.display = 'none';
      if (typeof renderSidebarWorkspaces === 'function') renderSidebarWorkspaces();
    }
    // Clear stat/tag filters
    filters.statFilter = 'none';
    document.querySelectorAll('.stat-pill-clickable').forEach(p => p.classList.remove('active'));
    if (typeof activeTaskTagFilter !== 'undefined') activeTaskTagFilter = '';

    if (actionType === 'tasks') {
      globalMyTasksView = false;
      globalMyNotesView = false;
      showMyTasksOnly = true;
      showMyTeam = false;
      document.getElementById('filter-department').value = dept;
      applyFilters(true);
      switchView('tasks');
    } else if (actionType === 'notes') {
      globalMyTasksView = false;
      globalMyNotesView = false;
      activeWorkspaceNotesView = false;
      showMyNotesOnly = false; // Dept notes shows all notes in that folder
      document.getElementById('btn-all-notes').classList.add('active');
      document.getElementById('btn-my-notes').classList.remove('active');
      switchView('notes');
      if (!folders || folders.length === 0) {
        await loadFolders();
      }
      const deptFolder = folders.find(f => f.name === dept || (dept === 'All Marketing' && f.name === 'All Team'));
      if (deptFolder) {
        activeFolderId = deptFolder.id;
        if (currentUser) sessionStorage.setItem('activeFolderId_' + currentUser.uid, activeFolderId);
        loadNotesList(activeFolderId);
        document.getElementById('notes-folder-title').textContent = dept;
      } else {
        activeFolderId = null;
        loadNotesList(null);
        document.getElementById('notes-folder-title').textContent = dept + ' Notes';
      }
    }
    closeSidebar();
  };
}

// Legacy alias for any remaining calls
function renderSidebarCounts() {
  renderSidebarSpaces();
}

// === View Switching ===
let currentView = 'tasks';

function switchView(view) {
  currentView = view;
  if (currentUser) sessionStorage.setItem('appView_' + currentUser.uid, view);
  document.getElementById('view-tasks').style.display = view === 'tasks' ? 'block' : 'none';
  document.getElementById('view-notes').style.display = view === 'notes' ? 'flex' : 'none';
  document.getElementById('view-ai').style.display = view === 'ai' ? 'flex' : 'none';
  document.getElementById('view-team').style.display = view === 'team' ? 'block' : 'none';
  document.getElementById('view-notifications').style.display = view === 'notifications' ? 'block' : 'none';
  document.getElementById('view-search').style.display = view === 'search' ? 'block' : 'none';
  document.getElementById('view-features').style.display = view === 'features' ? 'block' : 'none';
  // Update sidebar active states — skip global buttons (handled by renderSidebarSpaces)
  document.querySelectorAll('.sidebar-nav-item').forEach(el => {
    if (el.id === 'btn-my-tasks-global' || el.id === 'btn-my-notes-global') return;
    const match = (el.id === 'btn-open-chat' && view === 'ai') ||
                  (el.id === 'btn-notifications' && view === 'notifications') ||
                  (el.id === 'btn-feature-requests' && view === 'features') ||
                  (el.dataset.view === 'team' && view === 'team');
    el.classList.toggle('active', match);
  });
  // Update global buttons
  const myTasksBtn = document.getElementById('btn-my-tasks-global');
  const myNotesBtn = document.getElementById('btn-my-notes-global');
  if (myTasksBtn) myTasksBtn.classList.toggle('active', globalMyTasksView && view === 'tasks');
  if (myNotesBtn) myNotesBtn.classList.toggle('active', globalMyNotesView && view === 'notes');
  renderSidebarSpaces();
}

function toggleSidebarSection(sectionId, caretId) {
  const subnav = document.getElementById(sectionId);
  const caret = document.getElementById(caretId);
  const isCollapsed = subnav.classList.contains('collapsed');
  subnav.classList.toggle('collapsed');
  caret.innerHTML = isCollapsed ? '&#9662;' : '&#9656;';
}

function openSidebar() {
  document.getElementById('app-sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
}

function closeSidebar() {
  document.getElementById('app-sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
}

function renderTaskItem(task) {
  const deptKey = DEPT_KEYS[task.department] || 'b2b';
  const statusKey = STATUS_KEYS[task.status] || 'not-started';
  const hasAttachments = task.attachments && task.attachments.length > 0;
  const isConfirming = deleteConfirmId === task.id;
  const isCompleted = task.status === 'Completed';
  const dueDateHtml = formatDueDate(task.dueDate, isCompleted, task.startDate);
  const isRecurring = task.recurring && task.recurring !== 'none';
  const recurringLabel = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }[task.recurring] || '';
  const isSubtask = !!task.parentTaskId;
  const prioClass = task.priority === 'High' ? 'prio-high' : task.priority === 'Low' ? 'prio-low' : 'prio-medium';
  const prioDot = `<span class="prio-dot ${prioClass}"></span>`;

  const statusOptions = STATUSES.filter(s => s !== 'Delegated').map(s =>
    `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s}</option>`
  ).join('');

  // Assignee avatar — show when viewing team or all tasks
  let avatarHtml = '';
  if (!showMyTasksOnly) {
    const assignee = teamMembers.find(m => m.userId === task.assignedTo);
    const name = (assignee ? assignee.displayName : (task.assignedTo === (myProfile && myProfile.userId) ? (myProfile.name || 'Me') : 'Me')) || 'Unknown';
    const initials = name.trim().split(' ').map(w => w[0]).filter(Boolean).join('').substring(0, 2).toUpperCase() || '?';
    // Generate a consistent color from the name
    const colors = ['#479FC8', '#DC6B67', '#ABC39B', '#204A65', '#7398A9', '#d4960a', '#2e7d32', '#8e6bbf'];
    const colorIdx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
    avatarHtml = `<span class="task-avatar" title="${escapeHtml(name)}" style="background:${colors[colorIdx]}">${initials}</span>`;
  }

  return `
    <div class="task-item ${isCompleted ? 'completed' : ''} status-${statusKey} ${isSubtask ? 'subtask-item' : ''}" data-id="${task.id}">
      <select class="status-select status-${statusKey}" data-action="status" data-id="${task.id}">
        ${statusOptions}
      </select>
      ${avatarHtml}
      <div class="task-body" data-task-id="${task.id}" onclick="showTaskDetail('${task.id}')" role="button">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          ${isSubtask ? `<span class="task-parent-label">Part of: ${escapeHtml(task.parentTaskTitle || '...')}</span>` : ''}
          ${!activeWorkspaceId ? `<span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>` : ''}
          ${(task.tags || []).map(t => renderTagChip(t, { small: true })).join('')}
          ${task.workspaceId && !activeWorkspaceId ? `<span class="ws-badge" onclick="event.stopPropagation();openWorkspace('${task.workspaceId}')">${escapeHtml(workspaces.find(w => w.id === task.workspaceId)?.name || 'Workspace')}</span>` : ''}
          ${prioDot}
          ${dueDateHtml}
          ${isRecurring ? `<span class="task-recurring" title="${recurringLabel}">&#8635; ${recurringLabel}</span>` : ''}
          ${myProfile && (task.watchers || []).includes(myProfile.userId) && task.assignedTo !== myProfile.userId ? '<span class="task-watch-icon" title="Watching"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></span>' : ''}
          ${isCompleted && task.completedAt ? `<span class="task-source">Done ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : ''}
          ${task.subtaskCount > 0 ? `<span class="task-source" style="color: var(--follett-medium-blue);"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg> ${task.subtasksCompleted}/${task.subtaskCount}</span>` : ''}
        </div>
      </div>
      ${hasAttachments ? '<span class="task-attachment-icon" title="Has attachments"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg></span>' : ''}
      <div class="task-actions">
        ${isConfirming
          ? `<button class="confirm-delete" data-action="confirm-delete" data-id="${task.id}">Delete?</button>
             <button class="btn-danger" data-action="cancel-delete" data-id="${task.id}" title="Cancel">&#10005;</button>`
          : `<button class="btn-danger" data-action="delete" data-id="${task.id}" title="Delete task"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>`}
      </div>
    </div>`;
}

function renderTaskList() {
  const filtered = getFilteredTasks();
  const container = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');
  const completedSection = document.getElementById('completed-section');
  const completedList = document.getElementById('completed-list');
  const completedCount = document.getElementById('completed-count');

  const today = new Date().toISOString().split('T')[0];
  const approvedSection = document.getElementById('approved-section');
  const approvedList = document.getElementById('approved-list');
  const approvedCountEl = document.getElementById('approved-count');
  const delegatedSection = document.getElementById('delegated-section');
  const delegatedList = document.getElementById('delegated-list');
  const delegatedCountEl = document.getElementById('delegated-count');
  const backlogSection = document.getElementById('backlog-section');
  const backlogList = document.getElementById('backlog-list');
  const backlogCountEl = document.getElementById('backlog-count');

  // Split tasks: active (not approved, not delegated, not completed), approved, delegated, completed
  let activeTasks = filtered.filter(t => t.status !== 'Completed' && t.status !== 'Delegated' && t.status !== 'Approved' && t.status !== 'Backlog');
  const backlogTasks = filtered.filter(t => t.status === 'Backlog');
  const approvedTasks = filtered.filter(t => t.status === 'Approved');
  const delegatedTasks = filtered.filter(t => t.status === 'Delegated');
  const completedTasks = getFilteredCompletedTasks();

  // Apply stat filter
  const sf = filters.statFilter;
  if (sf === 'backlog') {
    activeTasks = backlogTasks;
  } else if (sf === 'not-started') {
    activeTasks = activeTasks.filter(t => t.status === 'Not Started');
  } else if (sf === 'in-progress') {
    activeTasks = activeTasks.filter(t => t.status === 'In Progress');
  } else if (sf === 'blocked') {
    activeTasks = activeTasks.filter(t => t.status === 'Blocked');
  } else if (sf === 'approved') {
    activeTasks = approvedTasks;
  } else if (sf === 'overdue') {
    activeTasks = activeTasks.filter(t => t.dueDate && t.dueDate < today);
  } else if (sf === 'delegated') {
    activeTasks = delegatedTasks;
  } else if (sf === 'completed') {
    activeTasks = [];
  }

  // Active tasks
  const totalVisible = activeTasks.length + approvedTasks.length + delegatedTasks.length + completedTasks.length;
  if (totalVisible === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    if (tasks.length === 0) {
      document.querySelector('.empty-title').textContent = 'No tasks yet';
      document.querySelector('.empty-subtitle').textContent = 'Click "Add Task" to get started';
    } else {
      document.querySelector('.empty-title').textContent = 'No matching tasks';
      document.querySelector('.empty-subtitle').textContent = 'Try adjusting your filters';
    }
    approvedSection.style.display = 'none';
    delegatedSection.style.display = 'none';
    completedSection.style.display = 'none';
    return;
  }

  emptyState.style.display = 'none';
  if (sf === 'delegated') {
    // Show delegated tasks in main container when pill is active
    container.innerHTML = activeTasks.length > 0
      ? sortTasks(activeTasks).map(renderTaskItem).join('')
      : '<div class="empty-state" style="padding: 1.5rem;"><p class="empty-subtitle">No delegated tasks</p></div>';
  } else if (sf === 'completed') {
    container.innerHTML = '';
  } else if (activeTasks.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 1.5rem;"><p class="empty-subtitle">No active tasks matching this filter</p></div>';
  } else {
    container.innerHTML = sortTasks(activeTasks).map(renderTaskItem).join('');
  }

  // Approved section (collapsed by default, hidden when approved pill is active)
  if (approvedTasks.length > 0 && sf !== 'approved') {
    approvedSection.style.display = 'block';
    approvedCountEl.textContent = approvedTasks.length;
    approvedList.innerHTML = sortTasks(approvedTasks).map(renderTaskItem).join('');
  } else {
    approvedSection.style.display = 'none';
  }

  // Delegated section (collapsed by default, hidden when delegated pill is active)
  if (delegatedTasks.length > 0 && sf !== 'delegated') {
    delegatedSection.style.display = 'block';
    delegatedCountEl.textContent = delegatedTasks.length;
    delegatedList.innerHTML = sortTasks(delegatedTasks).map(renderTaskItem).join('');
  } else {
    delegatedSection.style.display = 'none';
  }

  // Backlog section (collapsed by default, hidden when backlog pill is active)
  if (backlogTasks.length > 0 && sf !== 'backlog') {
    backlogSection.style.display = 'block';
    backlogCountEl.textContent = backlogTasks.length;
    backlogList.innerHTML = sortTasks(backlogTasks).map(renderTaskItem).join('');
  } else {
    backlogSection.style.display = 'none';
  }

  // Completed section
  if (completedTasks.length > 0) {
    completedSection.style.display = 'block';
    completedCount.textContent = completedTasks.length;
    completedList.innerHTML = completedTasks.map(renderTaskItem).join('');
  } else {
    completedSection.style.display = 'none';
  }
}

function getFilteredCompletedTasks() {
  const completedPeriod = document.getElementById('completed-period') ?
    document.getElementById('completed-period').value : '2weeks';
  let completed = getFilteredTasks().filter(t => t.status === 'Completed');

  if (completedPeriod !== 'all') {
    const now = new Date();
    let cutoff;
    if (completedPeriod === 'week') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (completedPeriod === '2weeks') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);
    } else if (completedPeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    } else if (completedPeriod === 'quarter') {
      cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    }
    completed = completed.filter(t => t.completedAt && new Date(t.completedAt) >= cutoff);
  }
  return completed;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeHtmlWithLinks(str) {
  const escaped = escapeHtml(str);
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    function(url) {
      const cleanUrl = url.replace(/&amp;/g, '&');
      return `<a href="${cleanUrl}" target="_blank" rel="noopener" class="inline-link">${url}</a>`;
    }
  );
}

function renderMarkdown(str) {
  let html = escapeHtml(str);
  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--follett-light-gray);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em;">$1</code>');
  // Headers
  html = html.replace(/^### (.+)$/gm, '<strong style="font-size:0.95em;display:block;margin-top:0.75em;">$1</strong>');
  html = html.replace(/^## (.+)$/gm, '<strong style="font-size:1.05em;display:block;margin-top:0.75em;">$1</strong>');
  html = html.replace(/^# (.+)$/gm, '<strong style="font-size:1.1em;display:block;margin-top:0.75em;">$1</strong>');
  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  // Unordered lists
  html = html.replace(/^[-•] (.+)$/gm, '<li style="margin-left:1.25em;list-style:disc;">$1</li>');
  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li style="margin-left:1.25em;list-style:decimal;">$1</li>');
  // Line breaks (but not inside pre blocks)
  html = html.replace(/\n/g, '<br>');
  // Clean up br inside pre
  html = html.replace(/<pre><code>([\s\S]*?)<\/code><\/pre>/g, (m, code) => '<pre><code>' + code.replace(/<br>/g, '\n') + '</code></pre>');
  // App link tags (tasks, notes, files)
  html = html.replace(/\[tasklink:([^\]:]+):([^\]]+)\]/g, (_, id, title) =>
    `<a href="#" class="ai-link ai-link-task" data-task-id="${id}" onclick="event.preventDefault();showTaskDetail('${id}')">${title}</a>`);
  html = html.replace(/\[notelink:([^\]:]+):([^\]]+)\]/g, (_, id, title) =>
    `<a href="#" class="ai-link ai-link-note" data-note-id="${id}" onclick="event.preventDefault();switchView('notes');openNote('${id}')">${title}</a>`);
  html = html.replace(/\[filelink:([^\]:]+):([^\]]+)\]/g, (_, path, name) =>
    `<a href="#" class="ai-link ai-link-file" data-gcs-path="${escapeHtml(path)}" onclick="event.preventDefault();downloadFile('${path.replace(/'/g, "\\'")}')">${name}</a>`);
  // Links
  html = html.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
    const cleanUrl = url.replace(/&amp;/g, '&');
    return `<a href="${cleanUrl}" target="_blank" rel="noopener" class="inline-link">${url}</a>`;
  });
  return html;
}

// === Due Date Formatting ===
function formatDueDate(dueDate, isCompleted, startDate) {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  const dateLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Multi-day range display
  if (startDate && startDate !== dueDate) {
    const startLabel = new Date(startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const rangeLabel = `${startLabel} – ${dateLabel}`;
    if (isCompleted) {
      return `<span class="task-due-date">${rangeLabel}</span>`;
    }
    if (diffDays < 0) {
      return `<span class="task-due-date overdue">Overdue · ${rangeLabel}</span>`;
    }
    const startDiff = Math.round((new Date(startDate + 'T00:00:00') - today) / (1000 * 60 * 60 * 24));
    if (startDiff <= 0 && diffDays >= 0) {
      return `<span class="task-due-date due-today">${rangeLabel} (active)</span>`;
    }
    if (startDiff <= 3) {
      return `<span class="task-due-date due-soon">${rangeLabel}</span>`;
    }
    return `<span class="task-due-date">${rangeLabel}</span>`;
  }

  if (isCompleted) {
    return `<span class="task-due-date">${dateLabel}</span>`;
  }
  if (diffDays < 0) {
    return `<span class="task-due-date overdue">Overdue \u00b7 ${dateLabel}</span>`;
  }
  if (diffDays === 0) {
    return `<span class="task-due-date due-today">Due today</span>`;
  }
  if (diffDays <= 3) {
    return `<span class="task-due-date due-soon">Due in ${diffDays}d</span>`;
  }
  return `<span class="task-due-date">${dateLabel}</span>`;
}

// === Sorting ===
function sortTasks(taskList) {
  const sort = filters.sort;
  return [...taskList].sort((a, b) => {
    if (sort === 'due-date') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (sort === 'priority') {
      const order = { 'High': 0, 'Medium': 1, 'Low': 2 };
      return (order[a.priority] || 1) - (order[b.priority] || 1);
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
}

// === Filtering ===
function getFilteredTasks() {
  const today = new Date().toISOString().split('T')[0];
  return tasks.filter(t => {
    if (filters.department !== 'all') {
      if (filters.department === 'All Marketing') {
        // Show B2B + B2C + All Marketing tasks
        if (t.department !== 'B2B Marketing' && t.department !== 'B2C Marketing' && t.department !== 'All Marketing') return false;
      } else if (t.department !== filters.department) {
        return false;
      }
    }
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.notes || '').toLowerCase().includes(q)) return false;
    }
    // Tag filter
    if (activeTaskTagFilter) {
      if (!(t.tags || []).includes(activeTaskTagFilter)) return false;
    }
    // Status pill filter
    const sf = filters.statFilter;
    if (sf && sf !== 'none') {
      if (sf === 'backlog' && t.status !== 'Backlog') return false;
      if (sf === 'not-started' && t.status !== 'Not Started') return false;
      if (sf === 'in-progress' && t.status !== 'In Progress') return false;
      if (sf === 'blocked' && t.status !== 'Blocked') return false;
      if (sf === 'approved' && t.status !== 'Approved') return false;
      if (sf === 'delegated' && t.status !== 'Delegated') return false;
      if (sf === 'overdue' && !(t.status !== 'Completed' && t.status !== 'Delegated' && t.status !== 'Backlog' && t.dueDate && t.dueDate < today)) return false;
      if (sf === 'completed' && t.status !== 'Completed') return false;
    }
    return true;
  });
}

function applyFilters(reload) {
  filters.department = document.getElementById('filter-department').value;
  filters.priority = document.getElementById('filter-priority').value;
  filters.search = document.getElementById('filter-search').value;
  filters.sort = document.getElementById('filter-sort').value;
  if (reload) {
    loadTasks().then(render);
  } else {
    render();
  }
}

// === Task Operations (API-backed) ===
let currentTaskTags = [];

async function addTask(title, department, priority, notes, source, attachments, dueDate, recurring, assignedTo, tags, startDate) {
  const taskData = {
    title: title.trim(),
    department,
    tags: tags || [],
    priority: priority || 'Medium',
    notes: notes || '',
    status: 'Not Started',
    completedAt: '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
    attachments: attachments || [],
    startDate: startDate || '',
    dueDate: dueDate || '',
    recurring: recurring || 'none',
    workspaceId: activeWorkspaceId || ''
  };
  if (assignedTo && myProfile && assignedTo !== myProfile.userId) {
    taskData.assignedTo = assignedTo;
    taskData.status = 'Delegated';
  } else if (assignedTo) {
    taskData.assignedTo = assignedTo;
  }

  try {
    const created = await api('POST', '/api/tasks', taskData);
    await loadTasks();
    render();
    return created;
  } catch (err) {
    showToast('Failed to create task', 'error');
    return null;
  }
}

async function handleRecurringTaskCompletion(task) {
  if (task.recurring && task.recurring !== 'none') {
    const nextDue = getNextDueDate(task.dueDate, task.recurring);
    await addTask(
      task.title,
      task.department,
      task.priority,
      task.notes,
      'manual',
      task.attachments || [],
      nextDue,
      task.recurring,
      task.assignedTo || undefined,
      task.tags || [],
      task.startDate ? getNextDueDate(task.startDate, task.recurring) : ''
    );
    showToast(`Next ${task.recurring} occurrence created`);
  }
}

function getNextDueDate(currentDueDate, frequency) {
  if (!currentDueDate) {
    // No due date — use today as the base
    const today = new Date();
    currentDueDate = today.toISOString().split('T')[0];
  }
  const date = new Date(currentDueDate + 'T00:00:00');
  switch (frequency) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'biweekly': date.setDate(date.getDate() + 14); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
  }
  return date.toISOString().split('T')[0];
}

async function setTaskStatus(id, newStatus) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const updates = {
    status: newStatus,
    completed: newStatus === 'Completed',
    completedAt: newStatus === 'Completed' ? (task.completedAt || new Date().toISOString()) : ''
  };

  if (newStatus === 'Blocked') {
    const reason = prompt('What\'s blocking this task? (optional)');
    if (reason) updates.blockedReason = reason;
  }

  // Optimistic update
  Object.assign(task, updates);
  render();

  try {
    await api('PUT', `/api/tasks/${id}`, updates);

    // Auto-create next occurrence for recurring tasks
    if (newStatus === 'Completed') await handleRecurringTaskCompletion(task);
  } catch (err) {
    await loadTasks();
    render();
    showToast('Failed to update status', 'error');
  }
}

async function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  deleteConfirmId = null;
  render();

  try {
    await api('DELETE', `/api/tasks/${id}`);
  } catch (err) {
    await loadTasks();
    render();
    showToast('Failed to delete task', 'error');
  }
}

async function deleteTaskFromDetail(id) {
  if (!confirm('Delete this task? This cannot be undone.')) return;
  closeModal('modal-detail');
  await deleteTask(id);
}

// === Edit Task ===
async function editTask(id) {
  let task = tasks.find(t => t.id === id);
  // Subtasks aren't in the main tasks array — fetch from API
  if (!task) {
    try { task = await api('GET', `/api/tasks/${id}`); } catch { return; }
  }
  if (!task) return;

  closeModal('modal-detail');
  editingTaskId = id;

  document.getElementById('input-title').value = task.title;
  document.getElementById('input-department').value = task.department;
  document.getElementById('input-priority').value = task.priority;
  document.getElementById('input-start-date').value = task.startDate || '';
  document.getElementById('input-due-date').value = task.dueDate || '';
  document.getElementById('input-notes').value = task.notes || '';
  document.getElementById('input-recurring').value = task.recurring || 'none';
  currentTaskTags = task.tags || (task.subDepartment ? [task.subDepartment] : []);
  renderTaskFormTags();
  document.getElementById('input-assign-to').value = task.assignedTo || '';

  // Set workspace dropdown
  const wsSelect = document.getElementById('input-workspace');
  if (wsSelect) {
    wsSelect.innerHTML = '<option value="">None</option>' +
      workspaces.map(w => `<option value="${w.id}" ${w.id === task.workspaceId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
  }

  // Load existing attachments into pending lists
  pendingAttachments = (task.attachments || []).filter(a => a.type === 'file');
  pendingLinks = (task.attachments || []).filter(a => a.type === 'link');
  renderPendingAttachments();
  renderPendingLinks();

  document.getElementById('modal-add-title').textContent = 'Edit Task';
  document.getElementById('btn-submit-task').textContent = 'Save Changes';
  openModal('modal-add');
}

// === Department Auto-detection ===
function detectDepartment(text) {
  const lower = text.toLowerCase();
  let bestDept = '';
  let bestScore = 0;

  for (const [dept, keywords] of Object.entries(DEPT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDept = dept;
    }
  }
  return bestDept;
}

// === Modal Helpers ===
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  // Focus first input
  setTimeout(() => {
    const input = document.querySelector(`#${id} input[type="text"], #${id} textarea`);
    if (input) input.focus();
  }, 50);
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function resetAddForm() {
  editingTaskId = null;
  document.getElementById('form-add-task').reset();
  document.getElementById('input-priority').value = 'Medium';
  document.getElementById('input-start-date').value = '';
  document.getElementById('modal-add-title').textContent = 'Add Task';
  document.getElementById('btn-submit-task').textContent = 'Add Task';
  pendingAttachments = [];
  pendingLinks = [];
  renderPendingAttachments();
  renderPendingLinks();

  // Context-aware: pre-fill department from user's profile
  const deptSelect = document.getElementById('input-department');
  const deptRow = document.getElementById('form-row-dept');
  if (activeWorkspaceId) {
    // In a workspace: hide department row, auto-default
    deptRow.style.display = 'none';
    deptSelect.value = (myProfile && myProfile.departments && myProfile.departments[0]) || 'B2B Marketing';
  } else {
    deptRow.style.display = '';
    if (myProfile && myProfile.role !== 'cmo' && myProfile.departments && myProfile.departments.length > 0) {
      deptSelect.value = myProfile.departments[0];
    }
  }
  // Reset task tags
  currentTaskTags = [];
  renderTaskFormTags();

  // Populate workspace dropdown
  const wsSelect = document.getElementById('input-workspace');
  if (wsSelect) {
    wsSelect.innerHTML = '<option value="">None</option>' +
      workspaces.map(w => `<option value="${w.id}" ${w.id === activeWorkspaceId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('');
  }
}

function renderTaskFormTags() {
  const container = document.getElementById('task-tags-list');
  if (!container) return;
  container.innerHTML = currentTaskTags.map(tag => renderTagChip(tag, { removable: true })).join('');
  container.querySelectorAll('.note-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentTaskTags = currentTaskTags.filter(t => t !== btn.dataset.removeTag);
      renderTaskFormTags();
    });
  });
}

function initTaskTagInput() {
  const input = document.getElementById('task-tag-input');
  if (!input) return;
  const addTag = () => {
    const tag = input.value.trim().replace(/,/g, '');
    if (tag && !currentTaskTags.includes(tag)) {
      currentTaskTags.push(tag);
      renderTaskFormTags();
    }
    input.value = '';
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); } });
  input.addEventListener('change', addTag);
}

// === Attachment Handling ===
async function handleFiles(files) {
  for (const file of files) {
    if (file.size > 50 * 1024 * 1024) {
      showToast(`File "${file.name}" is too large (max 50MB)`, 'error');
      continue;
    }
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const result = await res.json();
      pendingAttachments.push({
        type: 'file',
        name: result.name,
        gcsPath: result.gcsPath,
        size: result.size
      });
      renderPendingAttachments();
    } catch (err) {
      showToast(`Failed to upload "${file.name}"`, 'error');
    }
  }
}

function renderPendingAttachments() {
  const list = document.getElementById('attachment-list');
  list.innerHTML = pendingAttachments.map((a, i) => `
    <div class="attachment-item">
      <span class="attachment-item-name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(a.name)}</span>
      <button class="attachment-remove" data-attachment-idx="${i}">&times;</button>
    </div>
  `).join('');
}

function renderPendingLinks() {
  const list = document.getElementById('link-list');
  list.innerHTML = pendingLinks.map((l, i) => `
    <div class="link-item">
      <span class="link-item-name"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${escapeHtml(l.name || l.url)}</span>
      <button class="link-remove" data-link-idx="${i}">&times;</button>
    </div>
  `).join('');
}

// === Task Detail View ===
function showTaskDetail(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const deptKey = DEPT_KEYS[task.department] || 'b2b';
  const prioKey = task.priority.toLowerCase();
  const date = new Date(task.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const assignedMember = teamMembers.find(m => m.userId === task.assignedTo);
  const assignedName = assignedMember ? assignedMember.displayName : 'Me';
  const createdMember = teamMembers.find(m => m.userId === task.createdBy);
  const createdName = createdMember ? createdMember.displayName : 'Me';

  // Build assignee dropdown options (exclude self — "Me" covers that)
  const myId = myProfile ? myProfile.userId : '';
  const assignOptions = '<option value="">Me</option>' + teamMembers
    .filter(m => (m.status === 'active' || !m.status) && m.userId !== myId)
    .map(m => `<option value="${m.userId}" ${m.userId === task.assignedTo ? 'selected' : ''}>${escapeHtml(m.displayName)}</option>`)
    .join('');

  let attachmentsHtml = '';
  if (task.attachments && task.attachments.length > 0) {
    const items = task.attachments.map(a => {
      if (a.type === 'file') {
        if (a.gcsPath) {
          return `<li><a href="#" class="file-download-link" data-gcs-path="${escapeHtml(a.gcsPath)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(a.name)}</a></li>`;
        }
        return `<li><a href="${a.data}" download="${escapeHtml(a.name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(a.name)}</a></li>`;
      } else {
        return `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="external-link"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${escapeHtml(a.name || a.url)}</a></li>`;
      }
    }).join('');
    attachmentsHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Attachments</div>
        <ul class="detail-attachments">${items}</ul>
      </div>`;
  }

  document.getElementById('detail-title').textContent = task.title;
  const isSubtask = !!task.parentTaskId;
  let parentContext = '';
  if (isSubtask) {
    let parentAttachHtml = '';
    if (task.parentTaskAttachments && task.parentTaskAttachments.length > 0) {
      const items = task.parentTaskAttachments.map(a => {
        if (a.type === 'file' && a.gcsPath) {
          return `<li><a href="#" class="file-download-link" data-gcs-path="${escapeHtml(a.gcsPath)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(a.name)}</a></li>`;
        } else if (a.url) {
          return `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="external-link">${escapeHtml(a.name || a.url)}</a></li>`;
        }
        return '';
      }).filter(Boolean).join('');
      if (items) parentAttachHtml = `<ul class="detail-attachments" style="margin-top:0.375rem;">${items}</ul>`;
    }
    parentContext = `
    <div style="background: var(--color-b2b-light); border-radius: var(--radius); padding: 0.625rem 0.875rem; margin-bottom: 1rem; font-size: 0.85rem;">
      <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--follett-dark-blue); margin-bottom: 0.25rem;">Part of</div>
      <strong>${escapeHtml(task.parentTaskTitle || 'Parent Task')}</strong>
      ${task.parentTaskDueDate ? `<span style="font-size:0.75rem;color:var(--color-text-muted);margin-left:0.5rem;">Due: ${task.parentTaskDueDate}</span>` : ''}
      ${task.parentTaskNotes ? `<div style="margin-top: 0.375rem; font-size: 0.8rem; color: var(--color-text-muted); white-space: pre-wrap;">${escapeHtmlWithLinks(task.parentTaskNotes)}</div>` : ''}
      ${parentAttachHtml}
    </div>`;
  }

  document.getElementById('detail-content').innerHTML = `
    ${parentContext}
    <div class="detail-grid">
      <div>
        <div class="detail-section-title">Status</div>
        <select class="filter-select-compact" onchange="setTaskStatusFromDetail('${task.id}', this.value)" style="font-size:0.8rem;">
          ${STATUSES.filter(s => s !== 'Delegated').map(s => `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
        ${task.recurring && task.recurring !== 'none' ? `<span style="font-size:0.75rem;color:var(--follett-medium-blue);margin-left:0.375rem;">&#8635; ${task.recurring}</span>` : ''}
      </div>
      <div>
        <div class="detail-section-title">Priority</div>
        <span class="badge badge-${prioKey}">${task.priority}</span>
      </div>
      <div>
        <div class="detail-section-title">Department</div>
        <select class="filter-select-compact" onchange="moveTaskDepartment('${task.id}', this.value)" style="font-size:0.8rem;">
          ${DEPARTMENTS.map(d => `<option value="${d}" ${d === task.department ? 'selected' : ''}>${d}</option>`).join('')}
        </select>
      </div>
      <div>
        <div class="detail-section-title">Workspace</div>
        <select class="filter-select-compact" onchange="moveTaskWorkspace('${task.id}', this.value)" style="font-size:0.8rem;">
          <option value="" ${!task.workspaceId ? 'selected' : ''}>None</option>
          ${workspaces.map(w => `<option value="${w.id}" ${w.id === task.workspaceId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`).join('')}
        </select>
      </div>
      <div>
        <div class="detail-section-title">${task.startDate ? 'Dates' : 'Due Date'}</div>
        ${task.startDate && task.dueDate ? `<span>${formatDueDate(task.dueDate, task.status === 'Completed', task.startDate)}</span>` : ''}
        <div style="display:flex;gap:0.375rem;align-items:center;margin-top:0.25rem;">
          <input type="date" value="${task.dueDate || ''}" onchange="updateTaskDueDate('${task.id}', this.value)" style="font-size:0.8rem;padding:0.25rem 0.4rem;border:1px solid var(--color-border);border-radius:var(--radius);font-family:'Roboto',sans-serif;">
        </div>
      </div>
      <div>
        <div class="detail-section-title">Assigned To</div>
        <select class="filter-select-compact" onchange="reassignTask('${task.id}', this.value)" style="font-size:0.8rem;">
          ${assignOptions}
        </select>
      </div>
      <div>
        <div class="detail-section-title">Created By</div>
        <span style="font-size:0.85rem;">${escapeHtml(createdName)} &middot; ${dateStr}</span>
      </div>
    </div>

    ${myProfile && task.createdBy === myProfile.userId ? `<div style="margin-bottom:0.75rem;"><label style="font-size:0.8rem;cursor:pointer;display:inline-flex;align-items:center;gap:0.375rem;color:var(--color-text-muted);"><input type="checkbox" ${task.private ? 'checked' : ''} onchange="toggleTaskPrivate('${task.id}', this.checked)" style="accent-color:var(--follett-dark-blue);"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private — only visible to you</label></div>` : (task.private ? '<div style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.75rem;"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> Private</div>' : '')}

    ${(task.workspaceId || activeWorkspaceId) ? `<div style="margin-bottom:0.75rem;"><label style="font-size:0.8rem;cursor:pointer;display:inline-flex;align-items:center;gap:0.375rem;color:var(--follett-medium-blue);font-weight:500;"><input type="checkbox" ${task.showOnMaster ? 'checked' : ''} onchange="toggleShowOnMaster('${task.id}', ${!!task.showOnMaster})" style="accent-color:var(--follett-medium-blue);"> Show on Master List</label></div>` : ''}
    <div style="margin-bottom:0.75rem;">
      <div class="detail-section-title">Tags</div>
      <div style="display:flex;gap:0.25rem;flex-wrap:wrap;align-items:center;" id="detail-tags">
        ${(task.tags || []).map(t => renderTagChip(t, { removable: true })).join('')}
        <input type="text" class="note-tag-input" id="detail-tag-input" placeholder="Add tag..." list="detail-tag-suggestions" style="width:80px;">
        ${buildTagDatalist('detail-tag-suggestions')}
      </div>
    </div>
    ${task.blockedReason ? `<div style="background:var(--color-medium-light);border-radius:var(--radius);padding:0.625rem 0.875rem;margin-bottom:0.75rem;font-size:0.85rem;"><strong style="color:#a17508;">Blocked:</strong> ${escapeHtml(task.blockedReason)}</div>` : ''}
    ${task.notes ? `<div class="detail-section"><div class="detail-section-title">Notes</div><div class="detail-notes">${escapeHtmlWithLinks(task.notes)}</div></div>` : ''}
    ${attachmentsHtml}
    ${task.completedAt ? `<div style="font-size:0.8rem;color:var(--color-text-light);margin-bottom:0.75rem;">Completed ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}

    <div class="detail-section" id="detail-subtasks">
      <div class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.25rem;">
        Sub-tasks
        <div style="display:flex;gap:0.25rem;">
          ${allTemplates.length > 0 ? `<select class="filter-select-compact" style="font-size:0.7rem;" onchange="if(this.value){applyTemplate(this.value,'${task.id}');this.value='';}" ><option value="">Use Template</option>${allTemplates.map(t => `<option value="${t.id}">${escapeHtml(t.name)} (${t.subtasks.length})</option>`).join('')}</select>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="showSubtaskForm('${task.id}', '${escapeHtml(task.department)}')" id="btn-show-subtask-form" style="font-size:0.75rem;">+ Add</button>
        </div>
      </div>
      <div id="subtask-form" style="display:none;margin:0.5rem 0;padding:0.625rem;background:var(--follett-light-gray);border-radius:var(--radius);">
        <input type="text" id="subtask-title" placeholder="What needs to be done?" style="width:100%;padding:0.4rem 0.6rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.85rem;margin-bottom:0.375rem;">
        <div style="display:flex;gap:0.375rem;flex-wrap:wrap;">
          <select id="subtask-assign" class="filter-select-compact" style="font-size:0.75rem;flex:1;">
            ${assignOptions}
          </select>
          <input type="date" id="subtask-due" class="filter-select-compact" style="font-size:0.75rem;">
          <button class="btn btn-primary btn-sm" onclick="submitSubtask('${task.id}', '${escapeHtml(task.department)}')" style="font-size:0.75rem;">Add</button>
          <button class="btn btn-ghost btn-sm" onclick="hideSubtaskForm()" style="font-size:0.75rem;">Cancel</button>
        </div>
      </div>
      <div id="subtask-list" style="font-size: 0.85rem;">Loading...</div>
    </div>

    <div class="detail-section" id="detail-comments">
      <div class="detail-section-title">Comments</div>
      <div id="comments-list" style="font-size: 0.85rem;">Loading...</div>
      <div style="margin-top:0.5rem;">
        <textarea id="comment-input" placeholder="Add a comment, copy edit, or feedback..." rows="3" style="width:100%;padding:0.5rem 0.6rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.85rem;font-family:'Roboto',sans-serif;resize:vertical;min-height:60px;line-height:1.5;"></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:0.375rem;">
          <button class="btn btn-primary btn-sm" onclick="addComment('${task.id}')">Post Comment</button>
        </div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Watchers</div>
      <div id="detail-watchers" style="display:flex;align-items:center;gap:0.375rem;flex-wrap:wrap;">
        ${(task.watchers || []).map(wId => {
          const wm = teamMembers.find(m => m.userId === wId);
          const wName = wm ? wm.displayName : 'Unknown';
          const wInitials = wName.trim().split(' ').map(w => w[0]).filter(Boolean).join('').substring(0, 2).toUpperCase();
          const wColors = ['#479FC8', '#DC6B67', '#ABC39B', '#204A65', '#7398A9', '#d4960a', '#2e7d32', '#8e6bbf'];
          const wColorIdx = wName.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % wColors.length;
          return `<span class="watcher-chip" title="${escapeHtml(wName)}" style="background:${wColors[wColorIdx]}">${wInitials}</span>`;
        }).join('')}
        <button class="btn btn-ghost btn-sm" onclick="toggleWatch('${task.id}')" style="font-size:0.75rem;">
          ${myProfile && (task.watchers || []).includes(myProfile.userId) ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Watching' : '+ Watch'}
        </button>
        <select class="filter-select-compact" style="font-size:0.7rem;" onchange="if(this.value){addWatcher('${task.id}',this.value);this.value='';}">
          <option value="">+ Add watcher</option>
          ${teamMembers.filter(m => (m.status === 'active' || !m.status) && !(task.watchers || []).includes(m.userId)).map(m => `<option value="${m.userId}">${escapeHtml(m.displayName)}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="detail-actions">
      ${(myProfile && task.createdBy && task.createdBy !== myProfile.userId && task.status !== 'Approved' && task.status !== 'Completed') ? `<button class="btn btn-primary" onclick="approveAndReturn('${task.id}', '${task.createdBy}')" style="background:#2e7d32;">&#10003; Approve</button><button class="btn btn-secondary" onclick="needsRevision('${task.id}', '${task.createdBy}')" style="color:var(--follett-coral);border-color:var(--follett-coral);">&#8617; Needs Revision</button>` : ''}
      <button class="btn btn-primary" onclick="editTask('${task.id}')">Edit Task</button>
      ${(myProfile && (myProfile.role === 'cmo' || task.createdBy === myProfile.userId)) ? `<button class="btn btn-ghost" onclick="deleteTaskFromDetail('${task.id}')" style="color:var(--follett-coral);">Delete</button>` : ''}
    </div>
  `;
  openModal('modal-detail');
  loadSubtasks(task.id);
  loadComments(task.id);

  // @mention autocomplete on comment textarea
  const commentBox = document.getElementById('comment-input');
  if (commentBox) setupMentionAutocomplete(commentBox);

  // Detail tag handlers
  document.querySelectorAll('#detail-tags .note-tag-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newTags = (task.tags || []).filter(t => t !== btn.dataset.removeTag);
      try { await api('PUT', `/api/tasks/${task.id}`, { tags: newTags }); task.tags = newTags; showTaskDetail(task.id); } catch {}
    });
  });
  const detailTagInput = document.getElementById('detail-tag-input');
  if (detailTagInput) {
    const addDetailTag = async () => {
      const tag = detailTagInput.value.trim();
      if (tag && !(task.tags || []).includes(tag)) {
        const newTags = [...(task.tags || []), tag];
        try { await api('PUT', `/api/tasks/${task.id}`, { tags: newTags }); task.tags = newTags; showTaskDetail(task.id); } catch {}
      }
      detailTagInput.value = '';
    };
    detailTagInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addDetailTag(); } });
    detailTagInput.addEventListener('change', addDetailTag);
  }
}

async function loadComments(taskId) {
  try {
    const comments = await api('GET', `/api/tasks/${taskId}/comments`);
    const container = document.getElementById('comments-list');
    if (comments.length === 0) {
      container.innerHTML = '<span style="font-size:0.8rem;color:var(--color-text-light);">No comments yet</span>';
      return;
    }
    container.innerHTML = comments.map(c => {
      const ago = timeAgo(c.createdAt);
      const subtaskLabel = c.subtaskTitle ? `<span style="color:var(--follett-medium-blue);font-size:0.7rem;"> on "${escapeHtml(c.subtaskTitle)}"</span>` : '';
      return `<div style="padding:0.5rem 0;border-bottom:1px solid var(--color-border);">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span style="font-weight:500;font-size:0.8rem;">${escapeHtml(c.authorName)}${subtaskLabel}</span>
          <span style="font-size:0.7rem;color:var(--color-text-light);">${ago}</span>
        </div>
        <div style="margin-top:0.25rem;font-size:0.85rem;line-height:1.5;white-space:pre-wrap;">${renderMentions(escapeHtmlWithLinks(c.text))}</div>
      </div>`;
    }).join('');
  } catch { document.getElementById('comments-list').innerHTML = '<span style="color:var(--color-text-light);font-size:0.8rem;">Failed to load comments</span>'; }
}

function renderMentions(html) {
  const names = teamMembers.map(m => m.displayName).filter(Boolean);
  const firstNames = teamMembers.map(m => (m.displayName || '').split(' ')[0]).filter(Boolean);
  const all = [...new Set([...names, ...firstNames])].sort((a, b) => b.length - a.length);
  all.forEach(name => {
    const regex = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s,;.!?]|$)`, 'gi');
    html = html.replace(regex, `<span style="background:var(--color-b2b-light);color:var(--follett-dark-blue);font-weight:500;padding:0.05em 0.3em;border-radius:3px;">@${name}</span>`);
  });
  return html;
}

let mentionDropdown = null;

function setupMentionAutocomplete(textarea) {
  if (mentionDropdown) { mentionDropdown.remove(); mentionDropdown = null; }

  textarea.addEventListener('input', () => {
    const val = textarea.value;
    const cursor = textarea.selectionStart;
    const before = val.substring(0, cursor);
    const atMatch = before.match(/@(\w*)$/);

    if (!atMatch) { if (mentionDropdown) { mentionDropdown.remove(); mentionDropdown = null; } return; }

    const query = atMatch[1].toLowerCase();
    const matches = teamMembers.filter(m =>
      (m.status === 'active' || !m.status) &&
      (m.displayName || '').toLowerCase().includes(query)
    ).slice(0, 6);

    if (matches.length === 0) { if (mentionDropdown) { mentionDropdown.remove(); mentionDropdown = null; } return; }

    if (!mentionDropdown) {
      mentionDropdown = document.createElement('div');
      mentionDropdown.className = 'mention-dropdown';
      mentionDropdown.style.cssText = 'position:absolute;background:#fff;border:1px solid var(--color-border);border-radius:var(--radius);box-shadow:var(--shadow-lg);z-index:100;max-height:180px;overflow-y:auto;width:200px;';
      textarea.parentElement.style.position = 'relative';
      textarea.parentElement.appendChild(mentionDropdown);
    }
    mentionDropdown.style.bottom = (textarea.offsetHeight + 4) + 'px';
    mentionDropdown.style.left = '0';
    mentionDropdown.innerHTML = matches.map(m =>
      `<div class="mention-option" data-name="${escapeHtml(m.displayName)}" style="padding:0.4rem 0.6rem;cursor:pointer;font-size:0.85rem;border-bottom:1px solid var(--color-border);">${escapeHtml(m.displayName)}</div>`
    ).join('');
    mentionDropdown.querySelectorAll('.mention-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const name = opt.dataset.name;
        const atStart = before.lastIndexOf('@');
        textarea.value = val.substring(0, atStart) + '@' + name + ' ' + val.substring(cursor);
        textarea.selectionStart = textarea.selectionEnd = atStart + name.length + 2;
        textarea.focus();
        mentionDropdown.remove();
        mentionDropdown = null;
      });
    });
  });

  textarea.addEventListener('blur', () => {
    setTimeout(() => { if (mentionDropdown) { mentionDropdown.remove(); mentionDropdown = null; } }, 200);
  });
}

async function addComment(taskId) {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api('POST', `/api/tasks/${taskId}/comments`, { text });
    input.value = '';
    loadComments(taskId);
  } catch (err) { showToast('Failed to post comment', 'error'); }
}

// Cmd/Ctrl+Enter to post comment (plain Enter inserts new line)
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'comment-input' && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    const commentBtn = document.querySelector('[onclick*="addComment"]');
    const match = commentBtn ? commentBtn.getAttribute('onclick').match(/'([^']+)'/) : null;
    if (match && match[1]) addComment(match[1]);
  }
});

function showSubtaskForm(parentId, dept) {
  document.getElementById('subtask-form').style.display = 'block';
  document.getElementById('subtask-title').value = '';
  document.getElementById('subtask-due').value = '';
  document.getElementById('subtask-title').focus();
}

function hideSubtaskForm() {
  document.getElementById('subtask-form').style.display = 'none';
}

async function toggleTaskPrivate(taskId, isPrivate) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { private: isPrivate });
  } catch (err) { showToast('Failed to update', 'error'); }
}

async function addWatcher(taskId, userId) {
  try {
    const task = tasks.find(t => t.id === taskId);
    const current = task ? [...(task.watchers || [])] : [];
    if (!current.includes(userId)) current.push(userId);
    await api('PUT', `/api/tasks/${taskId}`, { watchers: current });
    if (task) task.watchers = current;
    showTaskDetail(taskId);
  } catch (err) { showToast('Failed to add watcher', 'error'); }
}

async function toggleWatch(taskId) {
  try {
    const result = await api('POST', `/api/tasks/${taskId}/watch`);
    // Update local task data
    const task = tasks.find(t => t.id === taskId);
    if (task) task.watchers = result.watchers || [];
    showTaskDetail(taskId);
  } catch (err) { alert('Failed to toggle watch: ' + err.message); }
}

async function setTaskStatusFromDetail(taskId, newStatus) {
  try {
    const updates = { status: newStatus };
    if (newStatus === 'Blocked') {
      const reason = prompt('What\'s blocking this task? (optional)');
      if (reason) updates.blockedReason = reason;
    }
    if (newStatus === 'Completed') {
      updates.completedAt = new Date().toISOString();
    }
    await api('PUT', `/api/tasks/${taskId}`, updates);
    // Auto-create next occurrence for recurring tasks
    if (newStatus === 'Completed') {
      const task = tasks.find(t => t.id === taskId);
      if (task) await handleRecurringTaskCompletion(task);
    }
    await loadTasks();
    render();
    closeModal('modal-detail');
  } catch (err) { showToast('Failed to update status', 'error'); }
}

async function approveAndReturn(taskId, createdBy) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { status: 'Approved', assignedTo: createdBy });
    closeModal('modal-detail');
    await loadTasks();
    render();
  } catch (err) { showToast('Failed to approve', 'error'); }
}

async function needsRevision(taskId, createdBy) {
  const comment = prompt('What needs to be revised?');
  if (!comment) return; // cancelled or empty — don't send back without feedback
  try {
    await api('POST', `/api/tasks/${taskId}/comments`, { text: comment });
    await api('PUT', `/api/tasks/${taskId}`, { status: 'In Progress', assignedTo: createdBy });
    closeModal('modal-detail');
    await loadTasks();
    render();
  } catch (err) { showToast('Failed to send back', 'error'); }
}

async function reassignTask(taskId, newAssignee) {
  try {
    const updates = { assignedTo: newAssignee || undefined };
    if (newAssignee && newAssignee !== myProfile.userId) updates.status = 'Delegated';
    await api('PUT', `/api/tasks/${taskId}`, updates);
    await loadTasks();
    render();
  } catch (err) { showToast('Failed to reassign', 'error'); }
}

async function updateTaskDueDate(taskId, newDate) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { dueDate: newDate || '' });
    const task = tasks.find(t => t.id === taskId);
    if (task) task.dueDate = newDate || '';
    render();
    showToast('Due date updated');
  } catch (err) { showToast('Failed to update due date', 'error'); }
}

async function moveTaskDepartment(taskId, newDept) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { department: newDept, subDepartment: '' });
    const task = tasks.find(t => t.id === taskId);
    if (task) { task.department = newDept; task.subDepartment = ''; }
    render();
    showToast('Moved to ' + newDept);
  } catch (err) { showToast('Failed to move task', 'error'); }
}

async function moveTaskWorkspace(taskId, newWsId) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { workspaceId: newWsId || '' });
    const task = tasks.find(t => t.id === taskId);
    if (task) task.workspaceId = newWsId || '';
    // If we're inside a workspace view and the task was moved out, reload
    if (activeWorkspaceId && newWsId !== activeWorkspaceId) {
      await loadTasks();
    }
    render();
    const ws = workspaces.find(w => w.id === newWsId);
    showToast(newWsId ? 'Moved to ' + ws.name : 'Removed from workspace');
  } catch (err) { showToast('Failed to move task', 'error'); }
}

async function loadSubtasks(parentId) {
  try {
    const subtasks = await api('GET', `/api/tasks/${parentId}/subtasks`);
    const container = document.getElementById('subtask-list');
    if (subtasks.length === 0) {
      container.innerHTML = '<span style="font-size: 0.8rem; color: var(--color-text-light);">No sub-tasks yet</span>';
      return;
    }
    container.innerHTML = subtasks.map(s => {
      const isComplete = s.status === 'Completed';
      const assignName = teamMembers.find(m => m.userId === s.assignedTo);
      const assignLabel = assignName ? escapeHtml(assignName.displayName.split(' ')[0]) : '';
      const dueLabel = s.dueDate ? s.dueDate.substring(5) : '';
      return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.5rem 0.25rem;border-bottom:1px solid var(--color-border);min-height:36px;">
        <button class="task-check ${isComplete ? 'checked' : ''}" onclick="event.stopPropagation();toggleSubtask('${s.id}', '${s.status}', '${parentId}')" style="width:22px;height:22px;font-size:0.7rem;flex-shrink:0;">${isComplete ? '&#10003;' : ''}</button>
        <div style="flex:1;cursor:pointer;min-width:0;" onclick="showTaskDetail('${s.id}')">
          <div style="font-size:0.85rem;${isComplete ? 'text-decoration:line-through;opacity:0.5;' : ''}white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(s.title)}</div>
          ${assignLabel || dueLabel ? `<div style="font-size:0.7rem;color:var(--color-text-light);">${assignLabel}${assignLabel && dueLabel ? ' · ' : ''}${dueLabel}</div>` : ''}
        </div>
        <button class="btn btn-ghost btn-sm" style="font-size:0.7rem;padding:0.3rem 0.5rem;flex-shrink:0;" onclick="event.stopPropagation();editTask('${s.id}')">Edit</button>
      </div>`;
    }).join('');
  } catch (err) { document.getElementById('subtask-list').textContent = 'Failed to load'; }
}

async function toggleSubtask(subtaskId, currentStatus, parentId) {
  const newStatus = currentStatus === 'Completed' ? 'Not Started' : 'Completed';
  try {
    await api('PUT', `/api/tasks/${subtaskId}`, {
      status: newStatus,
      completed: newStatus === 'Completed',
      completedAt: newStatus === 'Completed' ? new Date().toISOString() : ''
    });
    // Reload subtasks directly using the parent ID
    if (parentId) loadSubtasks(parentId);
    // Refresh main task list for updated counts
    await loadTasks();
    render();
  } catch (err) { showToast('Failed to update sub-task', 'error'); }
}

async function submitSubtask(parentId, department) {
  const title = document.getElementById('subtask-title').value.trim();
  if (!title) return;
  const assignedTo = document.getElementById('subtask-assign').value || undefined;
  const dueDate = document.getElementById('subtask-due').value || '';
  // Warn if assigning subtask on a private parent task
  const parentTask = tasks.find(t => t.id === parentId);
  if (parentTask && parentTask.private && assignedTo && myProfile && assignedTo !== myProfile.userId) {
    if (!confirm('This task is private. The assignee will be able to see this task and its subtasks, but it stays hidden from the rest of the team. Continue?')) return;
  }
  try {
    await api('POST', '/api/tasks', {
      title,
      department,
      priority: 'Medium',
      status: (assignedTo && myProfile && assignedTo !== myProfile.userId) ? 'Delegated' : 'Not Started',
      parentTaskId: parentId,
      assignedTo,
      dueDate
    });
    document.getElementById('subtask-title').value = '';
    document.getElementById('subtask-due').value = '';
    loadSubtasks(parentId);
    await loadTasks();
    render();
  } catch (err) { showToast('Failed to create sub-task', 'error'); }
}

// === Gmail Sync ===
async function checkGmailStatus() {
  try {
    const status = await api('GET', '/api/gmail/status');
    const syncBtn = document.getElementById('btn-sync-email');
    if (status.connected) {
      syncBtn.innerHTML = '&#8635; Sync Email';
      syncBtn.title = `Connected to ${status.email}`;
    } else {
      syncBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-1px;"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg> Connect Gmail';
      syncBtn.title = 'Connect your task inbox';
    }
    return status.connected;
  } catch {
    return false;
  }
}

async function handleSyncClick() {
  const connected = await checkGmailStatus();

  if (!connected) {
    // Start OAuth flow
    try {
      const { url } = await api('GET', '/api/gmail/auth');
      window.open(url, 'gmail-auth', 'width=500,height=600');
      // Poll for connection status
      const poll = setInterval(async () => {
        const status = await api('GET', '/api/gmail/status');
        if (status.connected) {
          clearInterval(poll);
          await checkGmailStatus();
          showToast(`Connected to ${status.email}! Click "Sync Email" to import messages.`);
        }
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 300000);
    } catch (err) {
      showToast('Failed to start Gmail authorization', 'error');
    }
    return;
  }

  // Already connected — sync emails
  try {
    document.getElementById('btn-sync-email').innerHTML = '&#8987; Syncing...';
    const result = await api('POST', '/api/sync');
    if (result.synced > 0) {
      await loadTasks();
      render();
      showToast(`Synced ${result.synced} new email${result.synced !== 1 ? 's' : ''} as tasks!`);
    } else {
      showToast('No new unread emails to sync.');
    }
  } catch (err) {
    showToast('Email sync failed', 'error');
  }
  await checkGmailStatus();
}

// === Notes State & Logic ===
let folders = [];
let notesList = [];
let activeNoteId = null;
let activeFolderId = null;
let showMyNotesOnly = false;
let saveTimeout = null;

async function loadFolders() {
  try {
    folders = await api('GET', '/api/folders');
    renderSidebarFolders();
  } catch (err) { console.error('Failed to load folders:', err); }
}

let expandedNoteDepts = new Set();

function renderSidebarFolders() {
  const container = document.getElementById('sidebar-folders');
  if (!container) return;

  // Show main folders only (no sub-department nesting)
  const subDeptNames = ['Biz Dev', 'Growth & Brand', 'Rev Ops', 'Internal Comms'];
  const mainFolders = folders.filter(f => !subDeptNames.includes(f.name));

  let html = '';
  mainFolders.forEach(f => {
    html += `<button class="sidebar-dept-item ${activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`;
  });

  container.innerHTML = html;
  container.querySelectorAll('[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Save or cleanup pending note before switching
      if (activeNoteId) {
        if (saveTimeout) clearTimeout(saveTimeout);
        const title = document.getElementById('editor-title').value.trim();
        const content = document.getElementById('editor-content').innerHTML.trim();
        const isEmpty = (!title || title === 'Untitled') && (!content || content === '<br>' || content === '');
        if (isEmpty) {
          await api('DELETE', `/api/notes/${activeNoteId}`).catch(() => {});
        } else {
          await api('PUT', `/api/notes/${activeNoteId}`, {
            title: title || 'Untitled',
            content: document.getElementById('editor-content').innerHTML
          }).catch(() => {});
        }
      }
      activeNoteId = null;
      document.getElementById('notes-editor-panel').style.display = 'none';
      document.getElementById('notes-no-selection').style.display = 'flex';
      activeFolderId = btn.dataset.folderId || null;
      if (currentUser) sessionStorage.setItem('activeFolderId_' + currentUser.uid, activeFolderId || '');
      switchView('notes');
      const folder = activeFolderId ? folders.find(f => f.id === activeFolderId) : null;
      const isPersonal = folder && (folder.personal || folder.name === 'Personal');
      // Personal folder: force "mine" and hide toggle
      if (isPersonal) {
        showMyNotesOnly = true;
        document.getElementById('btn-my-notes').classList.add('active');
        document.getElementById('btn-all-notes').classList.remove('active');
      }
      document.getElementById('btn-all-notes').style.display = isPersonal ? 'none' : '';
      document.getElementById('btn-my-notes').style.display = isPersonal ? 'none' : '';
      document.getElementById('notes-personal-banner').style.display = isPersonal ? 'block' : 'none';
      loadNotesList(activeFolderId);
      renderSidebarFolders();
      document.getElementById('notes-folder-title').textContent = folder ? folder.name : 'Notes';
      closeSidebar();
    });
  });
}

// Update the My Notes count badge in sidebar
async function updateMyNotesCount() {
  try {
    const myNotes = await api('GET', '/api/notes?mine=true');
    const countEl = document.getElementById('sidebar-count-my-notes');
    if (countEl) {
      const count = myNotes.filter(n => !n.archived).length;
      countEl.textContent = count;
      countEl.style.display = count > 0 ? '' : 'none';
    }
  } catch (err) { /* silent */ }
}

async function loadNotesList(folderId, preserveTagFilter) {
  try {
    if (!preserveTagFilter) activeTagFilter = ''; // Reset tag filter when switching folders
    // When viewing a specific folder, globalMyNotesView doesn't apply — use showMyNotesOnly
    if (folderId) globalMyNotesView = false;
    let url = folderId ? `/api/notes?folderId=${folderId}` : '/api/notes';
    if (globalMyNotesView || showMyNotesOnly) url += (url.includes('?') ? '&' : '?') + 'mine=true';
    notesList = await api('GET', url);
    // Show/hide the All/Mine toggle — hide in global My Notes view
    const toggleAll = document.getElementById('btn-all-notes');
    const toggleMine = document.getElementById('btn-my-notes');
    if (toggleAll && toggleMine) {
      toggleAll.style.display = globalMyNotesView ? 'none' : '';
      toggleMine.style.display = globalMyNotesView ? 'none' : '';
    }
    renderNotesList();
    loadArchivedNotes();
  } catch (err) { notesList = []; renderNotesList(); }
}

let currentNoteTags = [];

function renderNoteTags(tags, canEdit) {
  currentNoteTags = tags || [];
  const container = document.getElementById('note-tags-list');
  container.innerHTML = currentNoteTags.map(tag => renderTagChip(tag, { removable: canEdit })).join('');
  document.getElementById('note-tag-input').style.display = canEdit ? '' : 'none';

  // Remove tag handlers
  container.querySelectorAll('.note-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.removeTag;
      currentNoteTags = currentNoteTags.filter(t => t !== tag);
      saveNoteTags();
      renderNoteTags(currentNoteTags, true);
    });
  });
}

async function saveNoteTags() {
  if (!activeNoteId) return;
  try { await api('PUT', `/api/notes/${activeNoteId}`, { tags: currentNoteTags }); } catch {}
}

function initNoteTagInput() {
  const input = document.getElementById('note-tag-input');
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = input.value.trim().replace(/,/g, '');
      if (tag && !currentNoteTags.includes(tag)) {
        currentNoteTags.push(tag);
        saveNoteTags();
        renderNoteTags(currentNoteTags, true);
      }
      input.value = '';
    }
  });
  // Also add on blur for mobile
  input.addEventListener('change', () => {
    const tag = input.value.trim();
    if (tag && !currentNoteTags.includes(tag)) {
      currentNoteTags.push(tag);
      saveNoteTags();
      renderNoteTags(currentNoteTags, true);
    }
    input.value = '';
  });
}

// Tag filter for notes list
let activeTagFilter = '';

function renderNoteTagFilters() {
  const container = document.getElementById('notes-tag-filter');
  // Collect all unique tags from current notes list
  const allTags = new Set();
  notesList.forEach(n => (n.tags || []).forEach(t => allTags.add(t)));
  if (allTags.size === 0) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  let html = `<span style="font-size:0.65rem;color:var(--color-text-muted);margin-right:0.25rem;">Tags:</span>`;
  if (activeTagFilter) {
    html += `<button class="note-tag-filter-btn" data-tag-filter="" style="font-size:0.6rem;color:var(--color-text-muted);border-color:var(--color-border);">&times; Clear</button>`;
  }
  [...allTags].sort().forEach(tag => {
    const c = getTagColor(tag);
    const isActive = activeTagFilter === tag;
    html += `<button class="note-tag-filter-btn ${isActive ? 'active' : ''}" data-tag-filter="${escapeHtml(tag)}" style="${isActive ? `background:${c.text};color:white;border-color:${c.text};` : `background:${c.bg};color:${c.text};border-color:${c.border};`}">${escapeHtml(tag)}</button>`;
  });
  container.innerHTML = html;
  container.onclick = (e) => {
    const btn = e.target.closest('.note-tag-filter-btn');
    if (!btn) return;
    activeTagFilter = btn.dataset.tagFilter;
    renderNoteTagFilters();
    renderNotesList();
  };
}

function renderNotesList() {
  const container = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');

  // Update tag filter bar
  renderNoteTagFilters();

  // Apply tag filter
  let filtered = notesList;
  if (activeTagFilter) {
    filtered = notesList.filter(n => (n.tags || []).includes(activeTagFilter));
  }

  if (filtered.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const canPin = myProfile && (myProfile.role === 'cmo' || myProfile.role === 'lead');
  container.innerHTML = filtered.map(n => {
    const date = new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isOwn = myProfile && n.createdBy === myProfile.userId;
    const authorLabel = isOwn ? '' : ` &middot; ${escapeHtml(n.authorName || 'Unknown')}`;
    const pinSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h-4L9 2z"/><path d="M5 14h14l-2-5H7l-2 5z"/></svg>';
    const pinBtn = `<span class="note-pin-btn ${n.pinned ? 'pinned' : ''}" data-pin-id="${n.id}" title="${n.pinned ? 'Unpin' : 'Pin to top'}">${pinSvg}</span>`;
    const tagChips = (n.tags || []).map(t => renderTagChip(t, { small: true })).join('');
    // Show source folder badge in global My Notes view
    let sourceBadge = '';
    if (globalMyNotesView && n.folderId) {
      const folder = folders.find(f => f.id === n.folderId);
      if (folder) sourceBadge = `<span class="note-source-badge">${escapeHtml(folder.name)}</span>`;
    }
    return `<button class="note-list-item ${activeNoteId === n.id ? 'active' : ''} ${n.pinned ? 'note-pinned' : ''}" data-note-id="${n.id}">
      <div class="note-list-item-title">${escapeHtml(n.title || 'Untitled')}${sourceBadge}</div>
      <div class="note-list-item-date">${date}${authorLabel} ${pinBtn}</div>
      ${tagChips ? `<div style="display:flex;gap:0.2rem;flex-wrap:wrap;margin-top:0.15rem;">${tagChips}</div>` : ''}
    </button>`;
  }).join('');
  // Event delegation for note list clicks and pin buttons
  container.onclick = async (e) => {
    const pinBtn = e.target.closest('.note-pin-btn');
    if (pinBtn) {
      e.stopPropagation();
      const noteId = pinBtn.dataset.pinId;
      const note = notesList.find(n => n.id === noteId);
      if (!note) return;
      try {
        await api('PUT', `/api/notes/${noteId}`, { pinned: !note.pinned });
        note.pinned = !note.pinned;
        // Re-sort: pinned first
        notesList.sort((a, b) => {
          if (a.pinned && !b.pinned) return -1;
          if (!a.pinned && b.pinned) return 1;
          return (b.updatedAt || '').localeCompare(a.updatedAt || '');
        });
        renderNotesList();
      } catch (err) { console.error('Failed to pin:', err); }
      return;
    }
    const noteItem = e.target.closest('[data-note-id]');
    if (noteItem) {
      openNote(noteItem.dataset.noteId);
    }
  };
}

async function openNote(noteId) {
  try {
    const note = await api('GET', `/api/notes/${noteId}`);
    activeNoteId = noteId;
    document.getElementById('editor-title').value = note.title || '';
    document.getElementById('editor-content').innerHTML = note.content || '';
    document.getElementById('notes-editor-panel').style.display = 'flex';
    document.getElementById('notes-no-selection').style.display = 'none';
    document.getElementById('view-notes').classList.add('note-open');
    document.getElementById('editor-saved').textContent = '';
    document.getElementById('note-ai-panel').style.display = 'none';
    noteAiHistory = [];

    // Private toggle — only show for the creator
    const privateBtn = document.getElementById('btn-toggle-note-private');
    const isCreator = myProfile && note.createdBy === myProfile.userId;
    privateBtn.style.display = isCreator ? '' : 'none';
    privateBtn.style.color = note.private ? 'var(--follett-coral)' : '';
    privateBtn.title = note.private ? 'Private — click to make visible' : 'Click to make private';
    privateBtn.dataset.notePrivate = note.private ? 'true' : 'false';

    // Check if user can edit this note (creator, CMO, or shared user when allowEditing is on)
    const canEdit = myProfile && (myProfile.role === 'cmo' || note.createdBy === myProfile.userId || note.allowEditing);
    document.getElementById('editor-title').readOnly = !canEdit;
    document.getElementById('editor-content').contentEditable = canEdit ? 'true' : 'false';
    document.getElementById('editor-content').style.opacity = canEdit ? '1' : '0.85';
    document.querySelector('.editor-toolbar').style.display = canEdit ? 'flex' : 'none';
    document.getElementById('btn-delete-note').style.display = canEdit ? '' : 'none';
    document.getElementById('note-folder-select').disabled = !canEdit;
    if (!canEdit) {
      document.getElementById('editor-saved').textContent = 'Read-only';
    }

    // Load note links
    currentNoteLinks = note.links || [];
    renderNoteLinks(canEdit);
    document.getElementById('btn-add-note-link').style.display = canEdit ? '' : 'none';
    document.getElementById('note-links-input').style.display = 'none';

    // Populate folder dropdown and set current folder
    const folderSelect = document.getElementById('note-folder-select');
    folderSelect.innerHTML = `<option value="">None</option>` + folders.map(f =>
      `<option value="${f.id}" ${f.id === note.folderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
    ).join('');

    // Populate workspace dropdown
    const wsSelect = document.getElementById('note-workspace-select');
    wsSelect.innerHTML = `<option value="">No workspace</option>` +
      workspaces.map(w =>
        `<option value="${w.id}" ${w.id === note.workspaceId ? 'selected' : ''}>${escapeHtml(w.name)}</option>`
      ).join('');
    wsSelect.disabled = !canEdit;
    wsSelect.style.display = workspaces.length > 0 ? '' : 'none';

    // Render note tags
    renderNoteTags(note.tags || [], canEdit);

    renderNotesList();
  } catch (err) { showToast('Failed to open note', 'error'); }
}

async function createNote() {
  if (!activeFolderId && folders.length > 0) activeFolderId = folders[0].id;
  try {
    const activeFolder = activeFolderId ? folders.find(f => f.id === activeFolderId) : null;
    const isPersonal = activeFolder && (activeFolder.personal || activeFolder.name === 'Personal');
    const noteData = { title: 'Untitled', content: '', folderId: activeFolderId || '', private: isPersonal };
    if (activeWorkspaceNotesView && activeWorkspaceId) noteData.workspaceId = activeWorkspaceId;
    const note = await api('POST', '/api/notes', noteData);
    notesList.unshift(note);
    renderNotesList();
    openNote(note.id);
    updateMyNotesCount();
  } catch (err) { showToast('Failed to create note', 'error'); }
}

function autoLinkUrls(element) {
  // Find text nodes containing URLs that aren't already inside <a> tags
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  const nodesToProcess = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.parentElement || node.parentElement.tagName === 'A') continue;
    if (urlRegex.test(node.textContent)) {
      nodesToProcess.push(node);
    }
    urlRegex.lastIndex = 0;
  }

  nodesToProcess.forEach(node => {
    const frag = document.createDocumentFragment();
    const text = node.textContent;
    let lastIndex = 0;
    let match;
    urlRegex.lastIndex = 0;
    while ((match = urlRegex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
      }
      const a = document.createElement('a');
      a.href = match[1];
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = match[1];
      frag.appendChild(a);
      lastIndex = urlRegex.lastIndex;
    }
    if (lastIndex < text.length) {
      frag.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
    node.parentNode.replaceChild(frag, node);
  });
}

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  const title = document.getElementById('editor-title').value.trim();
  const content = document.getElementById('editor-content').innerHTML.trim();
  const isEmpty = (!title || title === 'Untitled') && (!content || content === '<br>' || content === '');
  if (isEmpty) {
    document.getElementById('editor-saved').textContent = '';
    return;
  }
  document.getElementById('editor-saved').textContent = 'Saving...';
  saveTimeout = setTimeout(async () => {
    if (!activeNoteId) return;
    // Auto-link URLs before saving
    const editorEl = document.getElementById('editor-content');
    autoLinkUrls(editorEl);
    try {
      await api('PUT', `/api/notes/${activeNoteId}`, {
        title: document.getElementById('editor-title').value || 'Untitled',
        content: editorEl.innerHTML
      });
      document.getElementById('editor-saved').textContent = 'Saved';
      const item = notesList.find(n => n.id === activeNoteId);
      if (item) { item.title = document.getElementById('editor-title').value || 'Untitled'; item.updatedAt = new Date().toISOString(); renderNotesList(); }
    } catch { document.getElementById('editor-saved').textContent = 'Save failed'; }
  }, 500);
}

async function deleteNote() {
  if (!activeNoteId || !confirm('Delete this note?')) return;
  try {
    await api('DELETE', `/api/notes/${activeNoteId}`);
    notesList = notesList.filter(n => n.id !== activeNoteId);
    activeNoteId = null;
    document.getElementById('notes-editor-panel').style.display = 'none';
    document.getElementById('notes-no-selection').style.display = 'flex';
    renderNotesList();
    updateMyNotesCount();
  } catch (err) { showToast('Failed to delete note', 'error'); }
}

async function archiveNote() {
  if (!activeNoteId) return;
  try {
    await api('PUT', `/api/notes/${activeNoteId}`, { archived: true });
    notesList = notesList.filter(n => n.id !== activeNoteId);
    activeNoteId = null;
    document.getElementById('notes-editor-panel').style.display = 'none';
    document.getElementById('notes-no-selection').style.display = 'flex';
    renderNotesList();
    loadArchivedNotes();
    updateMyNotesCount();
  } catch (err) { showToast('Failed to archive', 'error'); }
}

async function loadArchivedNotes() {
  try {
    let url = activeFolderId ? `/api/notes?folderId=${activeFolderId}&includeArchived=true` : '/api/notes?includeArchived=true';
    const allNotes = await api('GET', url);
    const archived = allNotes.filter(n => n.archived);
    const section = document.getElementById('notes-archived-section');
    const list = document.getElementById('notes-archived-list');
    const count = document.getElementById('notes-archived-count');
    if (archived.length > 0) {
      section.style.display = 'block';
      count.textContent = archived.length;
      list.innerHTML = archived.map(n => {
        const date = new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return `<button class="note-list-item" style="opacity:0.6;" data-archived-id="${n.id}">
          <div class="note-list-item-title">${escapeHtml(n.title || 'Untitled')}</div>
          <div class="note-list-item-date">${date} &middot; <span class="note-pin-btn" data-unarchive-id="${n.id}">Unarchive</span></div>
        </button>`;
      }).join('');
      list.querySelectorAll('[data-archived-id]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          if (e.target.closest('[data-unarchive-id]')) return;
          openNote(btn.dataset.archivedId);
        });
      });
      list.querySelectorAll('[data-unarchive-id]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api('PUT', `/api/notes/${btn.dataset.unarchiveId}`, { archived: false });
          loadNotesList(activeFolderId);
          loadArchivedNotes();
        });
      });
    } else {
      section.style.display = 'none';
    }
  } catch { document.getElementById('notes-archived-section').style.display = 'none'; }
}

async function createFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  try {
    const folder = await api('POST', '/api/folders', { name, order: folders.length });
    folders.push(folder);
    renderSidebarFolders();
  } catch (err) { showToast('Failed to create folder', 'error'); }
}

// === Note Files & Links ===
let currentNoteLinks = [];

function getFileIcon(name) {
  const ext = (name || '').split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📄';
  if (['doc', 'docx'].includes(ext)) return '📝';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
  if (['ppt', 'pptx'].includes(ext)) return '📑';
  if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi'].includes(ext)) return '🎬';
  if (['zip', 'rar'].includes(ext)) return '📦';
  return '📎';
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function renderNoteLinks(canEdit) {
  const list = document.getElementById('note-links-list');
  if (currentNoteLinks.length === 0) {
    list.innerHTML = '';
    return;
  }
  list.innerHTML = currentNoteLinks.map((l, i) => {
    const isFile = l.type === 'file';
    const icon = isFile ? getFileIcon(l.name) : '🔗';
    const sizeLabel = isFile && l.size ? ` · ${formatFileSize(l.size)}` : '';
    const hasGcs = isFile && l.gcsPath;
    const href = hasGcs ? '#' : escapeHtml(l.url || '');
    const clickHandler = hasGcs ? `onclick="downloadFile('${escapeHtml(l.gcsPath)}');return false;"` : '';
    return `<div class="note-link-item">
      <a href="${href}" ${hasGcs ? '' : 'target="_blank" rel="noopener"'} ${clickHandler}>${icon} ${escapeHtml(l.name || l.url || l.gcsPath)}<span style="color:var(--color-text-light);font-size:0.7rem;">${sizeLabel}</span></a>
      ${canEdit ? `<button class="note-link-remove" data-link-idx="${i}">&times;</button>` : ''}
    </div>`;
  }).join('');

  if (canEdit) {
    list.querySelectorAll('.note-link-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        currentNoteLinks.splice(parseInt(btn.dataset.linkIdx), 1);
        renderNoteLinks(true);
        await saveNoteLinks();
      });
    });
  }
}

async function uploadNoteFile(files) {
  const status = document.getElementById('note-upload-status');
  for (const file of files) {
    status.style.display = 'block';
    status.textContent = `Uploading ${file.name}...`;
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${authToken}` },
        body: formData
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Upload failed');
      const result = await res.json();
      currentNoteLinks.push({
        type: 'file', name: result.name, gcsPath: result.gcsPath, size: result.size
      });
    } catch (err) {
      showToast('Upload failed', 'error');
    }
  }
  status.style.display = 'none';
  renderNoteLinks(true);
  await saveNoteLinks();
}

async function downloadFile(gcsPath) {
  // Open the tab synchronously within the user gesture so mobile browsers
  // (iOS Safari especially) don't block it while we fetch the signed URL.
  const newWindow = window.open('', '_blank');
  try {
    const result = await api('GET', `/api/file-url?path=${encodeURIComponent(gcsPath)}`);
    if (newWindow && !newWindow.closed) {
      newWindow.location.href = result.url;
    } else {
      // Popup blocked — fall back to navigating the current window
      window.location.href = result.url;
    }
  } catch (err) {
    if (newWindow && !newWindow.closed) newWindow.close();
    showToast('Failed to get download link', 'error');
  }
}

async function addNoteLink() {
  const name = document.getElementById('note-link-name').value.trim();
  const url = document.getElementById('note-link-url').value.trim();
  if (!url) return;
  currentNoteLinks.push({ type: 'link', name: name || url, url });
  document.getElementById('note-link-name').value = '';
  document.getElementById('note-link-url').value = '';
  document.getElementById('note-links-input').style.display = 'none';
  renderNoteLinks(true);
  await saveNoteLinks();
}

async function saveNoteLinks() {
  if (!activeNoteId) return;
  try {
    await api('PUT', `/api/notes/${activeNoteId}`, { links: currentNoteLinks });
  } catch (err) { console.error('Failed to save links:', err); }
}

// === Note Sharing ===
let currentNoteSharedWith = [];

async function openShareModal() {
  if (!activeNoteId) return;

  // Get current note's sharedWith
  const note = await api('GET', `/api/notes/${activeNoteId}`);
  currentNoteSharedWith = note.sharedWith || [];

  // Build people checkboxes
  const peopleContainer = document.getElementById('share-people-list');
  if (teamMembers.length === 0 && myProfile && myProfile.role === 'cmo') {
    await loadTeam();
  }
  const otherMembers = teamMembers.filter(m => m.userId !== (myProfile && myProfile.userId) && m.status === 'active');
  peopleContainer.innerHTML = otherMembers.map(m => `
    <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.85rem; text-transform: none; font-weight: 400; color: var(--color-text);">
      <input type="checkbox" class="share-person-cb" value="${m.userId}" ${currentNoteSharedWith.includes(m.userId) ? 'checked' : ''}>
      ${escapeHtml(m.displayName)} <span style="color: var(--color-text-muted); font-size: 0.75rem;">(${m.department})</span>
    </label>
  `).join('') || '<p style="font-size: 0.8rem; color: var(--color-text-muted);">No team members yet</p>';

  // Build department checkboxes
  const deptContainer = document.getElementById('share-dept-list');
  deptContainer.innerHTML = DEPARTMENTS.map(d => `
    <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.85rem; text-transform: none; font-weight: 400; color: var(--color-text);">
      <input type="checkbox" class="share-dept-cb" value="dept:${d}" ${currentNoteSharedWith.includes('dept:' + d) ? 'checked' : ''}>
      ${d}
    </label>
  `).join('');

  // My reports checkbox
  const reportsKey = 'reports:' + (myProfile ? myProfile.userId : '');
  const myReportsCb = document.getElementById('share-my-reports');
  if (myReportsCb) myReportsCb.checked = currentNoteSharedWith.includes(reportsKey);

  // All team checkbox
  document.getElementById('share-all-team').checked = currentNoteSharedWith.includes('all');

  // Allow editing checkbox
  document.getElementById('share-allow-editing').checked = note.allowEditing || false;

  openModal('modal-share-note');
}

async function saveSharing() {
  const sharedWith = [];

  // Collect checked people
  document.querySelectorAll('.share-person-cb:checked').forEach(cb => sharedWith.push(cb.value));

  // Collect checked departments
  document.querySelectorAll('.share-dept-cb:checked').forEach(cb => sharedWith.push(cb.value));

  // My direct reports
  const myReportsCb = document.getElementById('share-my-reports');
  if (myReportsCb && myReportsCb.checked && myProfile) sharedWith.push('reports:' + myProfile.userId);

  // All team
  if (document.getElementById('share-all-team').checked) sharedWith.push('all');

  const allowEditing = document.getElementById('share-allow-editing').checked;
  try {
    await api('PUT', `/api/notes/${activeNoteId}`, { sharedWith, allowEditing });
    closeModal('modal-share-note');
    const count = sharedWith.length;
    showToast(count > 0 ? `Note shared with ${count} ${count === 1 ? 'recipient' : 'recipients'}${allowEditing ? ' (editing enabled)' : ''}.` : 'Note is now private.');
  } catch (err) {
    showToast('Failed to save sharing', 'error');
  }
}


// === AI Features ===
// Note AI Chat
let noteAiHistory = [];

function showAiPanel(title, content) {
  const panel = document.getElementById('ai-panel');
  document.getElementById('ai-panel-title').textContent = title;
  document.getElementById('ai-panel-content').innerHTML = content;
  panel.style.display = 'block';
}

function hideAiPanel() {
  document.getElementById('ai-panel').style.display = 'none';
}

function toggleNoteAi() {
  const panel = document.getElementById('note-ai-panel');
  const isOpen = panel.style.display === 'flex';
  if (isOpen) {
    panel.style.display = 'none';
  } else {
    panel.style.display = 'flex';
    noteAiHistory = [];
    document.getElementById('note-ai-messages').innerHTML = '';
    document.getElementById('note-ai-input').focus();
  }
}

function addNoteAiMessage(role, text) {
  const container = document.getElementById('note-ai-messages');
  const div = document.createElement('div');
  div.style.cssText = role === 'user'
    ? 'text-align:right;margin-bottom:0.5rem;'
    : 'background:#fff;border:1px solid var(--color-border);border-radius:var(--radius);padding:0.5rem 0.625rem;margin-bottom:0.5rem;';
  div.innerHTML = role === 'user'
    ? `<span style="background:var(--follett-dark-blue);color:#fff;padding:0.3rem 0.625rem;border-radius:var(--radius);display:inline-block;font-size:0.8rem;">${escapeHtml(text)}</span>`
    : renderMarkdown(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendNoteAiMessage(messageOverride) {
  if (!activeNoteId) { showToast('Please select a note first', 'error'); return; }
  const input = document.getElementById('note-ai-input');
  const message = messageOverride || input.value.trim();
  if (!message) return;
  input.value = '';

  addNoteAiMessage('user', message);
  const loadingDiv = addNoteAiMessage('ai', 'Thinking...');
  loadingDiv.style.color = 'var(--color-text-muted)';
  loadingDiv.style.fontStyle = 'italic';

  noteAiHistory.push({ role: 'user', text: message });

  try {
    const result = await api('POST', `/api/notes/${activeNoteId}/ask`, {
      question: message,
      history: noteAiHistory.slice(-10)
    });
    loadingDiv.style.color = '';
    loadingDiv.style.fontStyle = '';
    loadingDiv.innerHTML = renderMarkdown(result.answer);
    noteAiHistory.push({ role: 'model', text: result.answer });
  } catch (err) {
    loadingDiv.innerHTML = `<span style="color:var(--follett-coral);">Error: ${escapeHtml(err.message)}</span>`;
  }
}

let pendingAiTasks = [];

let pendingAiGroups = [];

async function aiGenerateTasks() {
  if (!activeNoteId) return;
  showAiPanel('Generate Tasks', '<span class="ai-loading">Analyzing note and extracting tasks...</span>');
  try {
    const result = await api('POST', `/api/notes/${activeNoteId}/generate-tasks`);
    hideAiPanel();
    pendingAiGroups = result.groups || [];
    if (pendingAiGroups.length === 0) {
      showToast('No actionable tasks found in this note');
      return;
    }

    const deptOptions = DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
    const prioOptions = ['High', 'Medium', 'Low'].map(p => `<option value="${p}">${p}</option>`).join('');
    const aiMyId = myProfile ? myProfile.userId : '';
    const assignOptions = '<option value="">Me</option>' + teamMembers.filter(m => (m.status === 'active' || !m.status) && m.userId !== aiMyId).map(m =>
      `<option value="${m.userId}">${escapeHtml(m.displayName)}</option>`
    ).join('');

    const inputStyle = 'padding:0.3rem 0.5rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.8rem;';
    const selectStyle = 'padding:0.2rem 0.4rem;font-size:0.75rem;border-radius:var(--radius);border:1px solid var(--color-border);';

    const list = document.getElementById('ai-tasks-list');
    list.innerHTML = pendingAiGroups.map((g, gi) => {
      const p = g.parent;
      const parentHtml = `
        <div style="border:1px solid var(--color-border);border-radius:var(--radius-lg);padding:0.75rem;margin-bottom:0.75rem;background:var(--color-surface);">
          <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
            <input type="checkbox" checked class="ai-parent-cb" data-group="${gi}" style="flex-shrink:0;">
            <input type="text" class="ai-parent-title" data-group="${gi}" value="${escapeHtml(p.title)}" style="flex:1;${inputStyle}font-weight:500;">
          </div>
          <div style="display:flex;gap:0.375rem;flex-wrap:wrap;padding-left:1.5rem;margin-bottom:0.375rem;">
            <select class="ai-parent-dept" data-group="${gi}" style="${selectStyle}">${deptOptions.replace(`value="${p.department}"`, `value="${p.department}" selected`)}</select>
            <select class="ai-parent-prio" data-group="${gi}" style="${selectStyle}">${prioOptions.replace(`value="${p.priority}"`, `value="${p.priority}" selected`)}</select>
            <select class="ai-parent-assign" data-group="${gi}" style="${selectStyle}">${p.assignedTo ? assignOptions.replace(`value="${p.assignedTo}"`, `value="${p.assignedTo}" selected`) : assignOptions}</select>
            <input type="date" class="ai-parent-due" data-group="${gi}" style="${selectStyle}">
          </div>
          ${p.notes ? `<div style="padding-left:1.5rem;font-size:0.7rem;color:var(--color-text-muted);margin-bottom:0.5rem;">${escapeHtml(p.notes)}</div>` : ''}
          ${(g.subtasks && g.subtasks.length > 0) ? `
            <div style="padding-left:1.5rem;border-top:1px solid var(--color-border);padding-top:0.5rem;">
              <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;color:var(--follett-dark-blue);margin-bottom:0.375rem;">Sub-tasks</div>
              ${g.subtasks.map((s, si) => `
                <div style="display:flex;align-items:center;gap:0.5rem;padding:0.25rem 0;">
                  <input type="checkbox" checked class="ai-sub-cb" data-group="${gi}" data-sub="${si}" style="flex-shrink:0;">
                  <input type="text" class="ai-sub-title" data-group="${gi}" data-sub="${si}" value="${escapeHtml(s.title)}" style="flex:1;${inputStyle}font-size:0.8rem;">
                  <select class="ai-sub-assign" data-group="${gi}" data-sub="${si}" style="${selectStyle}">${s.assignedTo ? assignOptions.replace(`value="${s.assignedTo}"`, `value="${s.assignedTo}" selected`) : assignOptions}</select>
                  <input type="date" class="ai-sub-due" data-group="${gi}" data-sub="${si}" style="${selectStyle}width:auto;">
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>`;
      return parentHtml;
    }).join('');
    openModal('modal-ai-tasks');
  } catch (err) {
    showAiPanel('Error', err.message);
  }
}

async function createAiTasks() {
  let totalCreated = 0;

  try {
    for (let gi = 0; gi < pendingAiGroups.length; gi++) {
      const parentCb = document.querySelector(`.ai-parent-cb[data-group="${gi}"]`);
      if (!parentCb || !parentCb.checked) continue;

      const title = document.querySelector(`.ai-parent-title[data-group="${gi}"]`).value.trim();
      const department = document.querySelector(`.ai-parent-dept[data-group="${gi}"]`).value;
      const priority = document.querySelector(`.ai-parent-prio[data-group="${gi}"]`).value;
      const assignedTo = document.querySelector(`.ai-parent-assign[data-group="${gi}"]`).value || undefined;
      const dueDate = document.querySelector(`.ai-parent-due[data-group="${gi}"]`).value || '';
      if (!title) continue;

      const isDelegate = assignedTo && myProfile && assignedTo !== myProfile.userId;

      // Create parent task
      const parentTask = await api('POST', '/api/tasks', {
        title, department, priority, dueDate,
        notes: pendingAiGroups[gi].parent.notes || '',
        tags: pendingAiGroups[gi].parent.tags || [],
        status: isDelegate ? 'Delegated' : 'Not Started',
        source: 'manual', recurring: 'none',
        assignedTo: assignedTo || undefined
      });
      totalCreated++;

      // Create sub-tasks
      const subtasks = pendingAiGroups[gi].subtasks || [];
      for (let si = 0; si < subtasks.length; si++) {
        const subCb = document.querySelector(`.ai-sub-cb[data-group="${gi}"][data-sub="${si}"]`);
        if (!subCb || !subCb.checked) continue;

        const subTitle = document.querySelector(`.ai-sub-title[data-group="${gi}"][data-sub="${si}"]`).value.trim();
        const subAssign = document.querySelector(`.ai-sub-assign[data-group="${gi}"][data-sub="${si}"]`).value || undefined;
        const subDue = document.querySelector(`.ai-sub-due[data-group="${gi}"][data-sub="${si}"]`).value || '';
        if (!subTitle) continue;

        const subDelegate = subAssign && myProfile && subAssign !== myProfile.userId;
        await api('POST', '/api/tasks', {
          title: subTitle, department, priority: 'Medium', dueDate: subDue,
          notes: '', status: subDelegate ? 'Delegated' : 'Not Started',
          source: 'manual', recurring: 'none',
          parentTaskId: parentTask.id,
          assignedTo: subAssign || undefined
        });
        totalCreated++;
      }
    }

    closeModal('modal-ai-tasks');
    await loadTasks();
    render();
    showToast(`Created ${totalCreated} task${totalCreated !== 1 ? 's' : ''}!`);
  } catch (err) {
    showToast('Failed to create tasks', 'error');
  }
}

// === Search ===
let searchTimeout = null;
let lastSearchResults = { tasks: [], notes: [] };

function handleSearch() {
  const q = document.getElementById('global-search').value.trim();
  if (searchTimeout) clearTimeout(searchTimeout);

  if (q.length < 2) {
    if (currentView === 'search') switchView('tasks');
    return;
  }

  searchTimeout = setTimeout(async () => {
    switchView('search');
    document.getElementById('search-query-label').textContent = `Showing results for "${q}"`;
    try {
      lastSearchResults = await api('GET', `/api/search?q=${encodeURIComponent(q)}`);
      renderSearchResults();
    } catch (err) {
      console.error('Search failed:', err);
    }
  }, 300);
}

function getDateCutoff(period) {
  const now = new Date();
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString(); }
  if (period === 'month') { const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString(); }
  if (period === 'quarter') { const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString(); }
  return '';
}

function renderSearchResults() {
  const typeFilter = document.getElementById('search-filter-type').value;
  const statusFilter = document.getElementById('search-filter-status').value;
  const deptFilter = document.getElementById('search-filter-dept').value;
  const dateFilter = document.getElementById('search-filter-date').value;
  const dateCutoff = getDateCutoff(dateFilter);

  const tasksContainer = document.getElementById('search-results-tasks');
  const notesContainer = document.getElementById('search-results-notes');
  const noResults = document.getElementById('search-no-results');

  // Filter tasks
  let filteredTasks = typeFilter === 'notes' ? [] : lastSearchResults.tasks.filter(t => {
    if (statusFilter !== 'all' && t.status !== statusFilter) return false;
    if (deptFilter !== 'all' && t.department !== deptFilter && (t.subDepartment || '') !== deptFilter) return false;
    if (dateCutoff && t.createdAt < dateCutoff) return false;
    return true;
  });

  // Filter notes
  let filteredNotes = typeFilter === 'tasks' ? [] : lastSearchResults.notes.filter(n => {
    if (deptFilter !== 'all' && n.folderName !== deptFilter) return false;
    if (dateCutoff && n.updatedAt < dateCutoff) return false;
    return true;
  });

  if (filteredTasks.length === 0 && filteredNotes.length === 0) {
    tasksContainer.innerHTML = '';
    notesContainer.innerHTML = '';
    noResults.style.display = 'block';
    return;
  }

  noResults.style.display = 'none';

  if (filteredTasks.length > 0) {
    tasksContainer.innerHTML = `<div class="search-section-title">Tasks (${filteredTasks.length})</div>` +
      filteredTasks.map(t => {
        const dueLine = t.dueDate ? ` · Due ${t.dueDate}` : '';
        return `<div class="search-result-item search-task" data-search-task-id="${t.id}">
          <div class="search-result-title">${escapeHtml(t.title)}</div>
          <div class="search-result-meta">${t.department} · ${t.status} · ${t.priority}${dueLine}</div>
        </div>`;
      }).join('');

    tasksContainer.querySelectorAll('[data-search-task-id]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('global-search').value = '';
        switchView('tasks');
        showTaskDetail(el.dataset.searchTaskId);
      });
    });
  } else {
    tasksContainer.innerHTML = '';
  }

  if (filteredNotes.length > 0) {
    notesContainer.innerHTML = `<div class="search-section-title">Notes (${filteredNotes.length})</div>` +
      filteredNotes.map(n => `
        <div class="search-result-item search-note" data-search-note-id="${n.id}" data-search-note-folder="${n.folderId}">
          <div class="search-result-title">${escapeHtml(n.title || 'Untitled')}</div>
          <div class="search-result-meta">${n.folderName} · ${n.authorName}</div>
          ${n.contentPreview ? `<div class="search-result-preview">${escapeHtml(n.contentPreview)}</div>` : ''}
        </div>
      `).join('');

    notesContainer.querySelectorAll('[data-search-note-id]').forEach(el => {
      el.addEventListener('click', () => {
        document.getElementById('global-search').value = '';
        activeFolderId = el.dataset.searchNoteFolder;
        switchView('notes');
        openNote(el.dataset.searchNoteId);
      });
    });
  } else {
    notesContainer.innerHTML = '';
  }
}

// === Global AI Chat (full-screen view) ===
let chatHistory = [];
let chatStarted = false;

function openAiView() {
  switchView('ai');
  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

function addChatMessage(role, text) {
  // Hide welcome screen on first message
  if (!chatStarted) {
    chatStarted = true;
    document.getElementById('ai-welcome').style.display = 'none';
    document.getElementById('ai-messages').style.display = 'flex';
  }

  const container = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role === 'user' ? 'ai-msg-user' : 'ai-msg-ai'}`;
  div.innerHTML = role === 'user' ? escapeHtml(text) : renderMarkdown(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendChatMessage(messageOverride) {
  const input = document.getElementById('chat-input');
  const message = messageOverride || input.value.trim();
  if (!message) return;

  input.value = '';
  addChatMessage('user', message);
  const loadingDiv = addChatMessage('ai', 'Thinking...');
  loadingDiv.classList.add('loading');

  chatHistory.push({ role: 'user', text: message });

  try {
    const result = await api('POST', '/api/ai/chat', {
      message,
      history: chatHistory.slice(-10)
    });
    loadingDiv.classList.remove('loading');
    loadingDiv.innerHTML = renderMarkdown(result.reply);
    chatHistory.push({ role: 'model', text: result.reply });
  } catch (err) {
    loadingDiv.classList.remove('loading');
    loadingDiv.textContent = 'Error: ' + err.message;
  }
}

// === Event Binding ===
async function init() {
  await loadTasks();
  await loadTeam();
  await loadWorkspaces();
  await loadTemplates();
  await loadFolders();
  await migrateLocalStorage();
  setTaskViewMode(taskViewMode);
  render();
  updateMyNotesCount(); // async, non-blocking

  // Workspace listeners
  document.getElementById('btn-add-workspace').addEventListener('click', () => showCreateWorkspaceModal());
  document.getElementById('btn-close-workspace').addEventListener('click', closeWorkspace);
  document.getElementById('btn-edit-workspace').addEventListener('click', () => showCreateWorkspaceModal(activeWorkspaceId));
  document.getElementById('form-workspace').addEventListener('submit', submitWorkspace);

  // Calendar view toggle
  document.getElementById('btn-view-list').addEventListener('click', () => setTaskViewMode('list'));
  document.getElementById('btn-view-kanban').addEventListener('click', () => setTaskViewMode('kanban'));
  document.getElementById('btn-view-calendar').addEventListener('click', () => setTaskViewMode('calendar'));
  document.getElementById('btn-cal-prev').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() - 1);
    renderCalendar();
  });
  document.getElementById('btn-cal-next').addEventListener('click', () => {
    calendarDate.setMonth(calendarDate.getMonth() + 1);
    renderCalendar();
  });
  document.getElementById('btn-cal-today').addEventListener('click', () => {
    calendarDate = new Date();
    renderCalendar();
  });

  // Add Task button
  document.getElementById('btn-add-task').addEventListener('click', () => {
    resetAddForm();
    openModal('modal-add');
  });

  // Quick Add (AI-powered)
  let lastParsedResult = null;
  document.getElementById('btn-quick-import').addEventListener('click', () => {
    lastParsedResult = null;
    document.getElementById('import-paste').value = '';
    document.getElementById('ai-parsed-task').style.display = 'none';
    // Populate assign-to dropdown
    const assignSelect = document.getElementById('parsed-assign');
    assignSelect.innerHTML = '<option value="">Me</option>' +
      teamMembers.filter(m => m.status === 'active' || !m.status).map(m =>
        `<option value="${m.userId}">${escapeHtml(m.displayName)}</option>`
      ).join('');
    openModal('modal-import');
  });

  // AI parse button
  document.getElementById('btn-ai-parse-task').addEventListener('click', async () => {
    const text = document.getElementById('import-paste').value.trim();
    if (!text) return;
    const btn = document.getElementById('btn-ai-parse-task');
    btn.textContent = '⏳ Parsing...';
    btn.disabled = true;
    try {
      const parsed = await api('POST', '/api/ai/quick-add', { text });
      lastParsedResult = parsed;
      document.getElementById('parsed-title').value = parsed.title || text;
      document.getElementById('parsed-dept').value = parsed.department || 'Personal';
      document.getElementById('parsed-priority').value = parsed.priority || 'Medium';
      document.getElementById('parsed-start-date').value = parsed.startDate || '';
      document.getElementById('parsed-due').value = parsed.dueDate || '';
      document.getElementById('parsed-recurring').value = parsed.recurring || 'none';
      document.getElementById('parsed-notes').value = parsed.notes || '';
      if (parsed.assignedTo) document.getElementById('parsed-assign').value = parsed.assignedTo;
      document.getElementById('ai-parsed-task').style.display = 'block';
    } catch (err) {
      showToast('AI parsing failed', 'error');
    }
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px;"><path d="M12 0l1.8 7.6L22 8l-6.4 4.2L18 20l-6-4.8L6 20l2.4-7.8L2 8l8.2-.4z"/></svg> Create Task';
    btn.disabled = false;
  });

  // Create parsed task button
  document.getElementById('btn-create-parsed-task').addEventListener('click', async () => {
    const title = document.getElementById('parsed-title').value.trim();
    if (!title) return;
    const dept = document.getElementById('parsed-dept').value;
    const priority = document.getElementById('parsed-priority').value;
    const startDate = document.getElementById('parsed-start-date').value;
    const dueDate = document.getElementById('parsed-due').value;
    const recurring = document.getElementById('parsed-recurring').value;
    const assignedTo = document.getElementById('parsed-assign').value || undefined;
    const notes = document.getElementById('parsed-notes').value.trim();

    const parsedTags = lastParsedResult && lastParsedResult.tags ? lastParsedResult.tags : [];
    await addTask(title, dept, priority, notes, 'manual', [], dueDate, recurring, assignedTo, parsedTags, startDate);
    closeModal('modal-import');
  });

  // Sync Email / Connect Gmail button
  document.getElementById('btn-sync-email').addEventListener('click', handleSyncClick);
  checkGmailStatus();

  // (Old import form handlers removed — replaced by AI Quick Add above)

  // Add/Edit task form submit
  document.getElementById('form-add-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = document.getElementById('btn-submit-task');
    submitBtn.disabled = true;
    const title = document.getElementById('input-title').value.trim();
    const department = document.getElementById('input-department').value;
    const priority = document.getElementById('input-priority').value;
    const notes = document.getElementById('input-notes').value.trim();
    const startDate = document.getElementById('input-start-date').value;
    const dueDate = document.getElementById('input-due-date').value;
    const recurring = document.getElementById('input-recurring').value;
    const assignTo = document.getElementById('input-assign-to').value || undefined;
    const wsSelect = document.getElementById('input-workspace');
    const selectedWorkspaceId = wsSelect ? wsSelect.value : '';

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];

    if (editingTaskId) {
      const updates = { title, department, priority, notes, startDate, dueDate, recurring, attachments: allAttachments, tags: currentTaskTags, workspaceId: selectedWorkspaceId };
      if (assignTo) {
        const existingTask = tasks.find(t => t.id === editingTaskId);
        const assigneeChanged = existingTask && assignTo !== existingTask.assignedTo;
        updates.assignedTo = assignTo;
        // Only change status to Delegated if assignee actually changed to someone else
        if (assigneeChanged && myProfile && assignTo !== myProfile.userId) {
          updates.status = 'Delegated';
        }
      }
      try {
        await api('PUT', `/api/tasks/${editingTaskId}`, updates);
        const task = tasks.find(t => t.id === editingTaskId);
        if (task) Object.assign(task, updates);
        render();
      } catch (err) {
        showToast('Failed to update task', 'error');
      }
    } else {
      const prevWsId = activeWorkspaceId;
      activeWorkspaceId = selectedWorkspaceId || null;
      await addTask(title, department, priority, notes, 'manual', allAttachments, dueDate, recurring, assignTo, currentTaskTags, startDate);
      activeWorkspaceId = prevWsId;
    }

    closeModal('modal-add');
    resetAddForm();
    submitBtn.disabled = false;
  });

  // Close modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Global delegated click handler for dynamically rendered links
  // (iOS Safari doesn't always fire inline onclick on dynamic innerHTML)
  document.addEventListener('click', (e) => {
    // File download links (task attachments, AI file links, anywhere with data-gcs-path)
    const fileDownload = e.target.closest('.file-download-link[data-gcs-path], .ai-link-file[data-gcs-path]');
    if (fileDownload) {
      e.preventDefault();
      downloadFile(fileDownload.dataset.gcsPath);
      return;
    }
    // AI task/note links
    const aiLink = e.target.closest('.ai-link-task');
    if (aiLink) { e.preventDefault(); showTaskDetail(aiLink.dataset.taskId); return; }
    const noteLink = e.target.closest('.ai-link-note');
    if (noteLink) { e.preventDefault(); switchView('notes'); openNote(noteLink.dataset.noteId); return; }
    // External URL links — fallback in case native target="_blank" doesn't work
    const extLink = e.target.closest('a.external-link, a.inline-link');
    if (extLink && extLink.href && !extLink.href.endsWith('#')) {
      e.preventDefault();
      window.open(extLink.href, '_blank', 'noopener');
      return;
    }
    // Search result clicks
    const searchTask = e.target.closest('[data-search-task-id]');
    if (searchTask) { document.getElementById('global-search').value = ''; switchView('tasks'); showTaskDetail(searchTask.dataset.searchTaskId); return; }
    const searchNote = e.target.closest('[data-search-note-id]');
    if (searchNote) { document.getElementById('global-search').value = ''; switchView('notes'); openNote(searchNote.dataset.searchNoteId); return; }
  });

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (overlay.style.display !== 'none') closeModal(overlay.id);
      });
    }
  });

  // Filters
  document.getElementById('filter-department').addEventListener('change', applyFilters);
  document.getElementById('filter-priority').addEventListener('change', applyFilters);
  document.getElementById('filter-sort').addEventListener('change', applyFilters);
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // Global "My Tasks" button
  document.getElementById('btn-my-tasks-global').addEventListener('click', () => {
    globalMyTasksView = true;
    globalMyNotesView = false;
    activeWorkspaceNotesView = false;
    showMyTasksOnly = true;
    showMyTeam = false;
    // Clear workspace context
    if (typeof activeWorkspaceId !== 'undefined' && activeWorkspaceId) {
      activeWorkspaceId = null;
      activeWorkspaceName = '';
      const wsHeader = document.getElementById('workspace-header');
      if (wsHeader) wsHeader.style.display = 'none';
      if (typeof renderSidebarWorkspaces === 'function') renderSidebarWorkspaces();
    }
    // Clear filters
    filters.statFilter = 'none';
    document.querySelectorAll('.stat-pill-clickable').forEach(p => p.classList.remove('active'));
    if (typeof activeTaskTagFilter !== 'undefined') activeTaskTagFilter = '';
    document.getElementById('filter-department').value = 'all';
    document.getElementById('btn-my-tasks').classList.add('active');
    document.getElementById('btn-my-team').classList.remove('active');
    document.getElementById('btn-all-tasks').classList.remove('active');
    loadTasks().then(render);
    switchView('tasks');
    closeSidebar();
  });

  // Global "My Notes" button
  document.getElementById('btn-my-notes-global').addEventListener('click', async () => {
    globalMyNotesView = true;
    globalMyTasksView = false;
    activeWorkspaceNotesView = false;
    showMyNotesOnly = true;
    // Sync the All/Mine toggle in notes view
    document.getElementById('btn-my-notes').classList.add('active');
    document.getElementById('btn-all-notes').classList.remove('active');
    // Clear workspace context
    if (typeof activeWorkspaceId !== 'undefined' && activeWorkspaceId) {
      activeWorkspaceId = null;
      activeWorkspaceName = '';
      const wsHeader = document.getElementById('workspace-header');
      if (wsHeader) wsHeader.style.display = 'none';
      if (typeof renderSidebarWorkspaces === 'function') renderSidebarWorkspaces();
    }
    switchView('notes');
    if (!folders || folders.length === 0) {
      await loadFolders();
    }
    // Show all my notes (no folder filter)
    activeFolderId = null;
    loadNotesList(null);
    document.getElementById('notes-folder-title').textContent = 'My Notes';
    closeSidebar();
  });

  // Sidebar navigation for non-global items (AI, Ideas, etc.)
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    if (item.id === 'btn-my-tasks-global' || item.id === 'btn-my-notes-global') return; // handled above
    item.addEventListener('click', async () => {
      const view = item.dataset.view;
      if (view === 'notes') {
        // Redirect to global My Notes view
        globalMyNotesView = true;
        globalMyTasksView = false;
        showMyNotesOnly = true;
        switchView('notes');
        if (!folders || folders.length === 0) {
          await loadFolders();
        }
        activeFolderId = null;
        loadNotesList(null);
        document.getElementById('notes-folder-title').textContent = 'My Notes';
      } else if (view) {
        switchView(view);
      }
      closeSidebar();
    });
  });

  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Notes event listeners
  document.getElementById('btn-new-note').addEventListener('click', createNote);
  document.getElementById('btn-import-meeting').addEventListener('click', showImportMeetingModal);
  document.getElementById('btn-submit-meeting-import').addEventListener('click', submitMeetingImport);
  document.getElementById('btn-notes-back').addEventListener('click', () => {
    document.getElementById('view-notes').classList.remove('note-open');
    document.getElementById('notes-editor-panel').style.display = 'none';
    document.getElementById('notes-no-selection').style.display = 'flex';
  });
  initNoteTagInput();
  initTaskTagInput();

  // My Notes / All Notes toggle
  document.getElementById('btn-my-notes').addEventListener('click', () => {
    showMyNotesOnly = true;
    document.getElementById('btn-my-notes').classList.add('active');
    document.getElementById('btn-all-notes').classList.remove('active');
    if (activeWorkspaceNotesView && activeWorkspaceId) {
      loadWorkspaceNotes(activeWorkspaceId);
    } else {
      loadNotesList(activeFolderId, true);
    }
  });
  document.getElementById('btn-all-notes').addEventListener('click', () => {
    showMyNotesOnly = false;
    document.getElementById('btn-all-notes').classList.add('active');
    document.getElementById('btn-my-notes').classList.remove('active');
    if (activeWorkspaceNotesView && activeWorkspaceId) {
      loadWorkspaceNotes(activeWorkspaceId);
    } else {
      loadNotesList(activeFolderId, true);
    }
  });
  document.getElementById('btn-delete-note').addEventListener('click', deleteNote);
  document.getElementById('btn-archive-note').addEventListener('click', archiveNote);
  document.getElementById('btn-toggle-note-private').addEventListener('click', async () => {
    if (!activeNoteId) return;
    const btn = document.getElementById('btn-toggle-note-private');
    const isPrivate = btn.dataset.notePrivate !== 'true';
    try {
      await api('PUT', `/api/notes/${activeNoteId}`, { private: isPrivate });
      btn.dataset.notePrivate = isPrivate ? 'true' : 'false';
      btn.style.color = isPrivate ? 'var(--follett-coral)' : '';
      btn.title = isPrivate ? 'Private — click to make visible' : 'Click to make private';
      document.getElementById('editor-saved').textContent = isPrivate ? 'Private' : 'Saved';
    } catch (err) { showToast('Failed to update', 'error'); }
  });
  document.getElementById('notes-archived-toggle').addEventListener('click', () => {
    const list = document.getElementById('notes-archived-list');
    list.style.display = list.style.display === 'none' ? 'block' : 'none';
  });
  document.getElementById('btn-share-note').addEventListener('click', openShareModal);

  // Note links
  document.getElementById('btn-add-note-link').addEventListener('click', () => {
    document.getElementById('note-links-input').style.display = 'flex';
    document.getElementById('note-link-url').focus();
  });
  document.getElementById('btn-save-note-link').addEventListener('click', addNoteLink);
  document.getElementById('note-link-url').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNoteLink();
  });

  // File upload
  document.getElementById('btn-upload-note-file').addEventListener('click', () => {
    document.getElementById('note-file-input').click();
  });
  document.getElementById('note-file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) uploadNoteFile(e.target.files);
    e.target.value = '';
  });

  // Drag and drop on editor
  const editorContent = document.getElementById('editor-content');
  editorContent.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); });
  editorContent.addEventListener('drop', (e) => {
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      uploadNoteFile(e.dataTransfer.files);
    }
  });

  // Move note to different folder
  document.getElementById('note-folder-select').addEventListener('change', async (e) => {
    if (!activeNoteId) return;
    try {
      const newFolderId = e.target.value;
      await api('PUT', `/api/notes/${activeNoteId}`, { folderId: newFolderId });
      const folder = folders.find(f => f.id === newFolderId);
      document.getElementById('editor-saved').textContent = newFolderId ? 'Moved to ' + folder.name : 'Removed from department';
      const item = notesList.find(n => n.id === activeNoteId);
      if (item) item.folderId = newFolderId;
      // If viewing a specific folder, remove moved note from list
      if (activeFolderId && newFolderId !== activeFolderId) {
        notesList = notesList.filter(n => n.id !== activeNoteId);
        renderNotesList();
      }
    } catch (err) { showToast('Failed to move note', 'error'); }
  });

  // Move note to a workspace (or remove from workspace)
  document.getElementById('note-workspace-select').addEventListener('change', async (e) => {
    if (!activeNoteId) return;
    try {
      const newWsId = e.target.value;
      await api('PUT', `/api/notes/${activeNoteId}`, { workspaceId: newWsId });
      const ws = workspaces.find(w => w.id === newWsId);
      document.getElementById('editor-saved').textContent = newWsId ? 'Moved to ' + (ws ? ws.name : 'workspace') : 'Removed from workspace';
      const item = notesList.find(n => n.id === activeNoteId);
      if (item) item.workspaceId = newWsId;
      // If viewing a workspace, remove note from list when moved out
      if (activeWorkspaceNotesView && newWsId !== activeWorkspaceId) {
        notesList = notesList.filter(n => n.id !== activeNoteId);
        renderNotesList();
      }
    } catch (err) { showToast('Failed to move note', 'error'); }
  });

  document.getElementById('btn-save-share').addEventListener('click', saveSharing);
  document.getElementById('btn-add-folder').addEventListener('click', createFolder);
  document.getElementById('editor-title').addEventListener('input', scheduleAutoSave);
  document.getElementById('editor-content').addEventListener('input', scheduleAutoSave);

  // Make links clickable in editor — always navigate on click
  // (contentEditable normally swallows link clicks to place cursor)
  document.getElementById('editor-content').addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link || !link.href) return;
    e.preventDefault();
    window.open(link.href, '_blank', 'noopener');
  });

  // AI buttons
  // AI Chat (full-screen view)
  // Notifications
  // Search
  document.getElementById('global-search').addEventListener('input', handleSearch);
  document.getElementById('global-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { document.getElementById('global-search').value = ''; if (currentView === 'search') switchView('tasks'); }
  });
  ['search-filter-type', 'search-filter-status', 'search-filter-dept', 'search-filter-date'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderSearchResults);
  });

  document.getElementById('btn-notifications').addEventListener('click', () => { showNotifications(); closeSidebar(); });
  document.getElementById('btn-mark-all-read').addEventListener('click', async () => {
    try {
      await api('POST', '/api/notifications/read-all');
      await loadNotifications();
      renderNotifications();
    } catch (err) { showToast('Failed to mark all read', 'error'); }
  });
  document.getElementById('btn-notif-unread').addEventListener('click', () => {
    notifShowAll = false;
    renderNotifications();
  });
  document.getElementById('btn-notif-all').addEventListener('click', () => {
    notifShowAll = true;
    renderNotifications();
  });

  // Team (CMO only)
  document.getElementById('btn-invite-member') && document.getElementById('btn-invite-member').addEventListener('click', inviteMember);
  document.getElementById('btn-templates') && document.getElementById('btn-templates').addEventListener('click', showTemplatesModal);
  document.getElementById('btn-save-template') && document.getElementById('btn-save-template').addEventListener('click', saveTemplate);
  document.getElementById('form-invite') && document.getElementById('form-invite').addEventListener('submit', submitInvite);
  document.getElementById('btn-slack-settings') && document.getElementById('btn-slack-settings').addEventListener('click', openSlackSettings);
  document.getElementById('btn-ai-context') && document.getElementById('btn-ai-context').addEventListener('click', openAiContext);
  document.getElementById('btn-announce') && document.getElementById('btn-announce').addEventListener('click', sendAnnouncement);
  document.getElementById('btn-send-announce').addEventListener('click', async () => {
    const message = document.getElementById('announce-message').value.trim();
    if (!message) { showToast('Please type a message', 'error'); return; }
    const btn = document.getElementById('btn-send-announce');
    btn.disabled = true;
    btn.textContent = 'Sending...';
    try {
      const result = await api('POST', '/api/slack/announce', { message });
      closeModal('modal-announce');
      showToast(`Announcement sent! ${result.slackSent} Slack DMs + ${result.notifSent} in-app notifications.`);
    } catch (err) { showToast('Failed to send', 'error'); }
    btn.disabled = false;
    btn.textContent = 'Send to Team';
  });
  document.getElementById('btn-ai-context-save').addEventListener('click', saveAiContext);
  document.getElementById('btn-ai-context-generate').addEventListener('click', generateAiContext);
  document.querySelectorAll('[data-view="team"]').forEach(btn => {
    btn.addEventListener('click', () => { showTeamView(); closeSidebar(); });
  });

  // My Tasks / All Tasks toggle
  function setTaskToggle(mode) {
    globalMyTasksView = false; // Switching to dept-specific mode
    showMyTasksOnly = mode === 'mine';
    showMyTeam = mode === 'team';
    // Clear stale state that could cause empty views
    if (activeWorkspaceId) {
      activeWorkspaceId = null;
      activeWorkspaceName = '';
      document.getElementById('workspace-header').style.display = 'none';
      renderSidebarWorkspaces();
    }
    filters.statFilter = 'none';
    activeTaskTagFilter = '';
    document.querySelectorAll('.stat-pill-clickable').forEach(p => p.classList.remove('active'));
    document.getElementById('btn-my-tasks').classList.toggle('active', mode === 'mine');
    document.getElementById('btn-my-team').classList.toggle('active', mode === 'team');
    document.getElementById('btn-all-tasks').classList.toggle('active', mode === 'all');
    loadTasks().then(render);
  }
  document.getElementById('btn-my-tasks').addEventListener('click', () => setTaskToggle('mine'));
  document.getElementById('btn-my-team').addEventListener('click', () => setTaskToggle('team'));
  document.getElementById('btn-all-tasks').addEventListener('click', () => setTaskToggle('all'));

  // Department change updates sub-department dropdown
  // (Sub-department dropdown removed - replaced by tags)

  // Stat pill filters
  document.querySelectorAll('.stat-pill-clickable').forEach(pill => {
    pill.addEventListener('click', () => {
      const filter = pill.dataset.statFilter;
      filters.statFilter = filters.statFilter === filter ? 'none' : filter;
      document.querySelectorAll('.stat-pill-clickable').forEach(p => {
        p.classList.toggle('active', p.dataset.statFilter === filters.statFilter);
      });
      if (filters.statFilter === 'completed') {
        document.getElementById('completed-list').style.display = 'flex';
        document.getElementById('completed-toggle').textContent = 'Hide';
      }
      render();
    });
  });

  // AI Chat
  document.getElementById('btn-open-chat').addEventListener('click', () => { openAiView(); closeSidebar(); });
  // Feature requests
  document.getElementById('btn-feature-requests').addEventListener('click', () => {
    switchView('features');
    loadFeatureRequests();
    closeSidebar();
  });
  function openSuggestModal() {
    document.getElementById('suggest-text').value = '';
    document.getElementById('suggest-result').style.display = 'none';
    document.getElementById('btn-submit-suggestion').textContent = 'Submit';
    document.getElementById('btn-submit-suggestion').disabled = false;
    openModal('modal-suggest');
  }
  document.getElementById('btn-suggest-feature-inline').addEventListener('click', openSuggestModal);
  document.getElementById('btn-submit-suggestion').addEventListener('click', async () => {
    await submitSuggestion();
    loadFeatureRequests();
  });
  document.getElementById('btn-send-chat').addEventListener('click', () => sendChatMessage());
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
  // Suggestion button clicks
  document.querySelectorAll('.ai-suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendChatMessage(btn.dataset.q));
  });

  document.getElementById('btn-note-ai').addEventListener('click', toggleNoteAi);
  document.getElementById('btn-note-ai-send').addEventListener('click', () => sendNoteAiMessage());
  document.getElementById('note-ai-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); sendNoteAiMessage(); }
  });
  document.querySelectorAll('.note-ai-quick').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.dataset.prompt === 'generate-tasks') {
        aiGenerateTasks();
      } else {
        sendNoteAiMessage(btn.dataset.prompt);
      }
    });
  });
  document.getElementById('ai-panel-close').addEventListener('click', hideAiPanel);
  document.getElementById('btn-close-note-ai').addEventListener('click', () => {
    document.getElementById('note-ai-panel').style.display = 'none';
  });
  document.getElementById('btn-create-ai-tasks').addEventListener('click', createAiTasks);
  document.getElementById('btn-ai-tasks-select-all').addEventListener('click', () => {
    document.querySelectorAll('#ai-tasks-list input[type="checkbox"]').forEach(cb => cb.checked = true);
  });
  document.getElementById('btn-ai-tasks-deselect-all').addEventListener('click', () => {
    document.querySelectorAll('#ai-tasks-list input[type="checkbox"]').forEach(cb => cb.checked = false);
  });

  // Editor toolbar (execCommand for rich text)
  document.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.value || null;
      document.getElementById('editor-content').focus();
      document.execCommand(cmd, false, val);
      scheduleAutoSave();
    });
  });

  // Load folders for sidebar
  await loadFolders();

  // Load team members for Assign To dropdown (all users need this)
  await loadTeam();


  // Task list event delegation (for both active + completed lists)
  function handleTaskClick(e) {
    // Ignore clicks on the status select — let the browser handle it natively
    if (e.target.matches('select[data-action="status"]') || e.target.matches('select[data-action="status"] option')) {
      return;
    }

    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    switch (action) {
      case 'status':
        return; // Handled by change handler, not click
      case 'toggle-complete':
        const task = tasks.find(t => t.id === id);
        if (task) {
          setTaskStatus(id, task.status === 'Completed' ? 'Not Started' : 'Completed');
        }
        break;
      case 'detail':
        showTaskDetail(id);
        break;
      case 'delete':
        deleteConfirmId = id;
        render();
        break;
      case 'confirm-delete':
        deleteTask(id);
        break;
      case 'cancel-delete':
        deleteConfirmId = null;
        render();
        break;
    }
  }

  function handleTaskChange(e) {
    if (e.target.matches('select[data-action="status"]')) {
      setTaskStatus(e.target.dataset.id, e.target.value);
    }
  }

  document.getElementById('task-list').addEventListener('click', handleTaskClick);
  document.getElementById('task-list').addEventListener('change', handleTaskChange);
  document.getElementById('approved-list').addEventListener('click', handleTaskClick);
  document.getElementById('approved-list').addEventListener('change', handleTaskChange);
  document.getElementById('delegated-list').addEventListener('click', handleTaskClick);
  document.getElementById('delegated-list').addEventListener('change', handleTaskChange);
  document.getElementById('completed-list').addEventListener('click', handleTaskClick);
  document.getElementById('completed-list').addEventListener('change', handleTaskChange);

  // Completed period filter
  document.getElementById('completed-period').addEventListener('change', render);

  // File drag & drop
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // Remove pending attachment
  document.getElementById('attachment-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-attachment-idx]');
    if (btn) {
      pendingAttachments.splice(parseInt(btn.dataset.attachmentIdx), 1);
      renderPendingAttachments();
    }
  });

  // Add link
  document.getElementById('btn-add-link').addEventListener('click', () => {
    const name = document.getElementById('input-link-name').value.trim();
    const url = document.getElementById('input-link-url').value.trim();
    if (!url) return;
    pendingLinks.push({ type: 'link', name: name || url, url });
    document.getElementById('input-link-name').value = '';
    document.getElementById('input-link-url').value = '';
    renderPendingLinks();
  });

  // Remove pending link
  document.getElementById('link-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-link-idx]');
    if (btn) {
      pendingLinks.splice(parseInt(btn.dataset.linkIdx), 1);
      renderPendingLinks();
    }
  });

  // Initial render
  render();
}

// === Team, Notifications, My Tasks ===
let myProfile = null;
let showMyTasksOnly = true;
let showMyTeam = false;
let expandedDepts = new Set();
let globalMyTasksView = true;   // true = aggregated My Tasks (default landing)
let globalMyNotesView = false;  // true = aggregated My Notes view
let teamMembers = [];

function applyRoleUI() {
  if (!myProfile) return;
  const r = myProfile.role;
  document.getElementById('sidebar-team-section').style.display = (r === 'cmo' || r === 'lead') ? 'block' : 'none';
  document.getElementById('btn-sync-email').style.display = r === 'cmo' ? '' : 'none';
  document.getElementById('btn-slack-settings').style.display = r === 'cmo' ? '' : 'none';
  document.getElementById('btn-ai-context').style.display = r === 'cmo' ? '' : 'none';
  document.getElementById('btn-announce').style.display = r === 'cmo' ? '' : 'none';
  document.getElementById('btn-add-task').style.display = r === 'viewer' ? 'none' : '';
  document.getElementById('btn-quick-import').style.display = r === 'viewer' ? 'none' : '';
  document.getElementById('btn-new-note').style.display = r === 'viewer' ? 'none' : '';
}

async function loadProfile() {
  try {
    myProfile = await api('GET', '/api/me');
    applyRoleUI();
  } catch (err) { console.error('Failed to load profile:', err); }
}

// === What's New Popup ===
function showWhatsNewIfNeeded(uid) {
  const key = 'whatsNewSeen_features_v3_' + uid;
  if (localStorage.getItem(key)) return;
  const modal = document.getElementById('modal-whats-new');
  if (!modal) return;
  modal.style.display = 'flex';
  document.getElementById('btn-dismiss-whats-new').addEventListener('click', () => {
    localStorage.setItem(key, 'true');
    modal.style.display = 'none';
  });
  // Also dismiss on overlay click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      localStorage.setItem(key, 'true');
      modal.style.display = 'none';
    }
  });
}

// === Daily Briefing / Onboarding ===
async function showBriefingIfNeeded() {
  if (!myProfile) return;

  const overlay = document.getElementById('briefing-overlay');
  const content = document.getElementById('briefing-content');
  if (!overlay || !content) return;

  // First-time onboarding: show once ever
  const onboardingKey = `onboarding_complete_${currentUser.uid}`;
  if (!localStorage.getItem(onboardingKey)) {
    const firstName = (myProfile.name || myProfile.displayName || 'there').split(' ')[0];
    content.innerHTML = `
      <div class="briefing-greeting">Welcome to Follett Marketing, ${escapeHtml(firstName)}!</div>
      <p style="font-size:0.9rem;color:var(--color-text-muted);margin-bottom:1.25rem;">This is our home base for tracking work, sharing notes, and staying on top of priorities across the marketing team.</p>
      <div class="briefing-onboarding-step">
        <span class="briefing-step-num">1</span>
        <span class="briefing-step-text"><strong>Check your tasks</strong> &mdash; Your assigned tasks appear under Tasks in the sidebar. Use <em>My Tasks</em> to focus on what&rsquo;s yours.</span>
      </div>
      <div class="briefing-onboarding-step">
        <span class="briefing-step-num">2</span>
        <span class="briefing-step-text"><strong>Quick Add</strong> &mdash; Paste an email or Slack message and let AI turn it into a task instantly.</span>
      </div>
      <div class="briefing-onboarding-step">
        <span class="briefing-step-num">3</span>
        <span class="briefing-step-text"><strong>Read the Welcome note</strong> &mdash; Open <em>Strategy &amp; Notes</em> &rarr; <em>All Team</em> folder &rarr; <strong>Welcome</strong> for the full guide on features, statuses, and tips.</span>
      </div>
      <button class="briefing-dismiss" id="briefing-got-it">Got it, let&rsquo;s go!</button>
    `;
    overlay.style.display = 'flex';
    document.getElementById('briefing-got-it').onclick = () => {
      localStorage.setItem(onboardingKey, '1');
      overlay.style.display = 'none';
    };
    document.getElementById('briefing-close').onclick = () => {
      localStorage.setItem(onboardingKey, '1');
      overlay.style.display = 'none';
    };
    return;
  }

  // Daily briefing: show once per day
  const briefingKey = `briefing_last_shown_${currentUser.uid}`;
  const today = new Date().toISOString().split('T')[0];
  if (localStorage.getItem(briefingKey) === today) return;

  try {
    const b = await api('GET', '/api/briefing');
    const firstName = (b.name || 'there').split(' ')[0];
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

    let html = `<div class="briefing-greeting">${greeting}, ${escapeHtml(firstName)}!</div>`;
    html += `<div class="briefing-date">${dateStr}</div>`;

    // Stats row
    html += `<div class="briefing-stats">`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num">${b.dueToday.length}</div><div class="briefing-stat-label">Due Today</div></div>`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num" style="color:${b.overdue.length > 0 ? 'var(--follett-coral)' : ''}">${b.overdue.length}</div><div class="briefing-stat-label">Overdue</div></div>`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num">${b.completedCount}</div><div class="briefing-stat-label">Done This Week</div></div>`;
    html += `</div>`;

    // Due today
    if (b.dueToday.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Due Today</div>`;
      b.dueToday.forEach(t => {
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-due"></span> ${escapeHtml(t.title)}</div>`;
      });
      html += `</div>`;
    }

    // Overdue
    if (b.overdue.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Overdue</div>`;
      b.overdue.forEach(t => {
        const dueFmt = t.dueDate ? new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-overdue"></span> ${escapeHtml(t.title)}<span class="briefing-task-due">${dueFmt}</span></div>`;
      });
      html += `</div>`;
    }

    // Coming this week
    if (b.comingThisWeek.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Coming Up</div>`;
      b.comingThisWeek.forEach(t => {
        const dueFmt = t.dueDate ? new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : '';
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-upcoming"></span> ${escapeHtml(t.title)}<span class="briefing-task-due">${dueFmt}</span></div>`;
      });
      html += `</div>`;
    }

    // Empty state
    if (b.dueToday.length === 0 && b.overdue.length === 0 && b.comingThisWeek.length === 0) {
      html += `<div class="briefing-section"><p class="briefing-empty">No upcoming tasks — your schedule is clear!</p></div>`;
    }

    // CMO team stats
    if (b.teamOverdue && b.teamOverdue.length > 0) {
      html += `<div class="briefing-team-section">`;
      html += `<div class="briefing-section-title">Team Overview</div>`;
      html += `<div class="briefing-team-row"><span>Team completed this week</span><strong>${b.teamCompletedCount || 0}</strong></div>`;
      html += `<div class="briefing-section-title" style="margin-top:0.5rem;">Overdue by Person</div>`;
      b.teamOverdue.sort((a, c) => c.count - a.count).forEach(p => {
        html += `<div class="briefing-team-row"><span>${escapeHtml(p.name)}</span><span class="overdue-count">${p.count} overdue</span></div>`;
      });
      html += `</div>`;
    } else if (b.teamCompletedCount !== undefined) {
      html += `<div class="briefing-team-section">`;
      html += `<div class="briefing-section-title">Team Overview</div>`;
      html += `<div class="briefing-team-row"><span>Team completed this week</span><strong>${b.teamCompletedCount || 0}</strong></div>`;
      html += `<div class="briefing-team-row" style="color:var(--follett-sage);"><span>No overdue items across the team</span></div>`;
      html += `</div>`;
    }

    // Monday weekly digest
    if (b.weeklyDigest) {
      const wd = b.weeklyDigest;
      html += `<div class="briefing-team-section">`;
      html += `<div class="briefing-greeting" style="font-size:1.1rem;margin-bottom:0.5rem;">Weekly Recap</div>`;
      html += `<div class="briefing-stats" style="margin-bottom:0.75rem;">`;
      html += `<div class="briefing-stat"><div class="briefing-stat-num">${wd.completedByPerson.reduce((s, p) => s + p.tasks.length, 0)}</div><div class="briefing-stat-label">Completed</div></div>`;
      html += `<div class="briefing-stat"><div class="briefing-stat-num">${wd.newTasksCount}</div><div class="briefing-stat-label">New Tasks</div></div>`;
      html += `<div class="briefing-stat"><div class="briefing-stat-num">${wd.totalOpen}</div><div class="briefing-stat-label">Open</div></div>`;
      html += `<div class="briefing-stat"><div class="briefing-stat-num" style="color:${wd.blocked.length > 0 ? 'var(--follett-coral)' : ''}">${wd.blocked.length}</div><div class="briefing-stat-label">Blocked</div></div>`;
      html += `</div>`;

      if (wd.completedByPerson.length > 0) {
        html += `<div class="briefing-section-title">Completed by Person</div>`;
        wd.completedByPerson.sort((a, c) => c.tasks.length - a.tasks.length).forEach(p => {
          html += `<div class="briefing-team-row"><span>${escapeHtml(p.name)}</span><strong>${p.tasks.length}</strong></div>`;
        });
      }

      if (wd.blocked.length > 0) {
        html += `<div class="briefing-section-title" style="margin-top:0.5rem;">Currently Blocked</div>`;
        wd.blocked.forEach(t => {
          html += `<div style="font-size:0.8rem;padding:0.25rem 0;"><strong>${escapeHtml(t.assignee)}</strong>: ${escapeHtml(t.title)}${t.reason ? ` &mdash; <em>${escapeHtml(t.reason)}</em>` : ''}</div>`;
        });
      }
      html += `</div>`;
    }

    html += `<button class="briefing-dismiss" id="briefing-got-it">Let&rsquo;s get to work</button>`;
    content.innerHTML = html;
    overlay.style.display = 'flex';

    // Mark shown for today
    localStorage.setItem(briefingKey, today);

    // Clickable tasks
    content.querySelectorAll('.briefing-task[data-task-id]').forEach(el => {
      el.addEventListener('click', () => {
        overlay.style.display = 'none';
        showTaskDetail(el.dataset.taskId);
      });
    });

    document.getElementById('briefing-got-it').onclick = () => { overlay.style.display = 'none'; };
    document.getElementById('briefing-close').onclick = () => { overlay.style.display = 'none'; };
  } catch (err) {
    console.error('Failed to load briefing:', err);
  }
}

let allNotifications = [];

async function loadNotifications() {
  try {
    allNotifications = await api('GET', '/api/notifications');
  } catch {
    allNotifications = [];
  }
  const unread = allNotifications.filter(n => !n.read);
  const badge = document.getElementById('notif-badge');
  if (unread.length > 0) {
    badge.textContent = unread.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }
  return allNotifications;
}

let notifShowAll = false;

const NOTIF_META = {
  task_assigned:   { icon: '&#8594;', label: 'Assigned to you', color: 'var(--follett-coral)', action: true },
  task_blocked:    { icon: '&#9888;', label: 'Blocked', color: '#d4960a', action: true },
  comment:         { icon: '&#128172;', label: 'Comment', color: 'var(--follett-medium-blue)', action: true },
  task_approved:   { icon: '&#10003;', label: 'Approved', color: 'var(--follett-sage)', action: false },
  task_completed:  { icon: '&#10003;', label: 'Completed', color: 'var(--follett-sage)', action: false },
  task_completed_after_approval: { icon: '&#10003;', label: 'Completed', color: 'var(--follett-sage)', action: false },
  subtask_completed: { icon: '&#10003;', label: 'Subtask done', color: 'var(--color-text-muted)', action: false },
  subtasks_all_done: { icon: '&#9733;', label: 'All subtasks done', color: 'var(--follett-sage)', action: true },
  workspace_added: { icon: '&#128101;', label: 'Workspace', color: 'var(--follett-medium-blue)', action: false },
  announcement:    { icon: '&#128227;', label: 'Announcement', color: 'var(--follett-dark-blue)', action: false }
};

async function showNotifications() {
  switchView('notifications');
  await loadNotifications();
  renderNotifications();
}

function renderNotifications() {
  const container = document.getElementById('notifications-list');
  const empty = document.getElementById('notifications-empty');

  const visible = notifShowAll ? allNotifications : allNotifications.filter(n => !n.read);

  document.getElementById('btn-notif-unread').classList.toggle('active', !notifShowAll);
  document.getElementById('btn-notif-all').classList.toggle('active', notifShowAll);

  if (visible.length === 0) {
    container.innerHTML = '';
    empty.style.display = 'block';
    empty.textContent = notifShowAll ? 'No notifications' : 'All caught up!';
    return;
  }
  empty.style.display = 'none';

  const actionNotifs = visible.filter(n => (NOTIF_META[n.type] || {}).action);
  const fyi = visible.filter(n => !(NOTIF_META[n.type] || {}).action);

  let html = '';
  if (actionNotifs.length > 0) {
    html += `<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--follett-coral);margin-bottom:0.375rem;">Action Needed (${actionNotifs.length})</div>`;
    html += actionNotifs.map(renderNotifItem).join('');
  }
  if (fyi.length > 0) {
    html += `<div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--color-text-muted);margin:0.75rem 0 0.375rem;">Updates</div>`;
    html += fyi.map(renderNotifItem).join('');
  }
  container.innerHTML = html;

  container.onclick = async (e) => {
    // Dismiss button
    const dismissBtn = e.target.closest('.notif-dismiss');
    if (dismissBtn) {
      e.stopPropagation();
      const notifId = dismissBtn.dataset.notifId;
      api('POST', `/api/notifications/${notifId}/read`).catch(() => {});
      const n = allNotifications.find(x => x.id === notifId);
      if (n) n.read = true;
      loadNotifications();
      renderNotifications();
      return;
    }
    // Click notification to open task
    const item = e.target.closest('.notif-item');
    if (!item) return;
    if (item.classList.contains('notif-unread')) {
      api('POST', `/api/notifications/${item.dataset.notifId}/read`).catch(() => {});
      const n = allNotifications.find(x => x.id === item.dataset.notifId);
      if (n) n.read = true;
      loadNotifications();
      if (!notifShowAll) renderNotifications();
    }
    const taskId = item.dataset.taskId;
    if (taskId) {
      let task = tasks.find(t => t.id === taskId);
      if (!task) {
        try { task = await api('GET', `/api/tasks/${taskId}`); } catch { return; }
      }
      if (task) {
        if (!tasks.find(t => t.id === taskId)) tasks.push(task);
        showTaskDetail(taskId);
      }
    }
  };
}

function renderNotifItem(n) {
  const ago = timeAgo(n.createdAt);
  const unreadClass = n.read ? 'notif-read' : 'notif-unread';
  const m = NOTIF_META[n.type] || { icon: '&#8226;', label: '', color: 'var(--color-text-muted)' };
  return `<div class="notif-item ${unreadClass}" data-notif-id="${n.id}" data-task-id="${n.taskId || ''}" style="border-left-color:${n.read ? '' : m.color};">
    <div style="display:flex;align-items:center;gap:0.5rem;">
      <span style="font-size:1rem;flex-shrink:0;width:20px;text-align:center;">${m.icon}</span>
      <div style="flex:1;min-width:0;">
        ${m.label ? `<div style="font-size:0.65rem;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;color:${m.color};margin-bottom:0.1rem;">${m.label}</div>` : ''}
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        <div class="notif-item-time">${ago}${n.dueDate ? ` · Due ${new Date(n.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</div>
      </div>
      ${!n.read ? `<button class="notif-dismiss" data-notif-id="${n.id}" title="Dismiss" style="background:none;border:none;color:var(--color-text-light);font-size:1.1rem;cursor:pointer;padding:0.25rem 0.375rem;flex-shrink:0;line-height:1;-webkit-tap-highlight-color:rgba(0,0,0,0.1);">&times;</button>` : ''}
    </div>
  </div>`;
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function loadTeam() {
  try { teamMembers = await api('GET', '/api/team'); } catch { teamMembers = []; }
  populateAssignToDropdown();
}

function populateAssignToDropdown() {
  const select = document.getElementById('input-assign-to');
  if (!select) return;
  const myId = myProfile ? myProfile.userId : '';
  select.innerHTML = '<option value="">Me (default)</option>' +
    teamMembers.filter(m => (m.status === 'active' || !m.status) && m.userId !== myId).map(m =>
      `<option value="${m.userId}">${escapeHtml(m.displayName)} (${(m.departments || [m.department]).join(', ')})</option>`
    ).join('');
}

// === Workspaces ===
let workspaces = [];
let activeWorkspaceId = null;
let activeWorkspaceName = '';
let activeWorkspaceNotesView = false;
let expandedWorkspaces = new Set();

async function loadWorkspaces() {
  try { workspaces = await api('GET', '/api/workspaces'); } catch { workspaces = []; }
  renderSidebarWorkspaces();
}

function renderSidebarWorkspaces() {
  const container = document.getElementById('sidebar-workspaces');
  if (!container) return;
  // Show section if user has any workspaces or is CMO/lead
  const show = workspaces.length > 0 || (myProfile && (myProfile.role === 'cmo' || myProfile.role === 'lead'));
  document.getElementById('sidebar-workspaces-section').style.display = show ? 'block' : 'none';
  const wsLabel = document.getElementById('sidebar-workspaces-label');
  if (wsLabel) wsLabel.style.display = show ? 'block' : 'none';
  // Auto-expand if user has workspaces
  if (workspaces.length > 0) {
    document.getElementById('workspaces-subnav').classList.remove('collapsed');
    document.getElementById('workspaces-caret').innerHTML = '&#9662;';
  }
  let html = '';
  for (const w of workspaces) {
    const dotColor = w.color || getTagColor(w.name).text;
    const isExpanded = expandedWorkspaces.has(w.id);
    const isActiveTasks = activeWorkspaceId === w.id && currentView === 'tasks';
    const isActiveNotes = activeWorkspaceId === w.id && currentView === 'notes' && activeWorkspaceNotesView;

    html += `<button class="sidebar-dept-item ${isActiveTasks || isActiveNotes ? 'active' : ''}" data-ws-toggle="${w.id}">
      <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:0.375rem;vertical-align:0;flex-shrink:0;"></span>${escapeHtml(w.name)}
    </button>`;

    if (isExpanded) {
      html += `<button class="sidebar-dept-item sidebar-dept-sub ${isActiveTasks ? 'active' : ''}" data-ws-action="tasks" data-ws-id="${w.id}">Tasks</button>`;
      html += `<button class="sidebar-dept-item sidebar-dept-sub ${isActiveNotes ? 'active' : ''}" data-ws-action="notes" data-ws-id="${w.id}">Notes</button>`;
    }
  }
  container.innerHTML = html;

  container.onclick = async (e) => {
    // Toggle expand/collapse
    const toggle = e.target.closest('[data-ws-toggle]');
    if (toggle) {
      const id = toggle.dataset.wsToggle;
      if (expandedWorkspaces.has(id)) expandedWorkspaces.delete(id);
      else expandedWorkspaces.add(id);
      renderSidebarWorkspaces();
      return;
    }

    // Sub-item click (Tasks / Notes)
    const action = e.target.closest('[data-ws-action]');
    if (!action) return;
    const wsId = action.dataset.wsId;
    const actionType = action.dataset.wsAction;

    if (actionType === 'tasks') {
      openWorkspace(wsId);
    } else if (actionType === 'notes') {
      openWorkspaceNotes(wsId);
    }
    closeSidebar();
  };
}

async function openWorkspace(id) {
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;
  activeWorkspaceId = id;
  activeWorkspaceName = ws.name;
  if (currentUser) sessionStorage.setItem('activeWorkspaceId_' + currentUser.uid, id);
  // Reset task scope to show all workspace tasks (not filtered by "My Tasks")
  globalMyTasksView = false;
  globalMyNotesView = false;
  activeWorkspaceNotesView = false;
  showMyTasksOnly = false;
  showMyTeam = false;
  document.getElementById('btn-my-tasks').classList.remove('active');
  document.getElementById('btn-my-team').classList.remove('active');
  document.getElementById('btn-all-tasks').classList.add('active');
  document.getElementById('workspace-header').style.display = 'flex';
  document.getElementById('workspace-header-name').textContent = ws.name;
  document.getElementById('btn-edit-workspace').style.display =
    (myProfile && (myProfile.role === 'cmo' || myProfile.userId === ws.ownerId)) ? '' : 'none';
  switchView('tasks');
  await loadTasks();
  setTaskViewMode(taskViewMode);
  render();
  renderSidebarWorkspaces();
}

async function closeWorkspace() {
  activeWorkspaceId = null;
  activeWorkspaceName = '';
  if (currentUser) sessionStorage.removeItem('activeWorkspaceId_' + currentUser.uid);
  document.getElementById('workspace-header').style.display = 'none';
  // Restore default "My Tasks" scope
  globalMyTasksView = true;
  globalMyNotesView = false;
  showMyTasksOnly = true;
  showMyTeam = false;
  document.getElementById('btn-my-tasks').classList.add('active');
  document.getElementById('btn-my-team').classList.remove('active');
  document.getElementById('btn-all-tasks').classList.remove('active');
  await loadTasks();
  activeWorkspaceNotesView = false;
  render();
  renderSidebarWorkspaces();
}

async function openWorkspaceNotes(id) {
  const ws = workspaces.find(w => w.id === id);
  if (!ws) return;
  activeWorkspaceId = id;
  activeWorkspaceName = ws.name;
  activeWorkspaceNotesView = true;
  globalMyTasksView = false;
  globalMyNotesView = false;
  showMyNotesOnly = false;
  // Show workspace header
  document.getElementById('workspace-header').style.display = 'flex';
  document.getElementById('workspace-header-name').textContent = ws.name;
  document.getElementById('btn-edit-workspace').style.display =
    (myProfile && (myProfile.role === 'cmo' || myProfile.userId === ws.ownerId)) ? '' : 'none';
  // Sync All/Mine toggle
  document.getElementById('btn-all-notes').classList.add('active');
  document.getElementById('btn-my-notes').classList.remove('active');
  document.getElementById('btn-all-notes').style.display = '';
  document.getElementById('btn-my-notes').style.display = '';
  switchView('notes');
  activeFolderId = null;
  await loadWorkspaceNotes(id);
  document.getElementById('notes-folder-title').textContent = ws.name + ' Notes';
  renderSidebarWorkspaces();
}

async function loadWorkspaceNotes(wsId) {
  try {
    activeTagFilter = '';
    let url = `/api/notes?workspaceId=${encodeURIComponent(wsId)}`;
    if (showMyNotesOnly) url += '&mine=true';
    notesList = await api('GET', url);
    // Show All/Mine toggle
    const toggleAll = document.getElementById('btn-all-notes');
    const toggleMine = document.getElementById('btn-my-notes');
    if (toggleAll && toggleMine) {
      toggleAll.style.display = '';
      toggleMine.style.display = '';
    }
    renderNotesList();
    loadArchivedNotes();
  } catch (err) { notesList = []; renderNotesList(); }
}

function showCreateWorkspaceModal(editId) {
  const ws = editId ? workspaces.find(w => w.id === editId) : null;
  document.getElementById('modal-workspace-title').textContent = ws ? 'Edit Workspace' : 'New Workspace';
  document.getElementById('workspace-name').value = ws ? ws.name : '';
  document.getElementById('workspace-desc').value = ws ? (ws.description || '') : '';
  document.getElementById('btn-save-workspace').textContent = ws ? 'Save' : 'Create Workspace';
  document.getElementById('form-workspace').dataset.editId = editId || '';

  // Populate member checkboxes
  const membersDiv = document.getElementById('workspace-members');
  const currentMembers = ws ? (ws.members || []) : [myProfile ? myProfile.userId : ''];
  membersDiv.innerHTML = teamMembers.filter(m => m.status === 'active' || !m.status).map(m =>
    `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.2rem 0;">
      <input type="checkbox" class="ws-member-cb" value="${m.userId}" ${currentMembers.includes(m.userId) ? 'checked' : ''}> ${escapeHtml(m.displayName)}
    </label>`
  ).join('');
  // Show/hide delete button
  const deleteBtn = document.getElementById('btn-delete-workspace');
  const canDelete = ws && myProfile && (myProfile.role === 'cmo' || ws.ownerId === myProfile.userId);
  deleteBtn.style.display = canDelete ? '' : 'none';
  if (canDelete) {
    deleteBtn.onclick = async () => {
      if (!confirm(`Delete workspace "${ws.name}"? Tasks in this workspace will remain but lose their workspace assignment.`)) return;
      try {
        await api('DELETE', `/api/workspaces/${editId}`);
        closeModal('modal-workspace');
        if (activeWorkspaceId === editId) closeWorkspace();
        await loadWorkspaces();
        renderSidebar();
        showToast('Workspace deleted');
      } catch (err) { showToast('Failed to delete workspace', 'error'); }
    };
  }
  openModal('modal-workspace');
}

async function submitWorkspace(e) {
  e.preventDefault();
  const editId = document.getElementById('form-workspace').dataset.editId;
  const name = document.getElementById('workspace-name').value.trim();
  const description = document.getElementById('workspace-desc').value.trim();
  if (!name) return;
  const members = [];
  document.querySelectorAll('.ws-member-cb:checked').forEach(cb => members.push(cb.value));

  try {
    if (editId) {
      await api('PUT', `/api/workspaces/${editId}`, { name, description, members });
    } else {
      await api('POST', '/api/workspaces', { name, description, members });
    }
    closeModal('modal-workspace');
    await loadWorkspaces();
    if (editId && activeWorkspaceId === editId) {
      activeWorkspaceName = name;
      document.getElementById('workspace-header-name').textContent = name;
    }
  } catch (err) { showToast('Operation failed', 'error'); }
}

async function toggleShowOnMaster(taskId, current) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { showOnMaster: !current });
    const task = tasks.find(t => t.id === taskId);
    if (task) task.showOnMaster = !current;
    render();
  } catch (err) { showToast('Failed to update', 'error'); }
}

// === Meeting Import ===
function showImportMeetingModal() {
  document.getElementById('meeting-import-title').value = '';
  document.getElementById('meeting-import-content').value = '';
  document.getElementById('meeting-import-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('meeting-import-results').style.display = 'none';
  // Populate folder dropdown
  const folderSelect = document.getElementById('meeting-import-folder');
  folderSelect.innerHTML = folders.map(f =>
    `<option value="${f.id}" ${f.name === 'All Team' ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
  ).join('');
  openModal('modal-import-meeting');
}

async function submitMeetingImport() {
  const title = document.getElementById('meeting-import-title').value.trim();
  const content = document.getElementById('meeting-import-content').value.trim();
  const folderId = document.getElementById('meeting-import-folder').value;
  const date = document.getElementById('meeting-import-date').value;
  if (!title || !content) { showToast('Title and notes are required', 'error'); return; }

  const btn = document.getElementById('btn-submit-meeting-import');
  btn.disabled = true;
  btn.textContent = 'Importing...';

  try {
    const result = await api('POST', '/api/meetings/import', {
      title, content, folderId, date: date ? new Date(date).toISOString() : undefined
    });
    showToast(`Meeting note saved to ${folders.find(f => f.id === folderId)?.name || 'notes'}`);

    // Show suggested tasks
    const resultsDiv = document.getElementById('meeting-import-results');
    const tasksDiv = document.getElementById('meeting-suggested-tasks');
    if (result.suggestedTasks && result.suggestedTasks.length > 0) {
      resultsDiv.style.display = 'block';
      tasksDiv.innerHTML = result.suggestedTasks.map((t, i) => {
        const assignee = t.assignee ? teamMembers.find(m => m.userId === t.assignee) : null;
        const assigneeName = assignee ? assignee.displayName : 'Unassigned';
        return `<label style="display:flex;align-items:flex-start;gap:0.5rem;padding:0.4rem 0;font-size:0.85rem;border-bottom:1px solid var(--color-border);">
          <input type="checkbox" checked class="suggested-task-cb" data-idx="${i}" style="margin-top:0.2rem;">
          <div style="flex:1;">
            <div style="font-weight:500;">${escapeHtml(t.title)}</div>
            <div style="font-size:0.75rem;color:var(--color-text-muted);">${escapeHtml(assigneeName)} · ${escapeHtml(t.priority || 'Medium')} · ${escapeHtml(t.department || 'B2B Marketing')}</div>
          </div>
        </label>`;
      }).join('');

      document.getElementById('btn-approve-suggested').onclick = async () => {
        const selected = [];
        document.querySelectorAll('.suggested-task-cb:checked').forEach(cb => {
          selected.push(result.suggestedTasks[parseInt(cb.dataset.idx)]);
        });
        if (selected.length === 0) { showToast('No tasks selected'); return; }
        try {
          for (const t of selected) {
            await api('POST', '/api/tasks', {
              title: t.title,
              department: t.department || 'B2B Marketing',
              priority: t.priority || 'Medium',
              assignedTo: t.assignee || undefined,
              status: t.assignee ? 'Delegated' : 'Not Started',
              notes: `From meeting: ${title}`
            });
          }
          showToast(`Created ${selected.length} tasks from meeting`);
          closeModal('modal-import-meeting');
          await loadTasks();
          render();
        } catch (err) { showToast('Failed to create tasks', 'error'); }
      };
    } else {
      resultsDiv.style.display = 'block';
      tasksDiv.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted);">No action items detected. Note was saved.</p>';
    }
  } catch (err) {
    showToast('Import failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Import & Suggest Tasks';
  }
}

// === Task Templates ===
let allTemplates = [];

async function loadTemplates() {
  try { allTemplates = await api('GET', '/api/templates'); } catch { allTemplates = []; }
}

function showTemplatesModal() {
  loadTemplates().then(renderTemplatesList);
  openModal('modal-templates');
  const scopeSelect = document.getElementById('template-scope');
  if (myProfile) {
    const opts = scopeSelect.options;
    for (let i = 0; i < opts.length; i++) {
      if (opts[i].value === 'org') opts[i].disabled = myProfile.role !== 'cmo';
      if (opts[i].value === 'department') opts[i].disabled = myProfile.role !== 'cmo' && myProfile.role !== 'lead';
    }
  }
}

function renderTemplatesList() {
  const container = document.getElementById('templates-list');
  if (allTemplates.length === 0) {
    container.innerHTML = '<p style="font-size:0.85rem;color:var(--color-text-muted);padding:0.5rem 0;">No templates yet. Create one below.</p>';
    return;
  }
  container.innerHTML = allTemplates.map(t => {
    const scopeLabel = t.scope === 'org' ? 'Org-wide' : t.scope === 'department' ? t.department : 'Personal';
    const canEdit = myProfile && (myProfile.role === 'cmo' || t.createdBy === myProfile.userId);
    return `<div style="border:1px solid var(--color-border);border-radius:var(--radius);padding:0.625rem;margin-bottom:0.5rem;">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <strong style="font-size:0.9rem;">${escapeHtml(t.name)}</strong>
          <span style="font-size:0.7rem;color:var(--color-text-muted);margin-left:0.375rem;">${scopeLabel} · ${t.subtasks.length} subtasks · by ${escapeHtml(t.createdByName || 'Unknown')}</span>
        </div>
        ${canEdit ? `<button class="btn btn-ghost btn-sm" style="color:var(--follett-coral);font-size:0.75rem;" onclick="deleteTemplate('${t.id}')">Delete</button>` : ''}
      </div>
      <div style="font-size:0.8rem;color:var(--color-text-muted);margin-top:0.25rem;">${t.subtasks.map(s => escapeHtml(s.title)).join(' · ')}</div>
    </div>`;
  }).join('');
}

async function saveTemplate() {
  const name = document.getElementById('template-name').value.trim();
  const scope = document.getElementById('template-scope').value;
  const text = document.getElementById('template-subtasks-text').value.trim();
  if (!name) { showToast('Template name is required', 'error'); return; }
  if (!text) { showToast('Add at least one subtask', 'error'); return; }
  const subtasks = text.split('\n').filter(l => l.trim()).map(l => ({ title: l.trim(), priority: 'Medium' }));
  try {
    await api('POST', '/api/templates', { name, scope, subtasks });
    document.getElementById('template-name').value = '';
    document.getElementById('template-subtasks-text').value = '';
    await loadTemplates();
    renderTemplatesList();
    showToast('Template created');
  } catch (err) { showToast('Failed to create template: ' + err.message, 'error'); }
}

async function deleteTemplate(id) {
  if (!confirm('Delete this template?')) return;
  try {
    await api('DELETE', `/api/templates/${id}`);
    await loadTemplates();
    renderTemplatesList();
    showToast('Template deleted');
  } catch (err) { showToast('Failed to delete', 'error'); }
}

async function applyTemplate(templateId, taskId) {
  try {
    const result = await api('POST', `/api/templates/${templateId}/apply/${taskId}`);
    showToast(`Added ${result.applied} subtasks`);
    loadSubtasks(taskId);
  } catch (err) { showToast('Failed to apply template: ' + err.message, 'error'); }
}

// === AI Context Settings ===
async function openAiContext() {
  openModal('modal-ai-context');
  try {
    const { context } = await api('GET', '/api/settings/ai-context');
    document.getElementById('ai-context-textarea').value = context || '';
  } catch (err) { console.error('Failed to load AI context:', err); }
}

async function saveAiContext() {
  try {
    await api('PUT', '/api/settings/ai-context', { context: document.getElementById('ai-context-textarea').value });
    closeModal('modal-ai-context');
    showToast('AI context saved! The AI will now use this across the app.');
  } catch (err) { showToast('Failed to save', 'error'); }
}

async function generateAiContext() {
  const btn = document.getElementById('btn-ai-context-generate');
  btn.disabled = true;
  btn.textContent = 'Generating...';
  try {
    const { draft } = await api('POST', '/api/settings/ai-context/generate');
    document.getElementById('ai-context-textarea').value = draft;
  } catch (err) { showToast('Failed to generate', 'error'); }
  btn.disabled = false;
  btn.textContent = 'Auto-Generate Draft';
}

// === Announcements ===
async function sendAnnouncement() {
  document.getElementById('announce-message').value = '';
  openModal('modal-announce');
}

// === Slack Settings ===
async function openSlackSettings() {
  openModal('modal-slack');
  const container = document.getElementById('slack-settings-content');
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--color-text-muted);">Loading Slack settings...</div>';

  try {
    const status = await api('GET', '/api/slack/status');

    if (!status.connected) {
      container.innerHTML = `
        <div style="text-align:center;padding:2rem;">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">💬</div>
          <h3 style="margin-bottom:0.5rem;color:var(--follett-dark-blue);">Connect Slack</h3>
          <p style="font-size:0.85rem;color:var(--color-text-muted);margin-bottom:1.25rem;max-width:360px;margin-left:auto;margin-right:auto;">
            Get instant Slack notifications when tasks are assigned, completed, blocked, or approved. Team members receive DMs, and you can route alerts to channels.
          </p>
          <button class="btn btn-primary" id="btn-slack-connect">Add to Slack</button>
          <p style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.75rem;">
            Requires a Slack app with Bot Token Scopes: <code>chat:write</code>, <code>users:read</code>, <code>users:read.email</code>, <code>channels:read</code>, <code>groups:read</code>, <code>im:write</code>
          </p>
        </div>`;
      document.getElementById('btn-slack-connect').addEventListener('click', async () => {
        try {
          const { url } = await api('GET', '/api/slack/install');
          window.open(url, 'slack-auth', 'width=600,height=700');
          // Poll for connection
          const poll = setInterval(async () => {
            const s = await api('GET', '/api/slack/status');
            if (s.connected) { clearInterval(poll); openSlackSettings(); }
          }, 2000);
          setTimeout(() => clearInterval(poll), 120000);
        } catch (err) { showToast('Failed to start Slack connection', 'error'); }
      });
      return;
    }

    // Connected — show full settings
    await loadTeam();
    const [slackUsers, channels, notifChannels] = await Promise.all([
      api('GET', '/api/slack/users').catch(err => { console.error('Slack users fetch failed:', err); return []; }),
      api('GET', '/api/slack/channels').catch(() => []),
      api('GET', '/api/slack/notification-channels').catch(() => ({}))
    ]);

    let html = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding:0.625rem;background:var(--color-comms-light);border-radius:var(--radius);">
        <div>
          <span style="font-size:0.85rem;font-weight:600;color:var(--follett-dark-blue);">Connected to ${escapeHtml(status.teamName)}</span>
        </div>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-ghost btn-sm" id="btn-slack-test">Send Test</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--follett-coral);" id="btn-slack-disconnect">Disconnect</button>
        </div>
      </div>`;

    // User mapping section
    html += `<div style="margin-bottom:1.25rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
        <h3 style="font-size:0.9rem;font-weight:600;color:var(--follett-dark-blue);margin:0;">User Mapping</h3>
        <button class="btn btn-secondary btn-sm" id="btn-slack-automap">Auto-Map by Email</button>
      </div>
      <p style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.5rem;">Match each team member to their Slack account to enable DM notifications.</p>
      <div style="max-height:240px;overflow-y:auto;">
        <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
          <thead><tr style="text-align:left;border-bottom:1px solid var(--color-border);">
            <th style="padding:0.375rem 0.5rem;">Team Member</th>
            <th style="padding:0.375rem 0.5rem;">Slack User</th>
          </tr></thead>
          <tbody>`;

    const activeMembers = teamMembers.filter(m => m.status === 'active' || !m.status);
    activeMembers.forEach(m => {
      const currentSlackId = m.slackUserId || '';
      const currentSlackUser = slackUsers.find(su => su.id === currentSlackId);
      const displayVal = currentSlackUser ? `${currentSlackUser.name}${currentSlackUser.email ? ' (' + currentSlackUser.email + ')' : ''}` : '';
      html += `<tr style="border-bottom:1px solid var(--color-border);">
        <td style="padding:0.375rem 0.5rem;">${escapeHtml(m.displayName)}<br><span style="font-size:0.7rem;color:var(--color-text-muted);">${escapeHtml(m.email || '')}</span></td>
        <td style="padding:0.375rem 0.5rem;position:relative;">
          <input type="text" class="slack-user-search" data-member-id="${m.id}" data-slack-id="${currentSlackId}"
            placeholder="Search Slack users..." value="${escapeHtml(displayVal)}"
            style="width:100%;font-size:0.8rem;padding:0.3rem 0.5rem;border:1px solid var(--color-border);border-radius:var(--radius);box-sizing:border-box;"
            autocomplete="off">
          <div class="slack-user-dropdown" style="display:none;position:absolute;left:0.5rem;right:0.5rem;top:100%;background:white;border:1px solid var(--color-border);border-radius:var(--radius);max-height:180px;overflow-y:auto;z-index:100;box-shadow:0 4px 12px rgba(0,0,0,0.15);"></div>
        </td>
      </tr>`;
    });

    html += `</tbody></table></div>
      <button class="btn btn-primary btn-sm" id="btn-slack-save-mappings" style="margin-top:0.5rem;">Save Mappings</button>
    </div>`;

    // Channel notification routing
    const notifTypes = [
      { key: 'all', label: 'All Notifications' },
      { key: 'task_assigned', label: 'Task Assigned' },
      { key: 'task_blocked', label: 'Task Blocked' },
      { key: 'task_approved', label: 'Task Approved' },
      { key: 'task_completed', label: 'Task Completed' },
      { key: 'comment', label: 'Comments' }
    ];

    html += `<div>
      <h3 style="font-size:0.9rem;font-weight:600;color:var(--follett-dark-blue);margin-bottom:0.25rem;">Channel Notifications</h3>
      <p style="font-size:0.75rem;color:var(--color-text-muted);margin-bottom:0.5rem;">Optionally route notification types to Slack channels. The bot must be added to the channel first.</p>`;

    if (channels.length === 0) {
      html += `<p style="font-size:0.8rem;color:var(--color-text-muted);font-style:italic;">No channels found. Invite the bot to a channel first (type <code>/invite @YourBotName</code> in the channel).</p>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">`;
      notifTypes.forEach(nt => {
        const selected = (notifChannels[nt.key] || [])[0] || '';
        html += `<div>
          <label style="font-size:0.75rem;font-weight:500;display:block;margin-bottom:0.125rem;">${nt.label}</label>
          <select class="slack-channel-map filter-select-compact" data-notif-type="${nt.key}" style="width:100%;font-size:0.8rem;">
            <option value="">None</option>
            ${channels.map(ch => `<option value="${ch.id}" ${ch.id === selected ? 'selected' : ''}>${ch.isPrivate ? '🔒' : '#'}${escapeHtml(ch.name)}</option>`).join('')}
          </select>
        </div>`;
      });
      html += `</div>
        <button class="btn btn-primary btn-sm" id="btn-slack-save-channels" style="margin-top:0.5rem;">Save Channels</button>`;
    }

    html += `</div>`;
    container.innerHTML = html;

    // Event listeners
    document.getElementById('btn-slack-disconnect').addEventListener('click', async () => {
      if (!confirm('Disconnect Slack? This will stop all Slack notifications.')) return;
      try { await api('POST', '/api/slack/disconnect'); openSlackSettings(); } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('btn-slack-test').addEventListener('click', async () => {
      try {
        await api('POST', '/api/slack/test');
        showToast('Test notification sent! Check your Slack DMs.');
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('btn-slack-automap').addEventListener('click', async () => {
      try {
        const result = await api('POST', '/api/slack/auto-map');
        showToast(`Auto-mapped ${result.mapped} user(s) by email.`);
        openSlackSettings(); // Refresh
      } catch (err) { showToast(err.message, 'error'); }
    });

    document.getElementById('btn-slack-save-mappings').addEventListener('click', async () => {
      const inputs = document.querySelectorAll('.slack-user-search');
      const mappings = [];
      inputs.forEach(inp => {
        mappings.push({ memberId: inp.dataset.memberId, slackUserId: inp.dataset.slackId || '' });
      });
      try {
        await api('POST', '/api/slack/map-users', { mappings });
        await loadTeam();
        showToast('User mappings saved!');
      } catch (err) { showToast(err.message, 'error'); }
    });

    // Searchable Slack user dropdowns
    document.querySelectorAll('.slack-user-search').forEach(input => {
      const dropdown = input.parentElement.querySelector('.slack-user-dropdown');

      function renderDropdown(filter) {
        const q = (filter || '').toLowerCase();
        const filtered = q
          ? slackUsers.filter(su => su.name.toLowerCase().includes(q) || (su.email || '').toLowerCase().includes(q))
          : slackUsers;
        if (filtered.length === 0) {
          dropdown.innerHTML = '<div style="padding:0.5rem;font-size:0.8rem;color:var(--color-text-muted);">No matches</div>';
        } else {
          dropdown.innerHTML = filtered.slice(0, 30).map(su =>
            `<div class="slack-dropdown-item" data-id="${su.id}" style="padding:0.375rem 0.5rem;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--color-border);">
              <strong>${escapeHtml(su.name)}</strong>${su.email ? '<br><span style="font-size:0.7rem;color:var(--color-text-muted);">' + escapeHtml(su.email) + '</span>' : ''}
            </div>`
          ).join('');
        }
        // Add "clear" option at top if currently mapped
        if (input.dataset.slackId) {
          dropdown.insertAdjacentHTML('afterbegin',
            `<div class="slack-dropdown-item" data-id="" style="padding:0.375rem 0.5rem;font-size:0.8rem;cursor:pointer;border-bottom:1px solid var(--color-border);color:var(--follett-coral);">Clear mapping</div>`);
        }
        dropdown.style.display = 'block';
      }

      input.addEventListener('focus', () => renderDropdown(input.value));
      input.addEventListener('input', () => renderDropdown(input.value));

      dropdown.addEventListener('mousedown', (e) => {
        e.preventDefault(); // Prevent blur from firing before click
        const item = e.target.closest('.slack-dropdown-item');
        if (!item) return;
        const id = item.dataset.id;
        input.dataset.slackId = id;
        if (id) {
          const su = slackUsers.find(s => s.id === id);
          input.value = su ? `${su.name}${su.email ? ' (' + su.email + ')' : ''}` : '';
        } else {
          input.value = '';
        }
        dropdown.style.display = 'none';
      });

      input.addEventListener('blur', () => {
        setTimeout(() => { dropdown.style.display = 'none'; }, 150);
      });
    });

    const saveChannelsBtn = document.getElementById('btn-slack-save-channels');
    if (saveChannelsBtn) {
      saveChannelsBtn.addEventListener('click', async () => {
        const selects = document.querySelectorAll('.slack-channel-map');
        const notificationChannels = {};
        selects.forEach(sel => {
          const type = sel.dataset.notifType;
          if (sel.value) notificationChannels[type] = [sel.value];
        });
        try {
          await api('PUT', '/api/slack/notification-channels', { notificationChannels });
          showToast('Channel notifications saved!');
        } catch (err) { showToast(err.message, 'error'); }
      });
    }

  } catch (err) {
    container.innerHTML = `<p style="color:var(--follett-coral);padding:1rem;">Failed to load Slack settings: ${escapeHtml(err.message)}</p>`;
  }
}

async function showTeamView() {
  switchView('team');
  await loadTeam();
  const container = document.getElementById('team-roster');
  const isCmo = myProfile && myProfile.role === 'cmo';

  // Group by department
  const deptGroups = {};
  teamMembers.forEach(m => {
    const depts = m.departments || [m.department] || ['Unassigned'];
    depts.forEach(d => {
      if (!deptGroups[d]) deptGroups[d] = [];
      if (!deptGroups[d].find(x => x.id === m.id)) deptGroups[d].push(m);
    });
  });

  // Sort: leads first, then alphabetical
  const canManage = (m) => {
    if (isCmo && m.role !== 'cmo') return true;
    if (myProfile && myProfile.role === 'lead' && m.reportsTo === myProfile.userId) return true;
    return false;
  };

  let html = '';

  // View As dropdown for CMO
  if (isCmo) {
    html += `<div style="margin-bottom:1rem;padding:0.625rem;background:var(--follett-light-gray);border-radius:var(--radius);display:flex;align-items:center;gap:0.5rem;">
      <span style="font-size:0.8rem;font-weight:500;">View app as:</span>
      <select id="view-as-select" class="filter-select-compact" style="flex:1;" onchange="viewAs(this.value)">
        <option value="">Myself (CMO)</option>
        ${teamMembers.filter(m => m.role !== 'cmo' && m.status === 'active').map(m =>
          `<option value="${m.userId}">${escapeHtml(m.displayName)} (${m.role})</option>`
        ).join('')}
      </select>
    </div>`;
  }

  // Flat alphabetical list, deduplicated
  const seen = new Set();
  const allMembers = teamMembers
    .filter(m => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return m.status === 'active' || !m.status;
    })
    .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));

  const roleColors = { cmo: 'var(--follett-dark-blue)', lead: 'var(--follett-medium-blue)', member: 'var(--follett-sage)', viewer: 'var(--color-text-muted)' };
  const roleLabels = { cmo: 'CMO', lead: 'Lead', member: 'Member', viewer: 'Viewer' };

  allMembers.forEach(m => {
    const reportsToMember = m.reportsTo ? teamMembers.find(t => t.userId === m.reportsTo) : null;
    const reportsLabel = reportsToMember ? `Reports to: ${escapeHtml(reportsToMember.displayName)}` : '';
    const depts = (m.departments || [m.department] || []).filter(Boolean).join(', ');
    const roleColor = roleColors[m.role] || roleColors.member;
    const roleLabel = roleLabels[m.role] || 'Member';

    const slackMapped = m.slackUserId ? true : false;
    const showSlackMap = canManage(m) && m.role !== 'cmo' && !slackMapped;

    html += `<div class="team-member-card" style="border-left:3px solid ${roleColor};">
      <div class="team-member-info">
        <div class="team-member-name">${escapeHtml(m.displayName)} <span class="team-role-badge" style="background:${roleColor};">${roleLabel}</span>${slackMapped ? ' <span style="font-size:0.6rem;color:var(--follett-sage);" title="Slack connected">&#10003; Slack</span>' : ''}</div>
        <div class="team-member-meta">${escapeHtml(m.email)}${depts ? ` · ${depts}` : ''}${reportsLabel ? ` · ${reportsLabel}` : ''}</div>
      </div>
      <div class="team-member-actions">
        ${canManage(m) && m.role !== 'cmo' ? `<button class="btn btn-ghost btn-sm" onclick="showPrepOneOnOne('${m.userId}')">Prep 1:1</button>` : ''}
        ${showSlackMap ? `<button class="btn btn-ghost btn-sm" onclick="mapSlackUser('${m.id}', '${escapeHtml(m.displayName)}')">Map Slack</button>` : ''}
        ${canManage(m) && m.role !== 'cmo' ? `<button class="btn btn-ghost btn-sm" onclick="resetPassword('${m.id}', '${escapeHtml(m.displayName)}')">Reset PW</button>` : ''}
        ${canManage(m) ? `<button class="btn btn-ghost btn-sm" onclick="editMember('${m.id}')">Edit</button>
        <button class="btn btn-ghost btn-sm" style="color:var(--follett-coral);" onclick="deleteMember('${m.id}', '${escapeHtml(m.displayName)}')">Remove</button>` : ''}
      </div>
    </div>`;
  });

  container.innerHTML = html;
}

async function showPrepOneOnOne(userId) {
  const overlay = document.getElementById('briefing-overlay');
  const content = document.getElementById('briefing-content');
  content.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--color-text-muted);">Loading 1:1 prep...</div>';
  overlay.style.display = 'flex';

  try {
    const p = await api('GET', `/api/prep/${userId}`);
    const depts = [...(p.departments || []), ...(p.subDepartments || [])].filter(Boolean).join(', ');

    let html = `<div class="briefing-greeting">1:1 Prep: ${escapeHtml(p.name)}</div>`;
    html += `<div class="briefing-date">${escapeHtml(p.role === 'lead' ? 'Dept Lead' : p.role)} · ${escapeHtml(depts)} · ${p.totalTasks} open tasks</div>`;

    // Stats
    html += `<div class="briefing-stats">`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num">${p.completedThisWeek.length}</div><div class="briefing-stat-label">Done This Week</div></div>`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num">${p.inProgress.length}</div><div class="briefing-stat-label">In Progress</div></div>`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num" style="color:${p.overdue.length > 0 ? 'var(--follett-coral)' : ''}">${p.overdue.length}</div><div class="briefing-stat-label">Overdue</div></div>`;
    html += `<div class="briefing-stat"><div class="briefing-stat-num" style="color:${p.blocked.length > 0 ? '#d4960a' : ''}">${p.blocked.length}</div><div class="briefing-stat-label">Blocked</div></div>`;
    html += `</div>`;

    // Completed this week
    if (p.completedThisWeek.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Completed This Week</div>`;
      p.completedThisWeek.forEach(t => {
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-upcoming"></span> ${escapeHtml(t.title)}</div>`;
      });
      html += `</div>`;
    }

    // In progress
    if (p.inProgress.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">In Progress</div>`;
      p.inProgress.forEach(t => {
        const dueFmt = t.dueDate ? new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-due"></span> ${escapeHtml(t.title)}${dueFmt ? `<span class="briefing-task-due">${dueFmt}</span>` : ''}</div>`;
      });
      html += `</div>`;
    }

    // Overdue
    if (p.overdue.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Overdue</div>`;
      p.overdue.forEach(t => {
        const dueFmt = t.dueDate ? new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-overdue"></span> ${escapeHtml(t.title)}<span class="briefing-task-due">${dueFmt}</span></div>`;
      });
      html += `</div>`;
    }

    // Blocked
    if (p.blocked.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Blocked</div>`;
      p.blocked.forEach(t => {
        html += `<div class="briefing-task" data-task-id="${t.id}"><span class="dot-overdue" style="background:#d4960a;"></span> ${escapeHtml(t.title)}${t.blockedReason ? ` <span style="font-size:0.75rem;color:var(--color-text-muted);">&mdash; ${escapeHtml(t.blockedReason)}</span>` : ''}</div>`;
      });
      html += `</div>`;
    }

    // Not started
    if (p.notStarted.length > 0) {
      html += `<div class="briefing-section"><div class="briefing-section-title">Not Started (${p.notStarted.length})</div>`;
      p.notStarted.slice(0, 5).forEach(t => {
        const dueFmt = t.dueDate ? new Date(t.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
        html += `<div class="briefing-task" data-task-id="${t.id}"><span style="width:6px;height:6px;border-radius:50%;background:var(--color-text-light);flex-shrink:0;"></span> ${escapeHtml(t.title)}${dueFmt ? `<span class="briefing-task-due">${dueFmt}</span>` : ''}</div>`;
      });
      if (p.notStarted.length > 5) html += `<div style="font-size:0.75rem;color:var(--color-text-muted);padding:0.25rem 0;">+ ${p.notStarted.length - 5} more</div>`;
      html += `</div>`;
    }

    // Recent comments
    if (p.recentComments.length > 0) {
      html += `<div class="briefing-team-section"><div class="briefing-section-title">Recent Discussion</div>`;
      p.recentComments.forEach(c => {
        html += `<div style="font-size:0.8rem;padding:0.3rem 0;border-bottom:1px solid var(--color-border);"><strong>${escapeHtml(c.author)}</strong> on "${escapeHtml(c.taskTitle)}" <span style="color:var(--color-text-muted);">(${c.date})</span><br><span style="color:var(--color-text-muted);">${escapeHtml(c.text)}</span></div>`;
      });
      html += `</div>`;
    }

    html += `<button class="briefing-dismiss" id="briefing-got-it">Close</button>`;
    content.innerHTML = html;

    // Clickable tasks
    content.querySelectorAll('.briefing-task[data-task-id]').forEach(el => {
      el.addEventListener('click', () => {
        overlay.style.display = 'none';
        showTaskDetail(el.dataset.taskId);
      });
    });

    document.getElementById('briefing-got-it').onclick = () => { overlay.style.display = 'none'; };
    document.getElementById('briefing-close').onclick = () => { overlay.style.display = 'none'; };
  } catch (err) {
    content.innerHTML = `<div style="color:var(--follett-coral);padding:1rem;">Failed to load prep: ${escapeHtml(err.message)}</div><button class="briefing-dismiss" id="briefing-got-it">Close</button>`;
    document.getElementById('briefing-got-it').onclick = () => { overlay.style.display = 'none'; };
    document.getElementById('briefing-close').onclick = () => { overlay.style.display = 'none'; };
  }
}

let realProfile = null;

async function viewAs(userId) {
  if (!userId) {
    // Exit impersonation
    viewAsUserId = null;
    if (realProfile) {
      myProfile = realProfile;
      realProfile = null;
      applyRoleUI();
      document.getElementById('impersonation-banner').style.display = 'none';
      await loadTasks();
      render();
      await loadFolders();
      await loadNotesList(activeFolderId);
    }
    return;
  }
  try {
    viewAsUserId = userId; // This makes all API calls filter as this user
    if (!realProfile) realProfile = { ...myProfile };
    const profile = await api('GET', '/api/me'); // Get profile as impersonated user
    myProfile = profile;
    applyRoleUI();
    // Show banner
    let banner = document.getElementById('impersonation-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'impersonation-banner';
      banner.style.cssText = 'position:fixed;top:0;left:240px;right:0;background:var(--follett-coral);color:#fff;padding:0.4rem 1rem;font-size:0.8rem;z-index:500;display:flex;justify-content:space-between;align-items:center;';
      document.body.appendChild(banner);
    }
    banner.innerHTML = `<span>Viewing as: <strong>${escapeHtml(profile.name)}</strong> (${profile.role})</span><button onclick="viewAs('')" style="background:none;border:1px solid #fff;color:#fff;border-radius:var(--radius);padding:0.2rem 0.5rem;cursor:pointer;font-size:0.75rem;">Exit</button>`;
    banner.style.display = 'flex';
    await loadTasks();
    render();
    await loadFolders();
    await loadNotesList(activeFolderId);
    switchView('tasks');
  } catch (err) {
    viewAsUserId = null;
    showToast('Failed to impersonate', 'error');
  }
}

function inviteMember() {
  document.getElementById('form-invite').reset();
  document.getElementById('invite-result').style.display = 'none';
  document.getElementById('form-invite').style.display = 'block';

  // Populate Reports To dropdown with leads and CMO
  const reportsToSelect = document.getElementById('invite-reports-to');
  const leads = teamMembers.filter(m => (m.role === 'lead' || m.role === 'cmo') && m.status === 'active');
  reportsToSelect.innerHTML = '<option value="">None</option>' +
    leads.map(l => `<option value="${l.userId}">${escapeHtml(l.displayName)}</option>`).join('');

  openModal('modal-invite');
}

async function submitInvite(e) {
  e.preventDefault();
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const departments = [];
  document.querySelectorAll('.invite-dept-cb:checked').forEach(cb => departments.push(cb.value));
  const role = document.getElementById('invite-role').value;
  const reportsTo = document.getElementById('invite-reports-to').value;

  if (!name || !email || departments.length === 0) { showToast('Name, email, and at least one department required', 'error'); return; }

  try {
    const result = await api('POST', '/api/team/invite', { email, displayName: name, departments, role, reportsTo });

    // Build the rich onboarding message (same as Reset PW)
    const firstName = name.split(' ')[0];
    if (result.resetLink) {
      const message = `Hey ${firstName}! Here's your login info for our marketing task manager:\n\n` +
        `1. First, set your password using this link:\n${result.resetLink}\n\n` +
        `2. Once that's done, go to the app:\nhttps://cmo-task-manager-951932541878.us-central1.run.app\n\n` +
        `3. Sign in with your email (${email}) and the password you just created.\n\n` +
        `You'll see a Getting Started task with a few steps to walk you through it. Let me know if you have any questions!`;
      await navigator.clipboard.writeText(message);
      showToast(`${name} added! Onboarding message copied to clipboard.`);
    } else {
      showToast(`${name} added! Use the "Reset PW" button on their card to generate a login link.`);
    }

    closeModal('modal-invite');
    document.getElementById('form-invite').reset();
    document.getElementById('form-invite').style.display = '';
    document.getElementById('invite-result').style.display = 'none';
    showTeamView();
  } catch (err) { showToast('Failed to add member', 'error'); }
}

async function disableMember(id) {
  if (!confirm('Disable this team member? They will lose access immediately.')) return;
  try { await api('POST', `/api/team/${id}/disable`); showTeamView(); } catch (err) { showToast(err.message, 'error'); }
}

async function enableMember(id) {
  try { await api('POST', `/api/team/${id}/enable`); showTeamView(); } catch (err) { showToast(err.message, 'error'); }
}

async function editMember(id) {
  const member = teamMembers.find(m => m.id === id);
  if (!member) return;
  const memberDepts = member.departments || [member.department];

  const deptCheckboxes = DEPARTMENTS.map(d =>
    `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.25rem 0;">
      <input type="checkbox" class="edit-dept-cb" value="${d}" ${memberDepts.includes(d) ? 'checked' : ''}> ${d}
    </label>`
  ).join('');

  const roleSelect = `<select id="edit-role" style="padding:0.4rem;border-radius:var(--radius);border:1px solid var(--color-border);font-size:0.85rem;margin-top:0.25rem;">
    <option value="member" ${member.role === 'member' ? 'selected' : ''}>Team Member</option>
    <option value="lead" ${member.role === 'lead' ? 'selected' : ''}>Department Lead</option>
    <option value="viewer" ${member.role === 'viewer' ? 'selected' : ''}>Viewer</option>
  </select>`;

  // Reports To dropdown
  const leads = teamMembers.filter(m => (m.role === 'lead' || m.role === 'cmo') && m.id !== id);
  const reportsToSelect = `<select id="edit-reports-to" style="padding:0.4rem;border-radius:var(--radius);border:1px solid var(--color-border);font-size:0.85rem;margin-top:0.25rem;">
    <option value="">None</option>
    ${leads.map(l => `<option value="${l.userId}" ${member.reportsTo === l.userId ? 'selected' : ''}>${escapeHtml(l.displayName)}</option>`).join('')}
  </select>`;

  const container = document.getElementById('team-roster');
  const editHtml = `<div class="team-member-card" id="edit-member-form" style="border: 2px solid var(--follett-medium-blue);">
    <div style="flex:1;">
      <div class="team-member-name" style="margin-bottom:0.5rem;">Editing: ${escapeHtml(member.displayName)}</div>
      <div style="margin-bottom:0.5rem;"><strong style="font-size:0.75rem;text-transform:uppercase;color:var(--follett-dark-blue);">Departments:</strong><br>${deptCheckboxes}</div>
      <div style="margin-bottom:0.5rem;"><strong style="font-size:0.75rem;text-transform:uppercase;color:var(--follett-dark-blue);">Role:</strong><br>${roleSelect}</div>
      <div><strong style="font-size:0.75rem;text-transform:uppercase;color:var(--follett-dark-blue);">Reports To:</strong><br>${reportsToSelect}</div>
    </div>
    <div class="team-member-actions" style="flex-direction:column;gap:0.5rem;">
      <button class="btn btn-primary btn-sm" onclick="saveMemberEdit('${id}')">Save</button>
      <button class="btn btn-ghost btn-sm" onclick="showTeamView()">Cancel</button>
    </div>
  </div>`;

  // Replace the member's card with the edit form
  const cards = container.querySelectorAll('.team-member-card');
  for (const card of cards) {
    if (card.innerHTML.includes(member.displayName)) {
      card.outerHTML = editHtml;
      break;
    }
  }
}

async function saveMemberEdit(id) {
  const departments = [];
  document.querySelectorAll('.edit-dept-cb:checked').forEach(cb => departments.push(cb.value));
  const role = document.getElementById('edit-role').value;
  const reportsTo = document.getElementById('edit-reports-to').value;

  if (departments.length === 0) { showToast('Select at least one department', 'error'); return; }

  try {
    await api('PUT', `/api/team/${id}`, { departments, role, reportsTo });
    showTeamView();
  } catch (err) { showToast('Failed to update', 'error'); }
}

async function deleteMember(id, name) {
  if (!confirm(`Remove ${name} from the team? This deletes their account entirely so you can re-invite them if needed.`)) return;
  try { await api('DELETE', `/api/team/${id}`); showTeamView(); } catch (err) { showToast(err.message, 'error'); }
}

async function resetPassword(id, name) {
  try {
    const result = await api('POST', `/api/team/${id}/reset-password`);
    const firstName = name.split(' ')[0];
    const message = `Hey ${firstName}! Here's your login info for our marketing task manager:\n\n` +
      `1. First, set your password using this link:\n${result.link}\n\n` +
      `2. Once that's done, go to the app:\nhttps://cmo-task-manager-951932541878.us-central1.run.app\n\n` +
      `3. Sign in with your email (${result.email}) and the password you just created.\n\n` +
      `You'll see a Getting Started task with a few steps to walk you through it. Let me know if you have any questions!`;
    await navigator.clipboard.writeText(message);
    showToast(`Message for ${name} copied to clipboard!`);
  } catch (err) { showToast('Failed to generate reset link', 'error'); }
}

async function mapSlackUser(memberId, memberName) {
  try {
    const slackUsers = await api('GET', '/api/slack/users');
    if (!slackUsers || slackUsers.length === 0) {
      showToast('Slack is not connected or no users found', 'error');
      return;
    }

    // Build a simple prompt with a searchable dropdown
    const container = document.createElement('div');
    container.innerHTML = `
      <div style="margin-bottom:0.75rem;">Map <strong>${escapeHtml(memberName)}</strong> to their Slack account:</div>
      <input type="text" id="slack-map-search" placeholder="Type to search Slack users..." style="width:100%;padding:0.4rem 0.6rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.85rem;margin-bottom:0.5rem;box-sizing:border-box;">
      <div id="slack-map-results" style="max-height:200px;overflow-y:auto;border:1px solid var(--color-border);border-radius:var(--radius);"></div>`;

    // Use a modal-like overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = '<div class="modal" style="max-width:400px;"></div>';
    const modal = overlay.querySelector('.modal');
    modal.innerHTML = '<div class="modal-header"><h2>Map Slack User</h2><button class="modal-close" id="btn-close-slack-map">&times;</button></div>';
    modal.appendChild(container);
    document.body.appendChild(overlay);

    const searchInput = document.getElementById('slack-map-search');
    const resultsDiv = document.getElementById('slack-map-results');

    function renderResults(q) {
      const filtered = q
        ? slackUsers.filter(su => su.name.toLowerCase().includes(q) || (su.email || '').toLowerCase().includes(q))
        : slackUsers;
      resultsDiv.innerHTML = filtered.slice(0, 20).map(su =>
        `<div class="slack-dropdown-item" data-id="${su.id}" style="padding:0.5rem 0.625rem;font-size:0.85rem;cursor:pointer;border-bottom:1px solid var(--color-border);">
          <strong>${escapeHtml(su.name)}</strong>${su.email ? '<br><span style="font-size:0.75rem;color:var(--color-text-muted);">' + escapeHtml(su.email) + '</span>' : ''}
        </div>`
      ).join('') || '<div style="padding:0.5rem;font-size:0.85rem;color:var(--color-text-muted);">No matches</div>';
    }

    renderResults('');
    searchInput.focus();
    searchInput.addEventListener('input', () => renderResults(searchInput.value.toLowerCase()));

    resultsDiv.addEventListener('click', async (e) => {
      const item = e.target.closest('.slack-dropdown-item');
      if (!item) return;
      const slackUserId = item.dataset.id;
      try {
        await api('POST', '/api/slack/map-users', { mappings: [{ memberId, slackUserId }] });
        await loadTeam();
        overlay.remove();
        showTeamView();
        showToast(`${memberName} mapped to Slack!`);
      } catch (err) { showToast('Failed to map: ' + err.message, 'error'); }
    });

    document.getElementById('btn-close-slack-map').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  } catch (err) { showToast('Failed to load Slack users', 'error'); }
}

// === Feature Requests ===
async function loadFeatureRequests() {
  try {
    const requests = await api('GET', '/api/feature-requests');
    const container = document.getElementById('feature-requests-list');
    const empty = document.getElementById('feature-requests-empty');

    if (requests.length === 0) {
      container.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    const isManager = myProfile && (myProfile.role === 'cmo' || myProfile.role === 'lead');
    const myId = myProfile ? myProfile.userId : '';

    container.innerHTML = requests.map(r => {
      const ago = timeAgo(r.createdAt);
      const isCompleted = r.status === 'completed';
      const canDelete = myProfile && (myProfile.role === 'cmo' || r.requestedBy === myId);
      const responsesHtml = r.responses.length > 0 ? r.responses.map(resp => `
        <div class="feature-response">
          <strong>${escapeHtml(resp.respondedByName)}</strong>
          <span class="feature-response-time">${timeAgo(resp.respondedAt)}</span>
          <div>${escapeHtml(resp.text)}</div>
        </div>`).join('') : '';

      return `<div class="feature-card ${isCompleted ? 'feature-completed' : ''}">
        <div class="feature-votes">
          <button class="feature-vote-btn ${r.myVote === 'up' ? 'voted-up' : ''}" data-vote-id="${r.id}" data-vote="up" title="Upvote"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>
          <span class="feature-score">${r.score}</span>
          <button class="feature-vote-btn ${r.myVote === 'down' ? 'voted-down' : ''}" data-vote-id="${r.id}" data-vote="down" title="Downvote"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button>
        </div>
        <div class="feature-content">
          <div class="feature-summary">${isCompleted ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--follett-sage)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;"><path d="M20 6L9 17l-5-5"/></svg>' : ''}${escapeHtml(r.summary)}</div>
          <div class="feature-meta">${escapeHtml(r.requestedByName)} &middot; ${ago}${isCompleted ? ' &middot; <span style="color:var(--follett-sage);font-weight:600;">Done</span>' : ''}</div>
          ${responsesHtml}
          <div class="feature-actions">
            ${isManager ? `<button class="feature-action-btn" data-respond-id="${r.id}" title="Respond"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Respond</button>` : ''}
            ${isManager ? `<button class="feature-action-btn" data-complete-id="${r.id}" data-current-status="${r.status}" title="${isCompleted ? 'Reopen' : 'Mark done'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg> ${isCompleted ? 'Reopen' : 'Done'}</button>` : ''}
            ${canDelete ? `<button class="feature-action-btn feature-action-delete" data-delete-id="${r.id}" title="Delete"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg> Delete</button>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    // Vote click handlers
    container.querySelectorAll('.feature-vote-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.voteId;
        const currentVote = btn.classList.contains('voted-up') ? 'up' : btn.classList.contains('voted-down') ? 'down' : null;
        const newVote = btn.dataset.vote === currentVote ? 'none' : btn.dataset.vote;
        try {
          await api('POST', `/api/feature-requests/${id}/vote`, { vote: newVote });
          loadFeatureRequests();
        } catch (err) { showToast('Failed to vote', 'error'); }
      });
    });

    // Respond click handlers
    container.querySelectorAll('[data-respond-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.respondId;
        const text = prompt('Your response:');
        if (!text || !text.trim()) return;
        try {
          await api('POST', `/api/feature-requests/${id}/respond`, { text });
          showToast('Response added');
          loadFeatureRequests();
        } catch (err) { showToast('Failed to respond', 'error'); }
      });
    });

    // Complete/reopen click handlers
    container.querySelectorAll('[data-complete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.completeId;
        const newStatus = btn.dataset.currentStatus === 'completed' ? 'new' : 'completed';
        try {
          await api('PUT', `/api/feature-requests/${id}/status`, { status: newStatus });
          showToast(newStatus === 'completed' ? 'Marked as done' : 'Reopened');
          loadFeatureRequests();
        } catch (err) { showToast('Failed to update', 'error'); }
      });
    });

    // Delete click handlers
    container.querySelectorAll('[data-delete-id]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deleteId;
        if (!confirm('Delete this suggestion? This cannot be undone.')) return;
        try {
          await api('DELETE', `/api/feature-requests/${id}`);
          showToast('Suggestion deleted');
          loadFeatureRequests();
        } catch (err) { showToast('Failed to delete', 'error'); }
      });
    });
  } catch (err) { console.error('Failed to load feature requests:', err); }
}

async function submitSuggestion() {
  const text = document.getElementById('suggest-text').value.trim();
  if (!text) return;

  const btn = document.getElementById('btn-submit-suggestion');
  btn.textContent = 'Submitting...';
  btn.disabled = true;

  try {
    const result = await api('POST', '/api/feature-request', { description: text });
    document.getElementById('suggest-summary').textContent = result.summary;
    document.getElementById('suggest-result').style.display = 'block';
    btn.textContent = 'Sent!';
    setTimeout(() => {
      closeModal('modal-suggest');
      document.getElementById('suggest-text').value = '';
      document.getElementById('suggest-result').style.display = 'none';
      btn.textContent = 'Submit';
      btn.disabled = false;
    }, 2000);
  } catch (err) {
    showToast('Failed to submit', 'error');
    btn.textContent = 'Submit';
    btn.disabled = false;
  }
}

// === Firebase Auth & Boot ===
document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');

  // Google sign-in
  document.getElementById('btn-google-login').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(err => {
      document.getElementById('login-error').textContent = err.message;
    });
  });

  // Email/password sign-in
  document.getElementById('btn-email-login').addEventListener('click', () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { document.getElementById('login-error').textContent = 'Enter email and password'; return; }
    firebase.auth().signInWithEmailAndPassword(email, password).catch(err => {
      document.getElementById('login-error').textContent = err.message;
    });
  });

  // Enter key on password field
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-email-login').click();
  });

  // Forgot password
  document.getElementById('btn-forgot-password').addEventListener('click', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    if (!email) { document.getElementById('login-error').textContent = 'Enter your email first'; return; }
    firebase.auth().sendPasswordResetEmail(email).then(() => {
      document.getElementById('login-error').textContent = '';
      showToast('Password reset email sent to ' + email);
    }).catch(err => { document.getElementById('login-error').textContent = err.message; });
  });

  // Sign out
  document.getElementById('btn-sign-out').addEventListener('click', () => firebase.auth().signOut());

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      authToken = await user.getIdToken();
      document.getElementById('user-email').textContent = user.email;
      loginScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      await loadProfile();
      await init();

      // Restore saved view state
      const savedView = sessionStorage.getItem('appView_' + user.uid);
      const savedTaskMode = sessionStorage.getItem('taskViewMode_' + user.uid);
      const savedWorkspaceId = sessionStorage.getItem('activeWorkspaceId_' + user.uid);
      const savedFolderId = sessionStorage.getItem('activeFolderId_' + user.uid);

      if (savedTaskMode) { taskViewMode = savedTaskMode; setTaskViewMode(taskViewMode); }
      if (savedWorkspaceId && workspaces.find(w => w.id === savedWorkspaceId)) {
        await openWorkspace(savedWorkspaceId);
      } else if (savedView && savedView !== 'tasks') {
        if (savedView === 'notifications') {
          showNotifications();
        } else {
          switchView(savedView);
        }
        if (savedView === 'notes') {
          if (savedFolderId) {
            globalMyNotesView = false;
            activeFolderId = savedFolderId;
            loadNotesList(activeFolderId);
            const folder = folders.find(f => f.id === activeFolderId);
            document.getElementById('notes-folder-title').textContent = folder ? folder.name : 'Notes';
          } else {
            globalMyNotesView = true;
            showMyNotesOnly = true;
            loadNotesList(null);
            document.getElementById('notes-folder-title').textContent = 'My Notes';
          }
        }
      }

      // Handle deep link: ?task=TASK_ID (from Slack notifications etc.)
      const urlParams = new URLSearchParams(window.location.search);
      const deepLinkTaskId = urlParams.get('task');
      if (deepLinkTaskId) {
        // Clear the URL param without reload
        window.history.replaceState({}, '', window.location.pathname);
        // Fetch and show the task (may not be in local array)
        try {
          let task = tasks.find(t => t.id === deepLinkTaskId);
          if (!task) {
            task = await api('GET', `/api/tasks/${deepLinkTaskId}`);
            if (task) tasks.push(task);
          }
          if (task) showTaskDetail(deepLinkTaskId);
        } catch (e) { console.error('Deep link task not found:', e); }
      }

      loadNotifications();
      try { await showBriefingIfNeeded(); } catch (e) { console.error('[Briefing] Error:', e); }
      // Show What's New popup on first login after sidebar restructure
      showWhatsNewIfNeeded(user.uid);
      // Poll notifications every 60 seconds
      notifPollInterval = setInterval(loadNotifications, 60000);
    } else {
      currentUser = null;
      authToken = null;
      myProfile = null;
      tasks = [];
      if (notifPollInterval) { clearInterval(notifPollInterval); notifPollInterval = null; }
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  });

  setInterval(async () => {
    if (currentUser) authToken = await currentUser.getIdToken(true);
  }, 50 * 60 * 1000);
});
