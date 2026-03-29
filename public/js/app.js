// === Constants ===
const DEPARTMENTS = ['B2B Marketing', 'B2C Marketing', 'Personal'];
const SUB_DEPARTMENTS = {
  'B2B Marketing': ['Biz Dev', 'Growth & Brand', 'Rev Ops', 'Internal Comms'],
  'B2C Marketing': [] // Robert will define later
};
const ALL_SUB_DEPTS = Object.values(SUB_DEPARTMENTS).flat();
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Not Started', 'In Progress', 'Blocked', 'Approved', 'Delegated', 'Completed'];
const STORAGE_KEY = 'cmo_tasks';
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
  'Personal': 'personal'
};

const STATUS_KEYS = {
  'Not Started': 'not-started',
  'In Progress': 'in-progress',
  'Blocked': 'blocked',
  'Approved': 'approved',
  'Delegated': 'delegated',
  'Completed': 'completed'
};

// Keywords for auto-detecting department from imported content
const DEPT_KEYWORDS = {
  'B2B Marketing': ['b2b', 'enterprise', 'account-based', 'abm', 'lead gen', 'demand gen', 'sales enablement', 'whitepaper', 'case study', 'webinar', 'linkedin'],
  'Internal Comms': ['internal', 'comms', 'newsletter', 'all-hands', 'town hall', 'employee', 'culture', 'onboarding', 'intranet', 'announcement'],
  'Rev Ops': ['rev ops', 'revenue', 'operations', 'hubspot', 'salesforce', 'crm', 'pipeline', 'forecast', 'attribution', 'analytics', 'reporting', 'dashboard'],
  'B2C Marketing': ['b2c', 'consumer', 'social media', 'instagram', 'tiktok', 'influencer', 'brand', 'campaign', 'creative', 'content marketing', 'seo', 'paid media']
};

// === State ===
let tasks = [];
let filters = { department: 'all', priority: 'all', search: '', sort: 'due-date', statFilter: 'none' };
let pendingAttachments = []; // temp attachments for the add-task form
let pendingLinks = [];       // temp links for the add-task form
let editingTaskId = null;    // null = adding, string = editing
let deleteConfirmId = null;  // track which task is awaiting delete confirm

// === Persistence (API-backed) ===
async function loadTasks() {
  try {
    let url = '/api/tasks';
    if (showMyTasksOnly) url += '?mine=true';
    else if (showMyTeam) url += '?team=true';
    if (activeSubDept) url += (url.includes('?') ? '&' : '?') + `subDept=${encodeURIComponent(activeSubDept)}`;
    tasks = await api('GET', url);
  } catch (err) {
    console.error('Failed to load tasks:', err);
    tasks = [];
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
    alert(`Successfully imported ${count} task${count !== 1 ? 's' : ''} to the cloud!`);
    await loadTasks();
    render();
  } catch (err) {
    alert('Migration failed: ' + err.message + '. Your local tasks are still safe. Try again on next login.');
  }
}

// === Rendering ===
function render() {
  renderStats();
  renderSidebarCounts();
  renderTaskList();
}

function renderStats() {
  const filtered = getFilteredTasks();
  const today = new Date().toISOString().split('T')[0];
  const notStarted = filtered.filter(t => t.status === 'Not Started').length;
  const inProgress = filtered.filter(t => t.status === 'In Progress').length;
  const blocked = filtered.filter(t => t.status === 'Blocked').length;
  const approved = filtered.filter(t => t.status === 'Approved').length;
  const delegated = filtered.filter(t => t.status === 'Delegated').length;
  const overdue = filtered.filter(t => t.status !== 'Completed' && t.status !== 'Delegated' && t.dueDate && t.dueDate < today).length;
  const completed = filtered.filter(t => t.status === 'Completed').length;
  document.getElementById('stat-not-started').textContent = notStarted;
  document.getElementById('stat-in-progress').textContent = inProgress;
  document.getElementById('stat-blocked').textContent = blocked;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-delegated').textContent = delegated;
  document.getElementById('stat-overdue').textContent = overdue;
  document.getElementById('stat-completed').textContent = completed;
}

function renderSidebarCounts() {
  const container = document.getElementById('tasks-subnav');

  // Determine which departments to show
  let visibleDepts;
  if (myProfile && myProfile.role === 'cmo') {
    visibleDepts = DEPARTMENTS;
  } else {
    // Show user's department + any department where they have tasks
    const myDepts = myProfile ? (myProfile.departments || []) : [];
    const deptsWithTasks = new Set(tasks.map(t => t.department));
    visibleDepts = DEPARTMENTS.filter(d => myDepts.includes(d) || deptsWithTasks.has(d));
  }

  let html = '<button class="sidebar-dept-item ' + (filters.department === 'all' && !activeSubDept ? 'active' : '') + '" data-dept="all">All Tasks</button>';
  for (const dept of visibleDepts) {
    const key = DEPT_KEYS[dept];
    const count = tasks.filter(t => t.department === dept && t.status !== 'Completed').length;
    const isActive = filters.department === dept && !activeSubDept;
    const subDepts = SUB_DEPARTMENTS[dept] || [];
    const hasSubs = subDepts.length > 0;
    const deptExpanded = expandedDepts.has(dept);
    html += `<button class="sidebar-dept-item ${isActive ? 'active' : ''}" data-dept="${dept}">
      <span class="dept-dot dept-${key}"></span> ${dept} <span class="sidebar-count">${count}</span>
      ${hasSubs ? `<span class="sidebar-caret-small" data-toggle-dept="${dept}">${deptExpanded ? '&#9662;' : '&#9656;'}</span>` : ''}
    </button>`;
    if (hasSubs && deptExpanded) {
      for (const sub of subDepts) {
        const subCount = tasks.filter(t => t.department === dept && t.subDepartment === sub && t.status !== 'Completed').length;
        const subActive = activeSubDept === sub;
        html += `<button class="sidebar-dept-item sidebar-subdept ${subActive ? 'active' : ''}" data-dept="${dept}" data-subdept="${sub}">
          ${sub} <span class="sidebar-count">${subCount}</span>
        </button>`;
      }
    }
  }
  container.innerHTML = html;

  // Caret toggle handlers
  container.querySelectorAll('[data-toggle-dept]').forEach(caret => {
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const dept = caret.dataset.toggleDept;
      if (expandedDepts.has(dept)) expandedDepts.delete(dept);
      else expandedDepts.add(dept);
      renderSidebarCounts();
    });
  });

  // Department/sub-department click handlers
  container.querySelectorAll('.sidebar-dept-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('[data-toggle-dept]')) return;
      const dept = item.dataset.dept;
      activeSubDept = item.dataset.subdept || null;
      // Auto-expand when clicking a parent dept
      if (!activeSubDept && SUB_DEPARTMENTS[dept] && SUB_DEPARTMENTS[dept].length > 0) {
        expandedDepts.add(dept);
      }
      document.getElementById('filter-department').value = dept;
      applyFilters(!!activeSubDept);
      switchView('tasks');
      closeSidebar();
    });
  });
}

// === View Switching ===
let currentView = 'tasks';

function switchView(view) {
  currentView = view;
  document.getElementById('view-tasks').style.display = view === 'tasks' ? 'block' : 'none';
  document.getElementById('view-notes').style.display = view === 'notes' ? 'flex' : 'none';
  document.getElementById('view-ai').style.display = view === 'ai' ? 'flex' : 'none';
  document.getElementById('view-team').style.display = view === 'team' ? 'block' : 'none';
  document.getElementById('view-notifications').style.display = view === 'notifications' ? 'block' : 'none';
  document.getElementById('view-search').style.display = view === 'search' ? 'block' : 'none';
  document.getElementById('view-features').style.display = view === 'features' ? 'block' : 'none';
  document.querySelectorAll('.sidebar-nav-item').forEach(el => {
    const match = el.dataset.view === view || (el.id === 'btn-open-chat' && view === 'ai') || (el.id === 'btn-notifications' && view === 'notifications');
    el.classList.toggle('active', match);
  });
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
  const dueDateHtml = formatDueDate(task.dueDate, isCompleted);
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
    const name = assignee ? assignee.displayName : (task.assignedTo === (myProfile && myProfile.userId) ? (myProfile.name || 'Me') : 'Me');
    const initials = name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    // Generate a consistent color from the name
    const colors = ['#479FC8', '#DC6B67', '#ABC39B', '#204A65', '#7398A9', '#d4960a', '#2e7d32', '#8e6bbf'];
    const colorIdx = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
    avatarHtml = `<span class="task-avatar" title="${escapeHtml(name)}" style="background:${colors[colorIdx]}">${initials}</span>`;
  }

  return `
    <div class="task-item ${isCompleted ? 'completed' : ''} status-${statusKey} ${isSubtask ? 'subtask-item' : ''}" data-id="${task.id}">
      <select class="status-select status-${statusKey}" data-action="status" data-id="${task.id}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        ${statusOptions}
      </select>
      ${avatarHtml}
      <div class="task-body" data-action="detail" data-id="${task.id}">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          ${isSubtask ? `<span class="task-parent-label">Part of: ${escapeHtml(task.parentTaskTitle || '...')}</span>` : ''}
          <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
          ${task.subDepartment ? `<span style="font-size:0.65rem;color:var(--color-text-muted);">${escapeHtml(task.subDepartment)}</span>` : ''}
          ${prioDot}
          ${dueDateHtml}
          ${isRecurring ? `<span class="task-recurring" title="${recurringLabel}">&#8635; ${recurringLabel}</span>` : ''}
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

  // Split tasks: active (not approved, not delegated, not completed), approved, delegated, completed
  let activeTasks = filtered.filter(t => t.status !== 'Completed' && t.status !== 'Delegated' && t.status !== 'Approved');
  const approvedTasks = filtered.filter(t => t.status === 'Approved');
  const delegatedTasks = filtered.filter(t => t.status === 'Delegated');
  const completedTasks = getFilteredCompletedTasks();

  // Apply stat filter
  const sf = filters.statFilter;
  if (sf === 'not-started') {
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
    document.getElementById('completed-period').value : 'all';
  let completed = getFilteredTasks().filter(t => t.status === 'Completed');

  if (completedPeriod !== 'all') {
    const now = new Date();
    let cutoff;
    if (completedPeriod === 'week') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
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
  // Links
  html = html.replace(/(https?:\/\/[^\s<>"']+)/g, (url) => {
    const cleanUrl = url.replace(/&amp;/g, '&');
    return `<a href="${cleanUrl}" target="_blank" rel="noopener" class="inline-link">${url}</a>`;
  });
  return html;
}

// === Due Date Formatting ===
function formatDueDate(dueDate, isCompleted) {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  const dateLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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
  return tasks.filter(t => {
    if (filters.department !== 'all' && t.department !== filters.department) return false;
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.notes || '').toLowerCase().includes(q)) return false;
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
async function addTask(title, department, priority, notes, source, attachments, dueDate, recurring, assignedTo, subDepartment) {
  const taskData = {
    title: title.trim(),
    subDepartment: subDepartment || '',
    department,
    priority: priority || 'Medium',
    notes: notes || '',
    status: 'Not Started',
    completedAt: '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
    attachments: attachments || [],
    dueDate: dueDate || '',
    recurring: recurring || 'none'
  };
  if (assignedTo && myProfile && assignedTo !== myProfile.userId) {
    taskData.assignedTo = assignedTo;
    taskData.status = 'Delegated';
  } else if (assignedTo) {
    taskData.assignedTo = assignedTo;
  }

  try {
    const created = await api('POST', '/api/tasks', taskData);
    tasks.unshift(created);
    render();
    return created;
  } catch (err) {
    alert('Failed to create task: ' + err.message);
    return null;
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
    if (newStatus === 'Completed' && task.recurring && task.recurring !== 'none') {
      const nextDue = getNextDueDate(task.dueDate, task.recurring);
      await addTask(
        task.title,
        task.department,
        task.priority,
        task.notes,
        'manual',
        task.attachments || [],
        nextDue,
        task.recurring
      );
    }
  } catch (err) {
    await loadTasks();
    render();
    alert('Failed to update status: ' + err.message);
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
    alert('Failed to delete task: ' + err.message);
  }
}

// === Edit Task ===
function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  closeModal('modal-detail');
  editingTaskId = id;

  document.getElementById('input-title').value = task.title;
  document.getElementById('input-department').value = task.department;
  document.getElementById('input-priority').value = task.priority;
  document.getElementById('input-due-date').value = task.dueDate || '';
  document.getElementById('input-notes').value = task.notes || '';
  document.getElementById('input-recurring').value = task.recurring || 'none';
  updateSubDeptDropdown();
  document.getElementById('input-sub-department').value = task.subDepartment || '';
  document.getElementById('input-assign-to').value = task.assignedTo || '';

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
  document.getElementById('modal-add-title').textContent = 'Add Task';
  document.getElementById('btn-submit-task').textContent = 'Add Task';
  pendingAttachments = [];
  pendingLinks = [];
  renderPendingAttachments();
  renderPendingLinks();

  // Context-aware: pre-fill department from user's profile
  const deptSelect = document.getElementById('input-department');
  if (myProfile && myProfile.role !== 'cmo' && myProfile.departments && myProfile.departments.length > 0) {
    deptSelect.value = myProfile.departments[0];
  }
  updateSubDeptDropdown();

  // Pre-fill sub-department if user only has one
  if (myProfile && myProfile.subDepartments && myProfile.subDepartments.length === 1) {
    document.getElementById('input-sub-department').value = myProfile.subDepartments[0];
  }
}

function updateSubDeptDropdown() {
  const dept = document.getElementById('input-department').value;
  const subSelect = document.getElementById('input-sub-department');
  const subs = SUB_DEPARTMENTS[dept] || [];
  subSelect.innerHTML = '<option value="">General</option>' +
    subs.map(s => `<option value="${s}">${s}</option>`).join('');
}

// === Attachment Handling ===
function handleFiles(files) {
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024) {
      alert(`File "${file.name}" is too large (max 2MB). Use a link instead.`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAttachments.push({
        type: 'file',
        name: file.name,
        data: reader.result
      });
      renderPendingAttachments();
    };
    reader.readAsDataURL(file);
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

  // Build assignee dropdown options
  const assignOptions = '<option value="">Me</option>' + teamMembers
    .filter(m => m.status === 'active' || !m.status)
    .map(m => `<option value="${m.userId}" ${m.userId === task.assignedTo ? 'selected' : ''}>${escapeHtml(m.displayName)}</option>`)
    .join('');

  let attachmentsHtml = '';
  if (task.attachments && task.attachments.length > 0) {
    const items = task.attachments.map(a => {
      if (a.type === 'file') {
        return `<li><a href="${a.data}" download="${escapeHtml(a.name)}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> ${escapeHtml(a.name)}</a></li>`;
      } else {
        return `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> ${escapeHtml(a.name || a.url)}</a></li>`;
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
  const parentContext = isSubtask ? `
    <div style="background: var(--color-b2b-light); border-radius: var(--radius); padding: 0.625rem 0.875rem; margin-bottom: 1rem; font-size: 0.85rem;">
      <div style="font-size: 0.7rem; font-weight: 700; text-transform: uppercase; color: var(--follett-dark-blue); margin-bottom: 0.25rem;">Part of</div>
      <strong>${escapeHtml(task.parentTaskTitle || 'Parent Task')}</strong>
      ${task.parentTaskNotes ? `<div style="margin-top: 0.375rem; font-size: 0.8rem; color: var(--color-text-muted); white-space: pre-wrap;">${escapeHtmlWithLinks(task.parentTaskNotes.substring(0, 500))}</div>` : ''}
    </div>` : '';

  document.getElementById('detail-content').innerHTML = `
    ${parentContext}
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; margin-bottom: 1rem;">
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
        <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
        ${task.subDepartment ? `<span style="font-size:0.8rem;color:var(--color-text-muted);margin-left:0.25rem;">${escapeHtml(task.subDepartment)}</span>` : ''}
      </div>
      <div>
        <div class="detail-section-title">Due Date</div>
        ${task.dueDate ? `<span>${formatDueDate(task.dueDate, task.status === 'Completed')} ${new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : '<span style="color:var(--color-text-light);font-size:0.85rem;">Not set</span>'}
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

    ${task.blockedReason ? `<div style="background:var(--color-medium-light);border-radius:var(--radius);padding:0.625rem 0.875rem;margin-bottom:0.75rem;font-size:0.85rem;"><strong style="color:#a17508;">Blocked:</strong> ${escapeHtml(task.blockedReason)}</div>` : ''}
    ${task.notes ? `<div class="detail-section"><div class="detail-section-title">Notes</div><div class="detail-notes">${escapeHtmlWithLinks(task.notes)}</div></div>` : ''}
    ${attachmentsHtml}
    ${task.completedAt ? `<div style="font-size:0.8rem;color:var(--color-text-light);margin-bottom:0.75rem;">Completed ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>` : ''}

    <div class="detail-section" id="detail-subtasks">
      <div class="detail-section-title" style="display:flex;justify-content:space-between;align-items:center;">
        Sub-tasks
        <button class="btn btn-ghost btn-sm" onclick="showSubtaskForm('${task.id}', '${escapeHtml(task.department)}')" id="btn-show-subtask-form" style="font-size:0.75rem;">+ Add Sub-task</button>
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
      <div style="display:flex;gap:0.375rem;margin-top:0.5rem;">
        <input type="text" id="comment-input" placeholder="Add a comment or link..." style="flex:1;padding:0.4rem 0.6rem;border:1px solid var(--color-border);border-radius:var(--radius);font-size:0.85rem;font-family:'Roboto',sans-serif;">
        <button class="btn btn-primary btn-sm" onclick="addComment('${task.id}')">Post</button>
      </div>
    </div>

    <div class="detail-actions">
      ${(myProfile && task.createdBy && task.createdBy !== myProfile.userId && task.status !== 'Approved' && task.status !== 'Completed') ? `<button class="btn btn-primary" onclick="approveAndReturn('${task.id}', '${task.createdBy}')" style="background:#2e7d32;">&#10003; Approve</button><button class="btn btn-secondary" onclick="needsRevision('${task.id}', '${task.createdBy}')" style="color:var(--follett-coral);border-color:var(--follett-coral);">&#8617; Needs Revision</button>` : ''}
      <button class="btn btn-primary" onclick="editTask('${task.id}')">Edit Task</button>
    </div>
  `;
  openModal('modal-detail');
  loadSubtasks(task.id);
  loadComments(task.id);
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
        <div style="margin-top:0.25rem;font-size:0.85rem;line-height:1.5;">${escapeHtmlWithLinks(c.text)}</div>
      </div>`;
    }).join('');
  } catch { document.getElementById('comments-list').innerHTML = '<span style="color:var(--color-text-light);font-size:0.8rem;">Failed to load comments</span>'; }
}

async function addComment(taskId) {
  const input = document.getElementById('comment-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await api('POST', `/api/tasks/${taskId}/comments`, { text });
    input.value = '';
    loadComments(taskId);
  } catch (err) { alert('Failed to post comment: ' + err.message); }
}

// Enter key to post comment
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'comment-input' && e.key === 'Enter') {
    const taskId = e.target.closest('#detail-comments') ? document.querySelector('[onclick*="addComment"]').getAttribute('onclick').match(/'([^']+)'/)[1] : null;
    if (taskId) addComment(taskId);
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
    await loadTasks();
    render();
    // Refresh the detail view
    showTaskDetail(taskId);
  } catch (err) { alert('Failed to update status: ' + err.message); }
}

async function approveAndReturn(taskId, createdBy) {
  try {
    await api('PUT', `/api/tasks/${taskId}`, { status: 'Approved', assignedTo: createdBy });
    closeModal('modal-detail');
    await loadTasks();
    render();
  } catch (err) { alert('Failed to approve: ' + err.message); }
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
  } catch (err) { alert('Failed to send back: ' + err.message); }
}

async function reassignTask(taskId, newAssignee) {
  try {
    const updates = { assignedTo: newAssignee || undefined };
    if (newAssignee && newAssignee !== myProfile.userId) updates.status = 'Delegated';
    await api('PUT', `/api/tasks/${taskId}`, updates);
    await loadTasks();
    render();
  } catch (err) { alert('Failed to reassign: ' + err.message); }
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
      const assignLabel = assignName ? ` &middot; ${escapeHtml(assignName.displayName)}` : '';
      const dueLabel = s.dueDate ? ` &middot; Due ${s.dueDate}` : '';
      return `<div style="display:flex;align-items:center;gap:0.5rem;padding:0.375rem 0;border-bottom:1px solid var(--color-border);">
        <button class="task-check ${isComplete ? 'checked' : ''}" onclick="toggleSubtask('${s.id}', '${s.status}')" style="width:18px;height:18px;font-size:0.6rem;">${isComplete ? '&#10003;' : ''}</button>
        <div style="flex:1;">
          <span style="font-size:0.85rem;${isComplete ? 'text-decoration:line-through;opacity:0.5;' : ''}">${escapeHtml(s.title)}</span>
          <span style="font-size:0.7rem;color:var(--color-text-light);">${assignLabel}${dueLabel}</span>
        </div>
      </div>`;
    }).join('');
  } catch (err) { document.getElementById('subtask-list').textContent = 'Failed to load'; }
}

async function toggleSubtask(subtaskId, currentStatus) {
  const newStatus = currentStatus === 'Completed' ? 'Not Started' : 'Completed';
  try {
    await api('PUT', `/api/tasks/${subtaskId}`, {
      status: newStatus,
      completed: newStatus === 'Completed',
      completedAt: newStatus === 'Completed' ? new Date().toISOString() : ''
    });
    // Reload the detail view to refresh counts
    const parentDetail = document.getElementById('detail-subtasks');
    if (parentDetail) {
      const parentBtn = parentDetail.querySelector('[onclick*="addSubtask"]');
      if (parentBtn) {
        const parentId = parentBtn.getAttribute('onclick').match(/'([^']+)'/)[1];
        loadSubtasks(parentId);
      }
    }
    // Refresh main task list for updated counts
    await loadTasks();
    render();
  } catch (err) { alert('Failed to update sub-task: ' + err.message); }
}

async function submitSubtask(parentId, department) {
  const title = document.getElementById('subtask-title').value.trim();
  if (!title) return;
  const assignedTo = document.getElementById('subtask-assign').value || undefined;
  const dueDate = document.getElementById('subtask-due').value || '';
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
  } catch (err) { alert('Failed to create sub-task: ' + err.message); }
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
          alert(`Connected to ${status.email}! Click "Sync Email" to import messages.`);
        }
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 300000);
    } catch (err) {
      alert('Failed to start Gmail authorization: ' + err.message);
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
      alert(`Synced ${result.synced} new email${result.synced !== 1 ? 's' : ''} as tasks!`);
    } else {
      alert('No new unread emails to sync.');
    }
  } catch (err) {
    alert('Sync failed: ' + err.message);
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

  // Categorize folders: special (All Team, Marketing Leaders, Personal) vs department-based
  const specialNames = ['All Team', 'Marketing Leaders', 'Personal'];
  const specialFolders = folders.filter(f => specialNames.includes(f.name));
  const deptFolders = folders.filter(f => !specialNames.includes(f.name));

  // Map sub-department folders to their parent dept
  const foldersByDept = {};
  for (const dept of DEPARTMENTS) {
    const subs = SUB_DEPARTMENTS[dept] || [];
    foldersByDept[dept] = deptFolders.filter(f => subs.includes(f.name) || f.name === dept);
  }
  // Any folders not matched
  const unmatchedFolders = deptFolders.filter(f => !Object.values(foldersByDept).flat().includes(f));

  let html = '';

  // Special folders first
  specialFolders.forEach(f => {
    html += `<button class="sidebar-dept-item ${activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`;
  });

  // Department groups with carets
  for (const dept of DEPARTMENTS) {
    if (dept === 'Personal') continue; // Already in special
    const deptFolder = deptFolders.find(f => f.name === dept);
    const subFolders = (SUB_DEPARTMENTS[dept] || []).map(sub => deptFolders.find(f => f.name === sub)).filter(Boolean);
    const hasSubs = subFolders.length > 0;
    const expanded = expandedNoteDepts.has(dept);

    html += `<button class="sidebar-dept-item ${deptFolder && activeFolderId === deptFolder.id ? 'active' : ''}" data-folder-id="${deptFolder ? deptFolder.id : ''}" data-note-dept="${dept}">
      ${dept}
      ${hasSubs ? `<span class="sidebar-caret-small" data-toggle-note-dept="${dept}">${expanded ? '&#9662;' : '&#9656;'}</span>` : ''}
    </button>`;

    if (hasSubs && expanded) {
      subFolders.forEach(f => {
        html += `<button class="sidebar-dept-item sidebar-subdept ${activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`;
      });
    }
  }

  // Unmatched folders
  unmatchedFolders.forEach(f => {
    html += `<button class="sidebar-dept-item ${activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`;
  });

  container.innerHTML = html;

  // Caret toggle handlers
  container.querySelectorAll('[data-toggle-note-dept]').forEach(caret => {
    caret.addEventListener('click', (e) => {
      e.stopPropagation();
      const dept = caret.dataset.toggleNoteDept;
      if (expandedNoteDepts.has(dept)) expandedNoteDepts.delete(dept);
      else expandedNoteDepts.add(dept);
      renderSidebarFolders();
    });
  });
  container.querySelectorAll('[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Save any pending note before switching
      if (saveTimeout && activeNoteId) {
        clearTimeout(saveTimeout);
        await api('PUT', `/api/notes/${activeNoteId}`, {
          title: document.getElementById('editor-title').value || 'Untitled',
          content: document.getElementById('editor-content').innerHTML
        }).catch(() => {});
      }
      activeNoteId = null;
      document.getElementById('notes-editor-panel').style.display = 'none';
      document.getElementById('notes-no-selection').style.display = 'flex';
      activeFolderId = btn.dataset.folderId || null;
      switchView('notes');
      loadNotesList(activeFolderId);
      renderSidebarFolders();
      const folder = activeFolderId ? folders.find(f => f.id === activeFolderId) : null;
      document.getElementById('notes-folder-title').textContent = folder ? folder.name : 'Notes';
      closeSidebar();
    });
  });
}

async function loadNotesList(folderId) {
  try {
    let url = folderId ? `/api/notes?folderId=${folderId}` : '/api/notes';
    if (showMyNotesOnly) url += (url.includes('?') ? '&' : '?') + 'mine=true';
    notesList = await api('GET', url);
    renderNotesList();
    loadArchivedNotes();
  } catch (err) { notesList = []; renderNotesList(); }
}

function renderNotesList() {
  const container = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  if (notesList.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const canPin = myProfile && (myProfile.role === 'cmo' || myProfile.role === 'lead');
  container.innerHTML = notesList.map(n => {
    const date = new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isOwn = myProfile && n.createdBy === myProfile.userId;
    const authorLabel = isOwn ? '' : ` &middot; ${escapeHtml(n.authorName || 'Unknown')}`;
    const pinSvg = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M9 2h6l-1 7h-4L9 2z"/><path d="M5 14h14l-2-5H7l-2 5z"/></svg>';
    const pinIcon = n.pinned ? pinSvg : '';
    const pinBtn = (canPin || isOwn) ? `<span class="note-pin-btn ${n.pinned ? 'pinned' : ''}" data-pin-id="${n.id}" title="${n.pinned ? 'Unpin' : 'Pin to top'}">${pinSvg}</span>` : (n.pinned ? `<span class="note-pin-icon">${pinSvg}</span>` : '');
    return `<button class="note-list-item ${activeNoteId === n.id ? 'active' : ''} ${n.pinned ? 'note-pinned' : ''}" data-note-id="${n.id}">
      <div class="note-list-item-title">${pinIcon ? '' : ''}${escapeHtml(n.title || 'Untitled')}</div>
      <div class="note-list-item-date">${date}${authorLabel} ${pinBtn}</div>
    </button>`;
  }).join('');
  container.querySelectorAll('[data-note-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Don't open note if clicking pin button
      if (e.target.closest('.note-pin-btn')) return;
      openNote(btn.dataset.noteId);
    });
  });

  // Pin button handlers
  container.querySelectorAll('.note-pin-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const noteId = btn.dataset.pinId;
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
    });
  });
}

async function openNote(noteId) {
  try {
    const note = await api('GET', `/api/notes/${noteId}`);
    activeNoteId = noteId;
    document.getElementById('editor-title').value = note.title || '';
    document.getElementById('editor-content').innerHTML = note.content || '';
    document.getElementById('notes-editor-panel').style.display = 'flex';
    document.getElementById('notes-no-selection').style.display = 'none';
    document.getElementById('editor-saved').textContent = '';
    document.getElementById('note-ai-panel').style.display = 'none';
    noteAiHistory = [];

    // Check if user can edit this note (creator or CMO)
    const canEdit = myProfile && (myProfile.role === 'cmo' || note.createdBy === myProfile.userId);
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
    folderSelect.innerHTML = folders.map(f =>
      `<option value="${f.id}" ${f.id === note.folderId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`
    ).join('');

    renderNotesList();
  } catch (err) { alert('Failed to open note: ' + err.message); }
}

async function createNote() {
  if (!activeFolderId && folders.length > 0) activeFolderId = folders[0].id;
  try {
    const note = await api('POST', '/api/notes', { title: 'Untitled', content: '', folderId: activeFolderId || '' });
    notesList.unshift(note);
    renderNotesList();
    openNote(note.id);
  } catch (err) { alert('Failed to create note: ' + err.message); }
}

function autoLinkUrls(element) {
  // Find text nodes containing URLs that aren't already inside <a> tags
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
  const urlRegex = /(https?:\/\/[^\s<>"']+)/g;
  const nodesToProcess = [];

  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.tagName === 'A') continue;
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
  } catch (err) { alert('Failed to delete note: ' + err.message); }
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
  } catch (err) { alert('Failed to archive: ' + err.message); }
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
  } catch (err) { alert('Failed to create folder: ' + err.message); }
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
      alert('Upload failed: ' + err.message);
    }
  }
  status.style.display = 'none';
  renderNoteLinks(true);
  await saveNoteLinks();
}

async function downloadFile(gcsPath) {
  try {
    const result = await api('GET', `/api/file-url?path=${encodeURIComponent(gcsPath)}`);
    window.open(result.url, '_blank');
  } catch (err) {
    alert('Failed to get download link: ' + err.message);
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

  try {
    await api('PUT', `/api/notes/${activeNoteId}`, { sharedWith });
    closeModal('modal-share-note');
    const count = sharedWith.length;
    alert(count > 0 ? `Note shared with ${count} ${count === 1 ? 'recipient' : 'recipients'}.` : 'Note is now private.');
  } catch (err) {
    alert('Failed to save sharing: ' + err.message);
  }
}


// === AI Features ===
// Note AI Chat
let noteAiHistory = [];

function toggleNoteAi() {
  const panel = document.getElementById('note-ai-panel');
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    noteAiHistory = [];
    document.getElementById('note-ai-messages').innerHTML = '';
    document.getElementById('note-ai-input').focus();
  } else {
    panel.style.display = 'none';
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
  if (!activeNoteId) return;
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
      alert('No actionable tasks found in this note.');
      return;
    }

    const deptOptions = DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join('');
    const prioOptions = ['High', 'Medium', 'Low'].map(p => `<option value="${p}">${p}</option>`).join('');
    const assignOptions = '<option value="">Me</option>' + teamMembers.filter(m => m.status === 'active' || !m.status).map(m =>
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
    alert(`Created ${totalCreated} task${totalCreated !== 1 ? 's' : ''}!`);
  } catch (err) {
    alert('Failed to create tasks: ' + err.message);
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
  await migrateLocalStorage();

  // Add Task button
  document.getElementById('btn-add-task').addEventListener('click', () => {
    resetAddForm();
    openModal('modal-add');
  });

  // Quick Add (AI-powered)
  document.getElementById('btn-quick-import').addEventListener('click', () => {
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
      document.getElementById('parsed-title').value = parsed.title || text;
      document.getElementById('parsed-dept').value = parsed.department || 'Personal';
      // Populate sub-dept dropdown based on parsed department
      const parsedSubSelect = document.getElementById('parsed-subdept');
      const parsedSubs = SUB_DEPARTMENTS[parsed.department] || [];
      parsedSubSelect.innerHTML = '<option value="">General</option>' + parsedSubs.map(s => `<option value="${s}">${s}</option>`).join('');
      if (parsed.subDepartment) parsedSubSelect.value = parsed.subDepartment;
      document.getElementById('parsed-priority').value = parsed.priority || 'Medium';
      document.getElementById('parsed-due').value = parsed.dueDate || '';
      document.getElementById('parsed-recurring').value = parsed.recurring || 'none';
      document.getElementById('parsed-notes').value = parsed.notes || '';
      if (parsed.assignedTo) document.getElementById('parsed-assign').value = parsed.assignedTo;
      document.getElementById('ai-parsed-task').style.display = 'block';
    } catch (err) {
      alert('AI parsing failed: ' + err.message);
    }
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none" style="vertical-align:-1px;"><path d="M12 0l1.8 7.6L22 8l-6.4 4.2L18 20l-6-4.8L6 20l2.4-7.8L2 8l8.2-.4z"/></svg> Create Task';
    btn.disabled = false;
  });

  // Update sub-dept when parsed dept changes
  document.getElementById('parsed-dept').addEventListener('change', () => {
    const dept = document.getElementById('parsed-dept').value;
    const subSelect = document.getElementById('parsed-subdept');
    const subs = SUB_DEPARTMENTS[dept] || [];
    subSelect.innerHTML = '<option value="">General</option>' + subs.map(s => `<option value="${s}">${s}</option>`).join('');
  });

  // Create parsed task button
  document.getElementById('btn-create-parsed-task').addEventListener('click', async () => {
    const title = document.getElementById('parsed-title').value.trim();
    if (!title) return;
    const dept = document.getElementById('parsed-dept').value;
    const subDept = document.getElementById('parsed-subdept').value || '';
    const priority = document.getElementById('parsed-priority').value;
    const dueDate = document.getElementById('parsed-due').value;
    const recurring = document.getElementById('parsed-recurring').value;
    const assignedTo = document.getElementById('parsed-assign').value || undefined;
    const notes = document.getElementById('parsed-notes').value.trim();

    await addTask(title, dept, priority, notes, 'manual', [], dueDate, recurring, assignedTo, subDept);
    closeModal('modal-import');
  });

  // Sync Email / Connect Gmail button
  document.getElementById('btn-sync-email').addEventListener('click', handleSyncClick);
  checkGmailStatus();

  // (Old import form handlers removed — replaced by AI Quick Add above)

  // Add/Edit task form submit
  document.getElementById('form-add-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('input-title').value.trim();
    const department = document.getElementById('input-department').value;
    const priority = document.getElementById('input-priority').value;
    const notes = document.getElementById('input-notes').value.trim();
    const dueDate = document.getElementById('input-due-date').value;
    const recurring = document.getElementById('input-recurring').value;
    const subDepartment = document.getElementById('input-sub-department').value || '';
    const assignTo = document.getElementById('input-assign-to').value || undefined;

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];

    if (editingTaskId) {
      const updates = { title, department, subDepartment, priority, notes, dueDate, recurring, attachments: allAttachments };
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
        alert('Failed to update task: ' + err.message);
      }
    } else {
      await addTask(title, department, priority, notes, 'manual', allAttachments, dueDate, recurring, assignTo, subDepartment);
    }

    closeModal('modal-add');
    resetAddForm();
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

  // Sidebar navigation
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      switchView(view);
      // Toggle subnav
      if (view === 'tasks') toggleSidebarSection('tasks-subnav', 'tasks-caret');
      if (view === 'notes') {
        toggleSidebarSection('notes-subnav', 'notes-caret');
        // Default to All Team folder
        const allTeamFolder = folders.find(f => f.name === 'All Team');
        if (allTeamFolder && !activeFolderId) {
          activeFolderId = allTeamFolder.id;
        }
        loadNotesList(activeFolderId);
        renderSidebarFolders();
        const activeFolder = folders.find(f => f.id === activeFolderId);
        document.getElementById('notes-folder-title').textContent = activeFolder ? activeFolder.name : 'Notes';
      }
      closeSidebar();
    });
  });

  // Sidebar department clicks (filter tasks)
  document.querySelectorAll('.sidebar-dept-item').forEach(item => {
    item.addEventListener('click', () => {
      const dept = item.dataset.dept;
      document.getElementById('filter-department').value = dept;
      applyFilters();
      switchView('tasks');
      closeSidebar();
    });
  });

  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Notes event listeners
  document.getElementById('btn-new-note').addEventListener('click', createNote);

  // My Notes / All Notes toggle
  document.getElementById('btn-my-notes').addEventListener('click', () => {
    showMyNotesOnly = true;
    document.getElementById('btn-my-notes').classList.add('active');
    document.getElementById('btn-all-notes').classList.remove('active');
    loadNotesList(activeFolderId);
  });
  document.getElementById('btn-all-notes').addEventListener('click', () => {
    showMyNotesOnly = false;
    document.getElementById('btn-all-notes').classList.add('active');
    document.getElementById('btn-my-notes').classList.remove('active');
    loadNotesList(activeFolderId);
  });
  document.getElementById('btn-delete-note').addEventListener('click', deleteNote);
  document.getElementById('btn-archive-note').addEventListener('click', archiveNote);
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
      await api('PUT', `/api/notes/${activeNoteId}`, { folderId: e.target.value });
      document.getElementById('editor-saved').textContent = 'Moved';
      // Update the note in the local list
      const item = notesList.find(n => n.id === activeNoteId);
      if (item) item.folderId = e.target.value;
    } catch (err) { alert('Failed to move note: ' + err.message); }
  });
  document.getElementById('btn-save-share').addEventListener('click', saveSharing);
  document.getElementById('btn-add-folder').addEventListener('click', createFolder);
  document.getElementById('editor-title').addEventListener('input', scheduleAutoSave);
  document.getElementById('editor-content').addEventListener('input', scheduleAutoSave);

  // Make links clickable in editor (Ctrl/Cmd+click when editing, regular click when read-only)
  document.getElementById('editor-content').addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;
    const isEditable = document.getElementById('editor-content').contentEditable === 'true';
    if (!isEditable || e.metaKey || e.ctrlKey) {
      e.preventDefault();
      window.open(link.href, '_blank', 'noopener');
    }
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

  // Team (CMO only)
  document.getElementById('btn-invite-member') && document.getElementById('btn-invite-member').addEventListener('click', inviteMember);
  document.getElementById('form-invite') && document.getElementById('form-invite').addEventListener('submit', submitInvite);
  document.querySelectorAll('[data-view="team"]').forEach(btn => {
    btn.addEventListener('click', () => { showTeamView(); closeSidebar(); });
  });

  // My Tasks / All Tasks toggle
  function setTaskToggle(mode) {
    showMyTasksOnly = mode === 'mine';
    showMyTeam = mode === 'team';
    document.getElementById('btn-my-tasks').classList.toggle('active', mode === 'mine');
    document.getElementById('btn-my-team').classList.toggle('active', mode === 'team');
    document.getElementById('btn-all-tasks').classList.toggle('active', mode === 'all');
    loadTasks().then(render);
  }
  document.getElementById('btn-my-tasks').addEventListener('click', () => setTaskToggle('mine'));
  document.getElementById('btn-my-team').addEventListener('click', () => setTaskToggle('team'));
  document.getElementById('btn-all-tasks').addEventListener('click', () => setTaskToggle('all'));

  // Department change updates sub-department dropdown
  document.getElementById('input-department').addEventListener('change', updateSubDeptDropdown);

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
    btn.addEventListener('click', () => sendNoteAiMessage(btn.dataset.prompt));
  });
  document.getElementById('ai-panel-close').addEventListener('click', hideAiPanel);
  document.getElementById('btn-create-ai-tasks').addEventListener('click', createAiTasks);

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

  // Delegated section toggle
  document.getElementById('approved-toggle').addEventListener('click', () => {
    const list = document.getElementById('approved-list');
    const toggle = document.getElementById('approved-toggle');
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'flex' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });

  document.getElementById('delegated-toggle').addEventListener('click', () => {
    const list = document.getElementById('delegated-list');
    const toggle = document.getElementById('delegated-toggle');
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'flex' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });

  // Completed section toggle
  document.getElementById('completed-toggle').addEventListener('click', () => {
    const list = document.getElementById('completed-list');
    const toggle = document.getElementById('completed-toggle');
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'flex' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });

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
let activeSubDept = null;
let expandedDepts = new Set();
let teamMembers = [];

function applyRoleUI() {
  if (!myProfile) return;
  const r = myProfile.role;
  document.getElementById('sidebar-team-section').style.display = (r === 'cmo' || r === 'lead') ? 'block' : 'none';
  document.getElementById('btn-sync-email').style.display = r === 'cmo' ? '' : 'none';
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
    const unread = allNotifications.filter(n => !n.read);
    const badge = document.getElementById('notif-badge');
    if (unread.length > 0) {
      badge.textContent = unread.length;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
    return allNotifications;
  } catch { return []; }
}

async function showNotifications() {
  switchView('notifications');
  await loadNotifications();
  const container = document.getElementById('notifications-list');
  const empty = document.getElementById('notifications-empty');
  if (allNotifications.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  container.innerHTML = allNotifications.map(n => {
    const ago = timeAgo(n.createdAt);
    const unreadClass = n.read ? 'notif-read' : 'notif-unread';
    return `<div class="notif-item ${unreadClass}" data-notif-id="${n.id}" data-task-id="${n.taskId || ''}">
      <div class="notif-item-title">${escapeHtml(n.title)}</div>
      <div class="notif-item-time">${ago}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      // Mark as read when clicked
      if (item.classList.contains('notif-unread')) {
        await api('POST', `/api/notifications/${item.dataset.notifId}/read`).catch(() => {});
        item.classList.remove('notif-unread');
        item.classList.add('notif-read');
        loadNotifications(); // Update badge count
      }
      if (item.dataset.taskId) { showTaskDetail(item.dataset.taskId); }
    });
  });
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
  select.innerHTML = '<option value="">Me (default)</option>' +
    teamMembers.filter(m => m.status === 'active' || !m.status).map(m =>
      `<option value="${m.userId}">${escapeHtml(m.displayName)} (${(m.departments || [m.department]).join(', ')})</option>`
    ).join('');
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

  for (const dept of DEPARTMENTS) {
    const members = deptGroups[dept];
    if (!members || members.length === 0) continue;

    // Sort: leads first, then by name
    members.sort((a, b) => {
      if (a.role === 'cmo') return -1;
      if (b.role === 'cmo') return 1;
      if (a.role === 'lead' && b.role !== 'lead') return -1;
      if (b.role === 'lead' && a.role !== 'lead') return 1;
      return (a.displayName || '').localeCompare(b.displayName || '');
    });

    html += `<div style="margin-bottom:1rem;">
      <div style="font-size:0.7rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;color:var(--follett-dark-blue);margin-bottom:0.375rem;padding-bottom:0.25rem;border-bottom:1px solid var(--color-border);">${dept} <span style="font-weight:400;color:var(--color-text-muted);">(${members.length})</span></div>`;

    members.forEach(m => {
      const reportsToMember = m.reportsTo ? teamMembers.find(t => t.userId === m.reportsTo) : null;
      const reportsLabel = reportsToMember ? `Reports to: ${escapeHtml(reportsToMember.displayName)}` : '';
      const roleLabel = m.role === 'cmo' ? 'CMO' : m.role === 'lead' ? 'Dept Lead' : m.role === 'viewer' ? 'Viewer' : 'Member';
      const indent = reportsToMember ? 'padding-left:1.25rem;' : '';

      html += `<div class="team-member-card" style="${indent}">
        <div class="team-member-info">
          <div class="team-member-name">${escapeHtml(m.displayName)} <span style="font-size:0.7rem;color:var(--color-text-muted);font-weight:400;">${roleLabel}</span></div>
          <div class="team-member-meta">${escapeHtml(m.email)}${reportsLabel ? ` · ${reportsLabel}` : ''}</div>
        </div>
        <div class="team-member-actions">
          ${canManage(m) && m.role !== 'cmo' ? `<button class="btn btn-ghost btn-sm" onclick="showPrepOneOnOne('${m.userId}')">Prep 1:1</button>` : ''}
          ${canManage(m) ? `<button class="btn btn-ghost btn-sm" onclick="editMember('${m.id}')">Edit</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--follett-coral);" onclick="deleteMember('${m.id}', '${escapeHtml(m.displayName)}')">Remove</button>` : ''}
        </div>
      </div>`;
    });
    html += '</div>';
  }

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
    alert('Failed to impersonate: ' + err.message);
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
  const subDepartments = [];
  document.querySelectorAll('.invite-subdept-cb:checked').forEach(cb => subDepartments.push(cb.value));
  const role = document.getElementById('invite-role').value;
  const reportsTo = document.getElementById('invite-reports-to').value;

  if (!name || !email || departments.length === 0) { alert('Select at least one department'); return; }

  try {
    const result = await api('POST', '/api/team/invite', { email, displayName: name, departments, subDepartments, role, reportsTo });
    // Show success with the reset link
    document.getElementById('form-invite').style.display = 'none';
    document.getElementById('invite-result').style.display = 'block';
    document.getElementById('invite-result-text').textContent = `Send this link to ${name} so they can set their password and log in:`;

    document.getElementById('btn-copy-invite-link').onclick = () => {
      navigator.clipboard.writeText(result.resetLink).then(() => {
        document.getElementById('btn-copy-invite-link').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('btn-copy-invite-link').textContent = 'Copy Link'; }, 2000);
      });
    };

    showTeamView();
  } catch (err) { alert('Failed to add member: ' + err.message); }
}

async function disableMember(id) {
  if (!confirm('Disable this team member? They will lose access immediately.')) return;
  try { await api('POST', `/api/team/${id}/disable`); showTeamView(); } catch (err) { alert(err.message); }
}

async function enableMember(id) {
  try { await api('POST', `/api/team/${id}/enable`); showTeamView(); } catch (err) { alert(err.message); }
}

async function editMember(id) {
  const member = teamMembers.find(m => m.id === id);
  if (!member) return;
  const memberDepts = member.departments || [member.department];
  const memberSubDepts = member.subDepartments || [];

  const deptCheckboxes = DEPARTMENTS.map(d =>
    `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.25rem 0;">
      <input type="checkbox" class="edit-dept-cb" value="${d}" ${memberDepts.includes(d) ? 'checked' : ''}> ${d}
    </label>`
  ).join('');

  // Build sub-department checkboxes grouped by parent dept
  let subDeptCheckboxes = '';
  for (const dept of DEPARTMENTS) {
    const subs = SUB_DEPARTMENTS[dept] || [];
    if (subs.length === 0) continue;
    subDeptCheckboxes += `<div style="margin-top:0.25rem;font-size:0.75rem;color:var(--color-text-muted);font-weight:600;">${dept}:</div>`;
    subs.forEach(s => {
      subDeptCheckboxes += `<label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;padding:0.15rem 0;padding-left:0.5rem;">
        <input type="checkbox" class="edit-subdept-cb" value="${s}" ${memberSubDepts.includes(s) ? 'checked' : ''}> ${s}
      </label>`;
    });
  }

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
      ${subDeptCheckboxes ? `<div style="margin-bottom:0.5rem;"><strong style="font-size:0.75rem;text-transform:uppercase;color:var(--follett-dark-blue);">Sub-Departments:</strong><br>${subDeptCheckboxes}</div>` : ''}
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
  const subDepartments = [];
  document.querySelectorAll('.edit-subdept-cb:checked').forEach(cb => subDepartments.push(cb.value));
  const role = document.getElementById('edit-role').value;
  const reportsTo = document.getElementById('edit-reports-to').value;

  if (departments.length === 0) { alert('Select at least one department'); return; }

  try {
    await api('PUT', `/api/team/${id}`, { departments, subDepartments, role, reportsTo });
    showTeamView();
  } catch (err) { alert('Failed to update: ' + err.message); }
}

async function deleteMember(id, name) {
  if (!confirm(`Remove ${name} from the team? This deletes their account entirely so you can re-invite them if needed.`)) return;
  try { await api('DELETE', `/api/team/${id}`); showTeamView(); } catch (err) { alert(err.message); }
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

    container.innerHTML = requests.map(r => {
      const ago = timeAgo(r.createdAt);
      return `<div class="feature-card">
        <div class="feature-votes">
          <button class="feature-vote-btn ${r.myVote === 'up' ? 'voted-up' : ''}" data-vote-id="${r.id}" data-vote="up" title="Upvote"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>
          <span class="feature-score">${r.score}</span>
          <button class="feature-vote-btn ${r.myVote === 'down' ? 'voted-down' : ''}" data-vote-id="${r.id}" data-vote="down" title="Downvote"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z"/><path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button>
        </div>
        <div class="feature-content">
          <div class="feature-summary">${escapeHtml(r.summary)}</div>
          <div class="feature-meta">${escapeHtml(r.requestedByName)} &middot; ${ago}</div>
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
        } catch (err) { alert('Failed to vote: ' + err.message); }
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
    alert('Failed to submit: ' + err.message);
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
      alert('Password reset email sent to ' + email);
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
      loadNotifications();
      try { await showBriefingIfNeeded(); } catch (e) { console.error('[Briefing] Error:', e); }
      // Poll notifications every 60 seconds
      setInterval(loadNotifications, 60000);
    } else {
      currentUser = null;
      authToken = null;
      myProfile = null;
      tasks = [];
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  });

  setInterval(async () => {
    if (currentUser) authToken = await currentUser.getIdToken(true);
  }, 50 * 60 * 1000);
});
