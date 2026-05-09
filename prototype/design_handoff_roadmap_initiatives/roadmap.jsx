/* global React, ReactDOM */
const { useState, useMemo, useEffect, useRef } = React;

// ---------- Helpers ----------
const DEPTS = ['All Marketing', 'B2B Marketing', 'B2C Marketing', 'Personal', 'Rev Ops'];
const DEPT_KEY = { 'Rev Ops':'revops', 'B2B Marketing':'b2b', 'B2C Marketing':'b2c', 'All Marketing':'allmkt', 'Personal':'personal' };
const STATUS_KEY = { 'Backlog':'backlog', 'Not Started':'not-started', 'In Progress':'in-progress', 'Blocked':'blocked', 'Approved':'approved', 'Delegated':'delegated', 'Completed':'completed' };
const HEALTH_LABEL = { 'on-track':'On Track', 'at-risk':'At Risk', 'off-track':'Off Track' };

const parseDate = (s) => new Date(s + 'T00:00:00');
const fmtMD = (d) => d.toLocaleDateString('en-US', { month:'short', day:'numeric' });
const fmtMDY = (d) => d.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' });
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
const startOfWeek = (d) => { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0,0,0,0); return x; };
const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);
const startOfQuarter = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth()/3)*3, 1);

// ---------- Time scales ----------
function buildScale(zoom, anchor) {
  // Returns { start, end, ticks: [{date, label, major}], days, pxPerDay }
  if (zoom === 'week') {
    const start = startOfWeek(addDays(anchor, -7));
    const end = addDays(start, 7*6); // 6 weeks
    const ticks = [];
    for (let i=0; i<7*6; i++) {
      const d = addDays(start, i);
      ticks.push({ date:d, label: d.toLocaleDateString('en-US',{weekday:'short'})[0], sub: String(d.getDate()), major: d.getDay()===1 });
    }
    return { start, end, ticks, days: daysBetween(start,end), unit:'week', pxPerDay: 26 };
  }
  if (zoom === 'quarter') {
    const start = startOfMonth(addDays(anchor, -30));
    const end = addDays(start, 30*5);
    const ticks = [];
    let cur = new Date(start);
    while (cur < end) {
      const next = addDays(cur, 7);
      ticks.push({ date: new Date(cur), label: fmtMD(cur), sub: '', major: cur.getDate() <= 7 });
      cur = next;
    }
    return { start, end, ticks, days: daysBetween(start,end), unit:'quarter', pxPerDay: 7.5 };
  }
  // year
  const start = startOfQuarter(addDays(anchor, -60));
  const end = new Date(start.getFullYear()+1, start.getMonth(), 1);
  const ticks = [];
  let cur = new Date(start);
  while (cur < end) {
    ticks.push({ date: new Date(cur), label: cur.toLocaleDateString('en-US',{month:'short'}), sub:'', major: cur.getMonth()%3===0 });
    cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
  }
  return { start, end, ticks, days: daysBetween(start,end), unit:'year', pxPerDay: 3.0 };
}

function clampToScale(start, end, scale) {
  const a = parseDate(start);
  const b = parseDate(end);
  const left  = Math.max(0, daysBetween(scale.start, a)) * scale.pxPerDay;
  const right = Math.min(scale.days, daysBetween(scale.start, b)) * scale.pxPerDay;
  return { left, width: Math.max(8, right - left), startsBefore: a < scale.start, endsAfter: b > scale.end };
}

// ---------- Avatars ----------
window.RMAvatar = function Avatar({ id, people, size=22 }) {
  const p = people[id];
  if (!p) return null;
  const palette = ['#479FC8','#ABC39B','#DC6B67','#204A65','#7398A9','#d4960a'];
  const idx = (id.charCodeAt(0) + id.charCodeAt(1)) % palette.length;
  return (
    <span className="avatar" title={p.name}
      style={{ width:size, height:size, background:palette[idx], fontSize: Math.round(size*0.42) }}>
      {p.initials}
    </span>
  );
};
const Avatar = window.RMAvatar;

// ---------- Helpers for milestones ----------
const xToDateStr = (x, scale) => {
  const days = Math.round(x / scale.pxPerDay);
  const d = addDays(scale.start, days);
  return d.toISOString().slice(0,10);
};

// ---------- Initiative bar ----------
function InitiativeBar({ init, scale, expanded, onToggle, onTask, density, style, showMilestones,
                        onMilestoneEdit, onMilestoneDragStart, onMilestoneQuickAdd, onAcceptSuggestion }) {
  const { left, width } = clampToScale(init.start, init.end, scale);
  const filledPct = Math.round(init.progress * 100);
  const deptKey = DEPT_KEY[init.department];

  const handleContextMenu = (e) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const xInBar = e.clientX - rect.left;
    const dateStr = xToDateStr(left + xInBar, scale);
    onMilestoneQuickAdd(init.id, dateStr, e.clientX, e.clientY);
  };

  return (
    <div className={`bar-wrap density-${density}`} style={{ left, width }} onContextMenu={handleContextMenu}>
      <button className={`init-bar style-${style} dept-${deptKey} health-${init.health} ${expanded?'is-open':''}`}
        onClick={onToggle}
        title="Right-click anywhere on the bar to add a key date">
        <span className="init-bar__fill" style={{ width: filledPct+'%' }}></span>
        <span className="init-bar__content">
          <span className="init-bar__caret">{expanded?'▾':'▸'}</span>
          <span className="init-bar__title">{init.name}</span>
          <span className="init-bar__pct">{filledPct}%</span>
        </span>
      </button>
      {showMilestones && init.milestones.map((m, i) => {
        const x = daysBetween(scale.start, parseDate(m.date)) * scale.pxPerDay - left;
        if (x < -8 || x > width + 8) return null;
        return (
          <span key={i} className={`milestone milestone-${m.kind} is-interactive`} style={{ left: x }}
            title={`${fmtMD(parseDate(m.date))} · ${m.label} — click to edit, drag to reschedule`}
            onClick={(e)=>{ e.stopPropagation(); onMilestoneEdit(init.id, i, e.clientX, e.clientY); }}
            onMouseDown={(e)=>{ if (e.button !== 0) return; onMilestoneDragStart(init.id, i, m.date, e); }}>
            <span className="milestone__dot"></span>
            <span className="milestone__lbl">{m.label}</span>
          </span>
        );
      })}
      {showMilestones && (init.suggestedMilestones||[]).map((m, i) => {
        const x = daysBetween(scale.start, parseDate(m.date)) * scale.pxPerDay - left;
        if (x < -8 || x > width + 8) return null;
        return (
          <span key={'sug'+i} className="milestone milestone-suggested" style={{ left: x }}
            title={`AI suggestion from ${m.source||'notes'}: ${m.label} — click to accept`}
            onClick={(e)=>{ e.stopPropagation(); onAcceptSuggestion(init.id, i, e.clientX, e.clientY); }}>
            <span className="milestone__dot"></span>
            <span className="milestone__sug-badge">✦</span>
            <span className="milestone__lbl">✦ Suggested · {m.label}</span>
          </span>
        );
      })}
    </div>
  );
}

// ---------- Milestone edit/add popover ----------
function MilestonePopover({ popover, data, onClose, refresh }) {
  const init = popover ? data.initiatives.find(i => i.id === popover.initId) : null;
  const initial = popover && (popover.mode === 'edit'
    ? init.milestones[popover.index]
    : popover.mode === 'suggest'
      ? { ...init.suggestedMilestones[popover.index] }
      : { date: popover.dateStr, label: '', kind: popover.defaultKind || 'event' });
  const [m, setM] = useState(initial);
  useEffect(() => { setM(initial); /* eslint-disable-next-line */ }, [popover && popover.initId, popover && popover.index, popover && popover.mode]);
  if (!popover || !init) return null;

  const isEdit = popover.mode === 'edit';
  const isSuggest = popover.mode === 'suggest';

  const save = () => {
    if (!m.label.trim()) return;
    if (isEdit) {
      init.milestones[popover.index] = m;
    } else {
      init.milestones = [...(init.milestones||[]), m];
      if (isSuggest) init.suggestedMilestones.splice(popover.index, 1);
    }
    refresh(); onClose();
  };
  const remove = () => {
    if (isEdit) init.milestones.splice(popover.index, 1);
    if (isSuggest) init.suggestedMilestones.splice(popover.index, 1);
    refresh(); onClose();
  };
  const dismissSuggestion = () => {
    if (isSuggest) init.suggestedMilestones.splice(popover.index, 1);
    refresh(); onClose();
  };

  // Position: clamp to viewport
  const popW = 320, popH = 240;
  const x = Math.min(window.innerWidth - popW - 16, Math.max(16, popover.x - popW/2));
  const y = Math.min(window.innerHeight - popH - 16, popover.y + 16);

  const KINDS = [
    {v:'launch',   l:'Launch'},
    {v:'event',    l:'Event'},
    {v:'decision', l:'Decision'},
    {v:'team',     l:'Team'},
  ];

  return (
    <div className="ms-pop-overlay" onClick={onClose}>
      <div className="ms-pop" style={{ left: x, top: y }} onClick={e=>e.stopPropagation()}>
        <div className="ms-pop__head">
          <span className="ms-pop__title">
            {isEdit ? '◆ Edit key date' : isSuggest ? '✦ AI-suggested key date' : '◆ New key date'}
          </span>
          <span className="ms-pop__sub">{init.name}</span>
        </div>
        {isSuggest && (
          <div className="ms-pop__source">
            From {m.source || 'notes'}: <em>"{m.context || m.label}"</em>
          </div>
        )}
        <div className="ms-pop__body">
          <label className="ms-pop__lbl">What's happening?</label>
          <input className="ms-pop__input" value={m.label} autoFocus
            placeholder="e.g. Vendor selected, Press release, Town hall"
            onChange={e=>setM({...m, label: e.target.value})}/>
          <label className="ms-pop__lbl">Date</label>
          <input className="ms-pop__input" type="date" value={m.date}
            onChange={e=>setM({...m, date: e.target.value})}/>
          <label className="ms-pop__lbl">Type</label>
          <div className="ms-pop__kinds">
            {KINDS.map(k => (
              <button key={k.v} className={`ms-pop__kind milestone-${k.v} ${m.kind===k.v?'is-active':''}`}
                onClick={()=>setM({...m, kind: k.v})}>
                <span className="ms-pop__kind-dot"></span>{k.l}
              </button>
            ))}
          </div>
        </div>
        <div className="ms-pop__foot">
          {isEdit && <button className="ms-pop__btn ms-pop__btn--danger" onClick={remove}>Delete</button>}
          {isSuggest && <button className="ms-pop__btn" onClick={dismissSuggestion}>Dismiss</button>}
          <span style={{flex:1}}></span>
          <button className="ms-pop__btn" onClick={onClose}>Cancel</button>
          <button className="ms-pop__btn ms-pop__btn--primary" onClick={save} disabled={!m.label.trim()}>
            {isSuggest ? 'Accept ✓' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Task chip rail (shown when initiative expanded) ----------
function TaskRail({ init, scale, onTask, people, style }) {
  const { left, width } = clampToScale(init.start, init.end, scale);
  // Distribute task chips along their due dates
  return (
    <div className="task-rail" style={{ left, width }}>
      <div className="task-rail__line"></div>
      {init.tasks.map((t) => {
        const due = parseDate(t.due);
        const x = (daysBetween(scale.start, due) * scale.pxPerDay) - left;
        const sk = STATUS_KEY[t.status];
        return (
          <button key={t.id} className={`task-chip status-${sk} pri-${t.priority.toLowerCase()} style-${style}`}
            style={{ left: x }}
            onClick={(e)=>{ e.stopPropagation(); onTask(t, init); }}>
            <span className="task-chip__pri"></span>
            <span className="task-chip__title">{t.title}</span>
            <span className="task-chip__owner"><Avatar id={t.owner} people={people} size={16}/></span>
          </button>
        );
      })}
    </div>
  );
}

// ---------- Time header ----------
function TimeHeader({ scale, todayX }) {
  return (
    <div className={`time-header unit-${scale.unit}`}>
      {scale.ticks.map((t,i) => (
        <div key={i} className={`tick ${t.major?'tick-major':''}`}
          style={{ left: daysBetween(scale.start, t.date) * scale.pxPerDay }}>
          <span className="tick__label">{t.label}</span>
          {t.sub && <span className="tick__sub">{t.sub}</span>}
        </div>
      ))}
      <div className="today-marker" style={{ left: todayX }}>
        <span className="today-marker__pin">TODAY</span>
      </div>
    </div>
  );
}

// ---------- Filters ----------
function Toolbar({ zoom, setZoom, filters, setFilters, people, onNewInitiative }) {
  const set = (k,v) => setFilters(f => ({ ...f, [k]: v }));
  return (
    <div className="rm-toolbar">
      <button className="btn btn-primary rm-toolbar__new" onClick={onNewInitiative}>＋ New initiative</button>
      <div className="zoom-toggle" role="tablist">
        {['week','quarter','year'].map(z => (
          <button key={z} role="tab" aria-selected={zoom===z}
            className={zoom===z?'is-active':''} onClick={()=>setZoom(z)}>
            {z[0].toUpperCase()+z.slice(1)}
          </button>
        ))}
      </div>
      <div className="rm-filters">
        <select value={filters.dept} onChange={e=>set('dept',e.target.value)}>
          <option value="all">All departments</option>
          {DEPTS.map(d => <option key={d}>{d}</option>)}
        </select>
        <select value={filters.priority} onChange={e=>set('priority',e.target.value)}>
          <option value="all">All priorities</option>
          {['High','Medium','Low'].map(p => <option key={p}>{p}</option>)}
        </select>
        <select value={filters.owner} onChange={e=>set('owner',e.target.value)}>
          <option value="all">Any owner</option>
          {Object.entries(people).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}
        </select>
        <input className="rm-search" placeholder="Search initiatives or tasks…"
          value={filters.q} onChange={e=>set('q',e.target.value)} />
      </div>
    </div>
  );
}

// ---------- Stat strip (impact framing) ----------
function ImpactStrip({ filtered }) {
  const total = filtered.length;
  const onTrack = filtered.filter(i => i.health === 'on-track').length;
  const atRisk  = filtered.filter(i => i.health === 'at-risk').length;
  const tasks   = filtered.flatMap(i => i.tasks);
  const done    = tasks.filter(t => t.status === 'Completed').length;
  const overall = tasks.length ? Math.round(filtered.reduce((s,i)=>s+i.progress,0)/filtered.length*100) : 0;
  const milestones = filtered.flatMap(i => i.milestones).length;

  const stats = [
    { v: total, l: 'in flight' },
    { v: `${done}/${tasks.length}`, l: 'tasks shipped' },
    { v: atRisk, l: 'need attention', tone: atRisk?'warn':'mute' },
  ];
  return (
    <div className="impact-strip">
      {stats.map((s,i)=>(
        <div key={i} className={`impact-stat tone-${s.tone||'default'}`}>
          <span className="impact-stat__v">{s.v}</span>
          <span className="impact-stat__l">{s.l}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Task detail helper components ----------
function TaskActionRow({ task, onPromoteToMilestone }) {
  const [status, setStatus] = useState(task.status);
  const update = (s) => { setStatus(s); task.status = s; };
  const STATUSES = ['Backlog','Not Started','In Progress','Blocked','Approved','Delegated','Completed'];
  return (
    <div className="rm-task-actions">
      <div className="rm-task-actions__status">
        {STATUSES.map(s => (
          <button key={s}
            className={`rm-task-actions__pill ${status===s?'is-active':''} status-${STATUS_KEY[s]}`}
            onClick={()=>update(s)}>{s}</button>
        ))}
      </div>
      <div className="rm-task-actions__quick">
        <button className="rm-task-actions__btn" onClick={onPromoteToMilestone}>◆ Make this a key date</button>
        <button className="rm-task-actions__btn">+ Add subtask</button>
        <button className="rm-task-actions__btn">@ Mention</button>
        <button className="rm-task-actions__btn">⏱ Snooze</button>
      </div>
    </div>
  );
}

function TaskAISummary({ task, init }) {
  const [open, setOpen] = useState(true);
  const summary = `This task rolls up to "${init.name}". ${init.thesis} Owner ${task.owner} is targeting ${task.due}; status currently ${task.status}.`;
  const next = [
    'Confirm scope with owner before EOW',
    `Pull latest meeting notes for "${init.name}"`,
    'Identify blockers and post in #' + (init.department || 'team').toLowerCase().replace(/\s+/g,'-'),
  ];
  return (
    <div className={`rm-ai ${open?'is-open':''}`}>
      <div className="rm-ai__head" onClick={()=>setOpen(o=>!o)}>
        <span className="rm-ai__star">✦</span>
        <span className="rm-ai__title">AI summary</span>
        <span className="rm-ai__chev">{open?'▾':'▸'}</span>
      </div>
      {open && (
        <div className="rm-ai__body">
          <p>{summary}</p>
          <div className="rm-ai__next-label">Suggested next steps</div>
          <ul className="rm-ai__next">
            {next.map((n,i)=><li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function TaskNotes({ task }) {
  const [val, setVal] = useState(task.notes || '');
  return (
    <div className="rm-notes">
      <div className="rm-notes__label">Notes</div>
      <textarea className="rm-notes__area"
        placeholder="Capture context, links, or decisions for this task…"
        value={val}
        onChange={e=>{ setVal(e.target.value); task.notes = e.target.value; }} />
    </div>
  );
}

// ---------- Task detail modal ----------
function TaskDetail({ task, init, people, onClose, onPromoteToMilestone }) {
  if (!task) return null;
  const sk = STATUS_KEY[task.status];
  const due = parseDate(task.due);
  return (
    <div className="rm-modal-overlay" onClick={onClose}>
      <div className="rm-modal" onClick={e=>e.stopPropagation()}>
        <div className="rm-modal__header">
          <div>
            <div className="rm-modal__bread">{init.name}</div>
            <h2>{task.title}</h2>
          </div>
          <button className="rm-modal__close" onClick={onClose}>×</button>
        </div>
        <div className="rm-modal__body">
          <div className="rm-modal__meta">
            <span className={`badge dept-${DEPT_KEY[init.department]}`}>{init.department}</span>
            <span className={`badge pri-${task.priority.toLowerCase()}`}>{task.priority}</span>
            <span className={`badge status-${sk}`}>{task.status}</span>
          </div>
          <div className="rm-modal__row">
            <div className="rm-modal__cell">
              <div className="rm-modal__label">Owner</div>
              <div className="rm-modal__value">
                <Avatar id={task.owner} people={people} size={22}/>
                <span>{people[task.owner]?.name}</span>
              </div>
            </div>
            <div className="rm-modal__cell">
              <div className="rm-modal__label">Due</div>
              <div className="rm-modal__value">{fmtMDY(due)}</div>
            </div>
            <div className="rm-modal__cell">
              <div className="rm-modal__label">Initiative</div>
              <div className="rm-modal__value">{init.name}</div>
            </div>
          </div>

          <TaskActionRow task={task} onPromoteToMilestone={()=>onPromoteToMilestone && onPromoteToMilestone(task, init)} />
          <TaskAISummary task={task} init={init} />
          <TaskNotes task={task} />

          <details className="rm-modal__collapsible">
            <summary>
              <span className="rm-modal__label" style={{margin:0}}>Why this matters</span>
              <span className="rm-modal__chev">›</span>
            </summary>
            <p className="rm-modal__thesis">{init.thesis}</p>
          </details>
          <details className="rm-modal__collapsible">
            <summary>
              <span className="rm-modal__label" style={{margin:0}}>Sibling tasks <span className="rm-modal__count">({init.tasks.length-1})</span></span>
              <span className="rm-modal__chev">›</span>
            </summary>
            <ul className="rm-modal__siblings">
              {init.tasks.filter(t=>t.id!==task.id).map(t => (
                <li key={t.id}>
                  <span className={`sib-dot status-${STATUS_KEY[t.status]}`}></span>
                  <span className="sib-title">{t.title}</span>
                  <span className="sib-due">{fmtMD(parseDate(t.due))}</span>
                  <Avatar id={t.owner} people={people} size={16}/>
                </li>
              ))}
            </ul>
          </details>

          <div className="rm-modal__actions">
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
            <button className="btn btn-primary">Open in Tasks ↗</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------- Main ----------
function RoadmapApp() {
  const data = window.ROADMAP_DATA;
  const today = parseDate(data.today);

  const [tweaks, setTweak] = window.useTweaks({
    style: 'editorial',     // editorial | studio | garden
    density: 'comfortable', // compact | comfortable | spacious
    showMilestones: true,
    sortBy: 'department',   // department | priority | endDate
    showCompleted: true,
  });

  const [zoom, setZoom] = useState('quarter');
  const [filters, setFilters] = useState({ dept:'all', priority:'all', owner:'all', q:'' });
  const [expanded, setExpanded] = useState(() => new Set(['init-shopify','init-slack','init-grad']));
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set());
  const [shellFilter, setShellFilter] = useState('all'); // from app-shell stats bar chips
  React.useEffect(() => {
    const handler = (e) => setShellFilter(e.detail || 'all');
    window.addEventListener('roadmap:filter', handler);
    return () => window.removeEventListener('roadmap:filter', handler);
  }, []);
  const toggleGroup = (label) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const [openTask, setOpenTask] = useState(null);
  const [openInit, setOpenInit] = useState(null);
  const [activeTab, setActiveTab] = useState('roadmap');
  const [editingInit, setEditingInit] = useState(null); // { mode:'new'|'edit', initiative? }
  const [msPopover, setMsPopover] = useState(null); // { initId, mode:'edit'|'add'|'suggest', index?, dateStr?, x, y }
  const [msDrag, setMsDrag] = useState(null);       // { initId, index, startClientX, origDate, moved }
  const [, forceTick] = useState(0);
  const refresh = () => forceTick(t => t+1);

  const scale = useMemo(() => buildScale(zoom, today), [zoom]);

  // Drag-to-reschedule milestones
  useEffect(() => {
    if (!msDrag) return;
    const onMove = (e) => {
      const dx = e.clientX - msDrag.startClientX;
      const days = Math.round(dx / scale.pxPerDay);
      if (Math.abs(dx) > 3) msDrag.moved = true;
      const newDate = addDays(parseDate(msDrag.origDate), days);
      const init = data.initiatives.find(i => i.id === msDrag.initId);
      if (init && init.milestones[msDrag.index]) {
        init.milestones[msDrag.index].date = newDate.toISOString().slice(0,10);
        forceTick(t => t+1);
      }
    };
    const onUp = () => setMsDrag(null);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [msDrag, scale, data]);
  const todayX = daysBetween(scale.start, today) * scale.pxPerDay;

  const filtered = useMemo(() => {
    const q = filters.q.toLowerCase().trim();
    return data.initiatives.filter(i => {
      if (filters.dept !== 'all' && i.department !== filters.dept) return false;
      if (filters.priority !== 'all' && i.priority !== filters.priority) return false;
      if (filters.owner !== 'all' && i.owner !== filters.owner && !i.collaborators.includes(filters.owner)) return false;
      // Shell filter chips (All / Mine / At Risk)
      if (shellFilter === 'mine') {
        const me = 'KP';
        const involved = i.owner === me || (i.collaborators||[]).includes(me) || (i.tasks||[]).some(t => t.owner === me);
        if (!involved) return false;
      }
      if (shellFilter === 'at-risk' && i.health !== 'at-risk') return false;
      if (q) {
        const hit = i.name.toLowerCase().includes(q) || i.thesis.toLowerCase().includes(q)
          || i.tasks.some(t => t.title.toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    }).sort((a,b) => {
      if (tweaks.sortBy === 'priority') {
        const pri = { High:0, Medium:1, Low:2 };
        return pri[a.priority] - pri[b.priority];
      }
      if (tweaks.sortBy === 'endDate') {
        return parseDate(a.end) - parseDate(b.end);
      }
      // department then start
      return DEPTS.indexOf(a.department) - DEPTS.indexOf(b.department) || parseDate(a.start) - parseDate(b.start);
    });
  }, [data, filters, tweaks.sortBy, shellFilter]);

  const toggleExpand = (id) => setExpanded(s => {
    const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  // Group initiatives by department for sub-headers when sortBy=department
  const groups = useMemo(() => {
    if (tweaks.sortBy !== 'department') return [{ label: null, items: filtered }];
    const byDept = {};
    filtered.forEach(i => { (byDept[i.department] = byDept[i.department] || []).push(i); });
    return DEPTS.filter(d => byDept[d]).map(d => ({ label: d, items: byDept[d] }));
  }, [filtered, tweaks.sortBy]);

  // Header stats — same pattern as the existing app
  const headerStats = useMemo(() => {
    const all = [
      ...data.initiatives.flatMap(i => i.tasks.map(t => ({ ...t, initiativeId: i.id }))),
      ...(data.inboxTasks || []),
    ];
    const active = all.filter(t => t.status !== 'Completed');
    return {
      total: active.length,
      awaiting: active.filter(t => t.status === 'Blocked' || t.status === 'Delegated').length,
      overdue: active.filter(t => (parseDate(t.due) - today) < 0).length,
      completed: all.filter(t => t.status === 'Completed').length,
    };
  }, [data]);

  return (
    <div className={`rm-shell style-${tweaks.style} density-${tweaks.density}`}>
      {activeTab === 'roadmap' ? (
        <main className="rm-main" style={{ maxWidth: 'none', padding: '1rem 1.5rem 4rem' }}>
          <section className="rm-hero">
            <h1 className="rm-hero__title">Where the team is taking the business.</h1>
            <p className="rm-hero__sub">
              Big initiatives, with the tasks that bring them to life nested underneath.
              Click an initiative to expand its tasks. Click a task to dig in.
            </p>
          </section>

          <Toolbar zoom={zoom} setZoom={setZoom} filters={filters} setFilters={setFilters} people={data.people}
            onNewInitiative={()=>setEditingInit({ mode:'new' })}/>

          <div className="rm-canvas">
            <div className="rm-canvas__lanes">
              <div className="rm-canvas__lane-header">Initiative</div>
              {groups.map((g, gi) => (
                <React.Fragment key={gi}>
                  {g.label && (
                    <button className={`rm-group-header dept-${DEPT_KEY[g.label]} ${collapsedGroups.has(g.label) ? 'is-collapsed' : ''}`} onClick={()=>toggleGroup(g.label)}>
                      <span className="rm-group-header__caret">{collapsedGroups.has(g.label) ? '▸' : '▾'}</span>
                      <span className="rm-group-header__dot"></span>{g.label}
                      <span className="rm-group-header__count">{g.items.length}</span>
                    </button>
                  )}
                  {!collapsedGroups.has(g.label) && g.items.map(init => (
                    <React.Fragment key={init.id}>
                      <div className={`rm-lane-row health-${init.health}`}>
                        <div className="rm-lane-meta">
                          <button className="rm-lane-meta__title" onClick={()=>setOpenInit(init)}>
                            <span className="caret">{expanded.has(init.id)?'▾':'▸'}</span>
                            {init.name}
                          </button>
                          <button className="rm-lane-meta__edit" onClick={()=>setEditingInit({ mode:'edit', initiative: init })} title="Edit initiative">✎</button>
                          <div className="rm-lane-meta__sub">
                            <span className={`tag dept-${DEPT_KEY[init.department]}`}>{init.department}</span>
                            <span className={`tag health-${init.health}`}>{HEALTH_LABEL[init.health]}</span>
                            <span className="lane-owners">
                              <Avatar id={init.owner} people={data.people} size={20}/>
                              {init.collaborators.map(c => (
                                <Avatar key={c} id={c} people={data.people} size={20}/>
                              ))}
                            </span>
                          </div>
                        </div>
                      </div>
                      {expanded.has(init.id) && init.tasks.map(t => (
                        <div key={t.id} className="rm-task-meta-row">
                          <div className="rm-task-meta">
                            <span className={`task-status-dot status-${STATUS_KEY[t.status]}`}></span>
                            <span className="rm-task-meta__title">{t.title}</span>
                            <Avatar id={t.owner} people={data.people} size={16}/>
                          </div>
                        </div>
                      ))}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              ))}
            </div>

            <div className="rm-canvas__time">
              <TimeHeader scale={scale} todayX={todayX}/>
              <div className="rm-canvas__rows" style={{ width: scale.days * scale.pxPerDay }}>
                <div className="today-line" style={{ left: todayX }}></div>
                {/* Vertical major gridlines */}
                {scale.ticks.filter(t=>t.major).map((t,i)=>(
                  <div key={i} className="grid-line" style={{ left: daysBetween(scale.start, t.date)*scale.pxPerDay }}></div>
                ))}
                {groups.map((g, gi) => (
                  <React.Fragment key={gi}>
                    {g.label && <div className={`rm-group-header rm-group-header--ghost dept-${DEPT_KEY[g.label]}`}></div>}
                    {!collapsedGroups.has(g.label) && g.items.map(init => (
                      <React.Fragment key={init.id}>
                        <div className={`rm-lane-track health-${init.health}`}>
                          <InitiativeBar init={init} scale={scale}
                            expanded={expanded.has(init.id)}
                            onToggle={()=>toggleExpand(init.id)}
                            onTask={(t)=>setOpenTask({task:t, init})}
                            density={tweaks.density}
                            style={tweaks.style}
                            showMilestones={tweaks.showMilestones}
                            onMilestoneEdit={(initId, index, x, y) => {
                              if (msDrag && msDrag.moved) return; // suppress click after drag
                              setMsPopover({ initId, mode:'edit', index, x, y });
                            }}
                            onMilestoneDragStart={(initId, index, origDate, e) => {
                              setMsDrag({ initId, index, startClientX: e.clientX, origDate, moved:false });
                            }}
                            onMilestoneQuickAdd={(initId, dateStr, x, y) => {
                              setMsPopover({ initId, mode:'add', dateStr, x, y });
                            }}
                            onAcceptSuggestion={(initId, index, x, y) => {
                              setMsPopover({ initId, mode:'suggest', index, x, y });
                            }}/>
                        </div>
                        {expanded.has(init.id) && init.tasks.map(t => {
                          const due = parseDate(t.due);
                          const x = daysBetween(scale.start, due) * scale.pxPerDay;
                          const sk = STATUS_KEY[t.status];
                          return (
                            <div key={t.id} className="rm-task-track">
                              <button className={`task-pin status-${sk} pri-${t.priority.toLowerCase()} style-${tweaks.style}`}
                                style={{ left: x }} onClick={()=>setOpenTask({task:t, init})}>
                                <span className="task-pin__dot"></span>
                                <span className="task-pin__title">{t.title}</span>
                              </button>
                            </div>
                          );
                        })}
                      </React.Fragment>
                    ))}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </main>
      ) : (
        <main className="rm-main">
          <window.TasksView data={data} onOpenInitiative={(id)=>{
            const init = data.initiatives.find(i=>i.id===id);
            if (init) { setActiveTab('roadmap'); setEditingInit({ mode:'edit', initiative: init }); }
          }}/>
        </main>
      )}

      <MilestonePopover popover={msPopover} data={data} refresh={refresh} onClose={()=>setMsPopover(null)}/>

      {openTask && <TaskDetail task={openTask.task} init={openTask.init} people={data.people}
        onPromoteToMilestone={(t, init) => {
          init.milestones = [...(init.milestones||[]), { date: t.due, label: t.title, kind: 'decision', fromTaskId: t.id }];
          refresh();
          setOpenTask(null);
        }}
        onClose={()=>setOpenTask(null)}/>}
      {openInit && window.InitiativeDetail && <window.InitiativeDetail initiative={openInit} onClose={()=>setOpenInit(null)} onOpenTask={(t)=>{setOpenInit(null); setOpenTask(t);}} />}

      {editingInit && (
        <window.InitiativeForm
          initiative={editingInit.mode==='edit' ? editingInit.initiative : null}
          people={data.people}
          today={data.today}
          onClose={()=>setEditingInit(null)}
          onSave={(form)=>{
            if (editingInit.mode === 'new') {
              data.initiatives.push(form);
            } else {
              const idx = data.initiatives.findIndex(i=>i.id===form.id);
              if (idx >= 0) data.initiatives[idx] = form;
            }
            setEditingInit(null);
            refresh();
          }}
          onDelete={(form)=>{
            const idx = data.initiatives.findIndex(i=>i.id===form.id);
            if (idx >= 0) data.initiatives.splice(idx, 1);
            setEditingInit(null);
            refresh();
          }}/>
      )}

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection title="Visual style">
          <window.TweakRadio label="Style" value={tweaks.style}
            options={[
              { value:'editorial', label:'Editorial' },
              { value:'studio',    label:'Studio' },
              { value:'garden',    label:'Garden' },
            ]} onChange={v=>setTweak('style', v)}/>
          <window.TweakSelect label="Density" value={tweaks.density}
            options={[
              { value:'compact', label:'Compact' },
              { value:'comfortable', label:'Comfortable' },
              { value:'spacious', label:'Spacious' },
            ]} onChange={v=>setTweak('density', v)}/>
        </window.TweakSection>
        <window.TweakSection title="Display">
          <window.TweakToggle label="Milestone markers" value={tweaks.showMilestones}
            onChange={v=>setTweak('showMilestones', v)}/>
          <window.TweakSelect label="Sort by" value={tweaks.sortBy}
            options={[
              { value:'department', label:'Department' },
              { value:'priority',   label:'Priority' },
              { value:'endDate',    label:'End date' },
            ]} onChange={v=>setTweak('sortBy', v)}/>
        </window.TweakSection>
      </window.TweaksPanel>
    </div>
  );
}

window.RoadmapApp = RoadmapApp;
