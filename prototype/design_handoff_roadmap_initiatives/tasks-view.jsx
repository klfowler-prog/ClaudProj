/* global React */
const { useState, useMemo } = React;

// Mirrors the original app's task list: header stats, dept cards w/ progress,
// status-grouped list of task-item rows. The only additions are:
//   - an "Initiative" dropdown in Add/Edit
//   - an initiative pill on each task row when one is set
//   - an "Inbox / On a roadmap" filter chip
const TV_DEPT_KEY = { 'Rev Ops':'revops', 'B2B Marketing':'b2b', 'B2C Marketing':'b2c', 'All Marketing':'allmkt', 'Personal':'personal' };
const TV_STATUS_KEY = { 'Backlog':'backlog', 'Not Started':'not-started', 'In Progress':'in-progress', 'Blocked':'blocked', 'Approved':'approved', 'Delegated':'delegated', 'Completed':'completed' };
const TV_DEPTS = ['All Marketing', 'B2B Marketing', 'B2C Marketing', 'Personal', 'Rev Ops'];

const tvParseDate = (s) => new Date(s + 'T00:00:00');
const tvDays = (date, today) => Math.round((tvParseDate(date) - today) / 86400000);
const tvFmtDue = (s, today) => {
  const d = tvDays(s, today);
  if (d < 0) return { txt: `${Math.abs(d)}d overdue`, cls: 'overdue' };
  if (d === 0) return { txt: 'Today', cls: 'due-today' };
  if (d === 1) return { txt: 'Tomorrow', cls: 'due-soon' };
  if (d <= 7) return { txt: `In ${d} days`, cls: 'due-soon' };
  return { txt: tvParseDate(s).toLocaleDateString('en-US',{month:'short',day:'numeric'}), cls: '' };
};

// ---- Task row — matches the existing .task-item pattern ----
function TaskItem({ task, init, people, onClick, onStatusChange, today }) {
  const sk = TV_STATUS_KEY[task.status];
  const due = tvFmtDue(task.due, today);
  const dept = task.department || init?.department;
  const deptKey = TV_DEPT_KEY[dept];
  const owner = people[task.owner];

  return (
    <div className={`task-item status-${sk}`}>
      <select className={`status-select status-${sk}`}
        value={task.status}
        onClick={e=>e.stopPropagation()}
        onChange={e=>onStatusChange(task, e.target.value)}>
        <option>Backlog</option>
        <option>Not Started</option>
        <option>In Progress</option>
        <option>Blocked</option>
        <option>Approved</option>
        <option>Delegated</option>
        <option>Completed</option>
      </select>

      <div className="task-body" onClick={onClick}>
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className={`badge badge-${deptKey}`}>{dept}</span>
          {init && (
            <span className="badge badge-init" title={init.thesis}>
              <span className={`init-pill-dot dept-${TV_DEPT_KEY[init.department]}`}></span>
              {init.name}
            </span>
          )}
          <span className={`badge badge-${task.priority.toLowerCase()}`}>{task.priority}</span>
          {task.source && <span className="task-source">{task.source === 'email' ? '✉ Email' : task.source === 'slack' ? '# Slack' : 'Manual'}</span>}
        </div>
      </div>

      {owner && (
        <span className="task-owner-avatar" title={owner.name}>
          <window.RMAvatar id={task.owner} people={people} size={24}/>
        </span>
      )}
      <span className={`task-due-date ${due.cls}`}>{due.txt}</span>
    </div>
  );
}

// ---- Add/Edit task modal — uses the original .modal / .form-group classes ----
function AddTaskModal({ task, initiatives, people, onClose, onSave, defaultInitiativeId }) {
  const [form, setForm] = useState(() => task ? { ...task } : {
    title:'', department:'B2B Marketing', priority:'Medium', status:'Not Started',
    owner:'GA', due: window.ROADMAP_DATA.today,
    initiativeId: defaultInitiativeId || '', source:'manual', notes:'',
  });
  const set = (k,v) => setForm(f => ({ ...f, [k]: v }));

  const handleInit = (id) => {
    const init = initiatives.find(i => i.id === id);
    setForm(f => ({ ...f, initiativeId: id, department: init ? init.department : f.department }));
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e=>e.stopPropagation()}>
        <div className="modal-header">
          <h2>{task ? 'Edit Task' : 'Add Task'}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={e=>{ e.preventDefault(); onSave(form); }}>
          <div className="form-group">
            <label>Task Title <span className="required">*</span></label>
            <input type="text" required placeholder="What needs to be done?"
              value={form.title} onChange={e=>set('title', e.target.value)} autoFocus/>
          </div>

          <div className="form-group">
            <label>
              Initiative
              <span className="form-hint"> — link this task to a strategic initiative (or leave blank to keep it as inbox)</span>
            </label>
            <select value={form.initiativeId} onChange={e=>handleInit(e.target.value)}>
              <option value="">— None (inbox task) —</option>
              {initiatives.map(i => (
                <option key={i.id} value={i.id}>{i.department} · {i.name}</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Department <span className="required">*</span></label>
              <select required value={form.department} onChange={e=>set('department', e.target.value)} disabled={!!form.initiativeId}>
                {TV_DEPTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Priority</label>
              <select value={form.priority} onChange={e=>set('priority', e.target.value)}>
                <option>Medium</option><option>High</option><option>Low</option>
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Status</label>
              <select value={form.status} onChange={e=>set('status', e.target.value)}>
                <option>Backlog</option><option>Not Started</option><option>In Progress</option>
                <option>Blocked</option><option>Approved</option><option>Delegated</option><option>Completed</option>
              </select>
            </div>
            <div className="form-group">
              <label>Due Date</label>
              <input type="date" value={form.due} onChange={e=>set('due', e.target.value)}/>
            </div>
          </div>

          <div className="form-group">
            <label>Owner</label>
            <select value={form.owner} onChange={e=>set('owner', e.target.value)}>
              {Object.entries(people).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea rows="3" placeholder="Additional details..."
              value={form.notes||''} onChange={e=>set('notes', e.target.value)}/>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!form.title.trim()}>
              {task ? 'Save Changes' : 'Add Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---- Tasks tab ----
function TasksView({ data }) {
  const today = tvParseDate(data.today);

  const allTasks = useMemo(() => {
    const fromInits = data.initiatives.flatMap(i => i.tasks.map(t => ({ ...t, initiativeId: i.id, department: i.department })));
    return [...fromInits, ...data.inboxTasks];
  }, [data]);

  const initLookup = useMemo(() => Object.fromEntries(data.initiatives.map(i => [i.id, i])), [data]);

  const [filters, setFilters] = useState({ dept:'all', priority:'all', scope:'all', q:'' });
  const [activeDept, setActiveDept] = useState(null);
  const [editing, setEditing] = useState(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [, force] = useState(0);
  const setFilter = (k,v) => setFilters(f => ({ ...f, [k]: v }));

  const visible = useMemo(() => {
    const q = filters.q.toLowerCase().trim();
    return allTasks.filter(t => {
      if (activeDept && t.department !== activeDept) return false;
      if (filters.dept !== 'all' && t.department !== filters.dept) return false;
      if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
      if (filters.scope === 'inbox' && t.initiativeId) return false;
      if (filters.scope === 'roadmap' && !t.initiativeId) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allTasks, filters, activeDept]);

  // header stats
  const stats = useMemo(() => {
    const active = allTasks.filter(t => t.status !== 'Completed');
    return {
      total: active.length,
      delegated: active.filter(t => t.status === 'Delegated' || t.status === 'Blocked').length,
      overdue: active.filter(t => tvDays(t.due, today) < 0).length,
      completed: allTasks.filter(t => t.status === 'Completed').length,
    };
  }, [allTasks]);

  // dept progress cards
  const deptStats = useMemo(() => {
    return TV_DEPTS.map(d => {
      const tasks = allTasks.filter(t => t.department === d);
      const done = tasks.filter(t => t.status === 'Completed').length;
      return { dept: d, total: tasks.length, done, pct: tasks.length ? Math.round(done/tasks.length*100) : 0 };
    });
  }, [allTasks]);

  // Group active tasks by status (matches the existing app's status grouping)
  const activeGroups = useMemo(() => {
    const g = { 'Not Started': [], 'In Progress': [], 'Blocked': [], 'Approved': [] };
    visible.filter(t => t.status !== 'Completed').forEach(t => g[t.status].push(t));
    Object.values(g).forEach(arr => arr.sort((a,b) => tvParseDate(a.due) - tvParseDate(b.due)));
    return g;
  }, [visible]);
  const completedTasks = useMemo(() => visible.filter(t => t.status === 'Completed'), [visible]);

  const handleStatusChange = (task, status) => {
    if (task.initiativeId) {
      const t = initLookup[task.initiativeId]?.tasks.find(t => t.id === task.id);
      if (t) t.status = status;
    } else {
      const t = data.inboxTasks.find(t => t.id === task.id);
      if (t) t.status = status;
    }
    force(n => n+1);
  };

  return (
    <div className="tasks-app">
      {/* Toolbar — mirrors the existing one */}
      <div className="toolbar">
        <div className="toolbar-actions">
          <button className="btn btn-primary" onClick={()=>setEditing({ mode:'new' })}>+ Add Task</button>
          <button className="btn btn-secondary">✉ Quick Import</button>
          <button className="btn btn-secondary">↻ Sync Email</button>
        </div>
        <div className="toolbar-filters">
          <div className="scope-segmented">
            {[['all','All'],['inbox','Inbox'],['roadmap','On a roadmap']].map(([k,l])=>(
              <button key={k} className={filters.scope===k?'is-active':''} onClick={()=>setFilter('scope',k)}>{l}</button>
            ))}
          </div>
          <select className="filter-select" value={filters.dept} onChange={e=>setFilter('dept',e.target.value)}>
            <option value="all">All Departments</option>
            {TV_DEPTS.map(d => <option key={d}>{d}</option>)}
          </select>
          <select className="filter-select" value={filters.priority} onChange={e=>setFilter('priority',e.target.value)}>
            <option value="all">All Priorities</option>
            <option>High</option><option>Medium</option><option>Low</option>
          </select>
          <input type="text" className="filter-search" placeholder="Search tasks..."
            value={filters.q} onChange={e=>setFilter('q',e.target.value)}/>
        </div>
      </div>

      {/* Department cards */}
      <div className="department-cards">
        {deptStats.map(d => {
          const k = TV_DEPT_KEY[d.dept];
          const isActive = activeDept === d.dept;
          return (
            <div key={d.dept} className={`dept-card ${isActive?'active':''}`}
              onClick={()=>setActiveDept(isActive ? null : d.dept)}>
              <div className="dept-card-header">
                <span className={`dept-dot dept-${k}`}></span>
                <span className="dept-name">{d.dept}</span>
              </div>
              <div className="dept-card-stats">
                <span className="dept-count">{d.total} tasks</span>
                <span className="dept-done">{d.done} done</span>
              </div>
              <div className="dept-progress">
                <div className={`dept-progress-bar dept-bg-${k}`} style={{ width: d.pct+'%' }}></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Task list */}
      <div className="task-list-container">
        {(['Not Started','In Progress','Blocked','Approved']).map(status => {
          const tasks = activeGroups[status];
          if (!tasks.length) return null;
          const sk = TV_STATUS_KEY[status];
          return (
            <div key={status}>
              <div className={`status-group-header status-header-${sk}`}>
                {status} <span className="status-group-count">{tasks.length}</span>
              </div>
              <div className="task-list">
                {tasks.map(t => (
                  <TaskItem key={t.id} task={t} init={initLookup[t.initiativeId]} people={data.people}
                    today={today}
                    onClick={()=>setEditing({ mode:'edit', task: t })}
                    onStatusChange={handleStatusChange}/>
                ))}
              </div>
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">☰</div>
            <p className="empty-title">No tasks match these filters</p>
            <p className="empty-subtitle">Try clearing a filter, or click "+ Add Task" to create one.</p>
          </div>
        )}

        {completedTasks.length > 0 && (
          <div className="completed-section" style={{ display: 'block' }}>
            <div className="completed-header">
              <div className="completed-header-left">
                <h3>Completed <span className="completed-count">{completedTasks.length}</span></h3>
                <button className="btn-link" onClick={()=>setShowCompleted(s=>!s)}>{showCompleted?'Hide':'Show'}</button>
              </div>
            </div>
            {showCompleted && (
              <div className="task-list">
                {completedTasks.map(t => (
                  <TaskItem key={t.id} task={t} init={initLookup[t.initiativeId]} people={data.people}
                    today={today}
                    onClick={()=>setEditing({ mode:'edit', task: t })}
                    onStatusChange={handleStatusChange}/>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {editing && (
        <AddTaskModal
          task={editing.mode==='edit' ? editing.task : null}
          initiatives={data.initiatives}
          people={data.people}
          onClose={()=>setEditing(null)}
          onSave={()=>setEditing(null)}/>
      )}
    </div>
  );
}

window.TasksView = TasksView;
window.AddTaskModal = AddTaskModal;
