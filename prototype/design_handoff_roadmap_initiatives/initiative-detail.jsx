// Initiative Detail — notes hub + suggested tasks queue
// Globals: React, useState, useMemo, ROADMAP_DATA, RMAvatar, STATUS_KEY, DEPT_KEY

(() => {
  const { useState, useMemo } = React;

  const SOURCE_META = {
    granola:  { label: 'Granola',       icon: '◐', color: '#6e8ac4' },
    slack:    { label: 'Marketing Bot', icon: '#',  color: '#4a154b' },
    teams:    { label: 'Teams',         icon: '▣',  color: '#5059c9' },
    manual:   { label: 'Manual',        icon: '✎',  color: '#7a6f5f' },
    email:    { label: 'Email',         icon: '✉',  color: '#5a8a6f' },
  };

  function fmtWhen(s) {
    if (!s) return '';
    const d = new Date(s.replace(' ', 'T'));
    if (isNaN(d)) return s;
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const hh = d.getHours(); const mm = String(d.getMinutes()).padStart(2,'0');
    const ap = hh >= 12 ? 'pm' : 'am'; const h12 = ((hh+11)%12)+1;
    return `${months[d.getMonth()]} ${d.getDate()} · ${h12}:${mm}${ap}`;
  }

  function NoteCard({ note, people }) {
    const meta = SOURCE_META[note.source] || SOURCE_META.manual;
    const author = people[note.author];
    return (
      <div className="id-note">
        <div className="id-note__head">
          <span className="id-note__source" style={{color: meta.color}}>
            <span className="id-note__source-icon">{meta.icon}</span>
            {meta.label}
          </span>
          <span className="id-note__sep">·</span>
          {author && <window.RMAvatar id={note.author} people={people} size={18}/>}
          <span className="id-note__author">{author?.name || note.author}</span>
          <span className="id-note__sep">·</span>
          <span className="id-note__when">{fmtWhen(note.when)}</span>
        </div>
        <div className="id-note__body">{note.body}</div>
        {note.badges && note.badges.length > 0 && (
          <div className="id-note__badges">
            {note.badges.map((b,i) => <span key={i} className="id-note__badge">{b}</span>)}
          </div>
        )}
      </div>
    );
  }

  function AddNote({ initiative, onAdd }) {
    const [open, setOpen] = useState(false);
    const [body, setBody] = useState('');
    const submit = () => {
      if (!body.trim()) return;
      onAdd({
        id: 'n-' + Math.random().toString(36).slice(2,8),
        initiativeId: initiative.id,
        source: 'manual',
        author: 'KP', // current user — would come from auth
        when: new Date().toISOString().slice(0,16).replace('T',' '),
        body: body.trim(),
        badges: [],
      });
      setBody('');
      setOpen(false);
    };
    if (!open) {
      return (
        <button className="id-add-trigger" onClick={()=>setOpen(true)}>
          <span className="id-add-trigger__plus">+</span>
          Add note — paste from Teams, Copilot, or just type
        </button>
      );
    }
    return (
      <div className="id-add">
        <div className="id-add__head">
          <span className="id-add__title">Add note to <strong>{initiative.name}</strong></span>
          <span className="id-add__hint">Stamped automatically: you · just now · Manual</span>
        </div>
        <textarea className="id-add__area" autoFocus
          placeholder="Paste a Teams meeting recap, Copilot summary, or type your own…"
          value={body} onChange={e=>setBody(e.target.value)} />
        <div className="id-add__actions">
          <button className="id-btn id-btn--ghost" onClick={()=>{setOpen(false); setBody('');}}>Cancel</button>
          <button className="id-btn id-btn--primary" onClick={submit} disabled={!body.trim()}>Save note</button>
        </div>
      </div>
    );
  }

  function SuggestedTask({ s, onAccept, onDismiss }) {
    const meta = SOURCE_META[s.source] || SOURCE_META.manual;
    return (
      <div className="id-sug">
        <div className="id-sug__head">
          <span className="id-sug__star">✦</span>
          <span className="id-sug__title">{s.title}</span>
          <span className={`id-sug__pri pri-${s.priority.toLowerCase()}`}>{s.priority}</span>
        </div>
        <div className="id-sug__quote">
          <span className="id-sug__source" style={{color: meta.color}}>{meta.icon} {meta.label}</span>
          <span className="id-sug__sep">·</span>
          <span className="id-sug__quote-text">"{s.sourceQuote}"</span>
        </div>
        <div className="id-sug__actions">
          <button className="id-btn id-btn--primary id-btn--sm" onClick={onAccept}>+ Add as task</button>
          <button className="id-btn id-btn--ghost id-btn--sm" onClick={onDismiss}>Dismiss</button>
        </div>
      </div>
    );
  }

  function SlackBotCard() {
    return (
      <div className="id-slack">
        <div className="id-slack__head">
          <div className="id-slack__bot">
            <div className="id-slack__avatar">M</div>
            <div>
              <div className="id-slack__name">Marketing Bot <span className="id-slack__app">APP</span></div>
              <div className="id-slack__time">Today · 2:14pm</div>
            </div>
          </div>
        </div>
        <div className="id-slack__body">
          <div className="id-slack__line">✅ Saved your note to <strong>Shopify Rollout — 50 Stores</strong></div>
          <div className="id-slack__line id-slack__quote">"Pipe 17 ingest hit 200 of 250 vendors. Last 50 missing PIM data."</div>
          <div className="id-slack__hint">Tagged from <code>#shopify-rollout</code> · stamped @rtaylor · 2:12pm</div>
          <div className="id-slack__actions">
            <button className="id-slack__btn">View in app ↗</button>
            <button className="id-slack__btn">Change initiative</button>
          </div>
        </div>
        <div className="id-slack__footer">How: <code>@Marketing Bot tag &lt;initiative name&gt;</code> in any channel, or DM the bot with <code>/note</code></div>
      </div>
    );
  }

  // ---------- Timeline tab ----------
  function TimelineView({ initiative, notes, people }) {
    const items = useMemo(() => {
      const out = [];
      // start
      out.push({ when: initiative.start + ' 09:00', kind: 'start',
        title: 'Initiative kicked off', subtitle: initiative.thesis, who: initiative.owner });
      // milestones
      (initiative.milestones || []).forEach(m => {
        out.push({ when: m.date + ' 09:00', kind: 'milestone', mkind: m.kind,
          title: m.label, subtitle: m.kind === 'launch' ? 'Launch milestone' : (m.kind === 'team' ? 'Team milestone' : (m.kind === 'decision' ? 'Decision point' : 'Event')) });
      });
      // notes (significant ones — Granola + Slack always; Manual only if longer)
      notes.forEach(n => {
        if (n.source === 'manual' && (n.body || '').length < 80) return;
        out.push({ when: n.when, kind: 'note', source: n.source, who: n.author,
          title: SOURCE_META[n.source]?.label + ' update', subtitle: n.body, badges: n.badges });
      });
      // task completions (use due as proxy for completed ones)
      (initiative.tasks || []).filter(t => t.status === 'Completed').forEach(t => {
        out.push({ when: t.due + ' 17:00', kind: 'done', who: t.owner,
          title: '✓ ' + t.title, subtitle: 'Marked complete' });
      });
      // status flag
      if (initiative.health === 'at-risk') {
        out.push({ when: '2026-04-19 14:30', kind: 'status', who: initiative.owner,
          title: 'Flagged At Risk', subtitle: 'Status changed from On Track — POS interface blockers slipping the pilot date.' });
      }
      // end
      out.push({ when: initiative.end + ' 17:00', kind: 'end',
        title: 'Target completion', subtitle: 'Initiative wraps' });
      return out.sort((a,b) => (b.when||'').localeCompare(a.when||''));
    }, [initiative, notes]);

    const today = window.ROADMAP_DATA.today;
    return (
      <div className="id-tl">
        <div className="id-tl__head">
          <h3 className="id-section__title">Timeline <span className="id-section__count">{items.length} events</span></h3>
          <span className="id-section__hint">Milestones, notes, decisions, and status flips — newest first</span>
        </div>
        <div className="id-tl__line">
          {items.map((it,i) => {
            const isFuture = (it.when || '').slice(0,10) > today;
            const isToday  = (it.when || '').slice(0,10) === today;
            return (
              <div key={i} className={`id-tl__item kind-${it.kind} ${isFuture ? 'is-future' : ''} ${isToday ? 'is-today' : ''}`}>
                <div className="id-tl__rail">
                  <div className="id-tl__dot">{tlIcon(it)}</div>
                </div>
                <div className="id-tl__card">
                  <div className="id-tl__when">{fmtWhen(it.when)}{isToday && <span className="id-tl__today">Today</span>}{isFuture && <span className="id-tl__future">Upcoming</span>}</div>
                  <div className="id-tl__title">{it.title}</div>
                  {it.subtitle && <div className="id-tl__sub">{it.subtitle}</div>}
                  {it.who && people[it.who] && (
                    <div className="id-tl__who">
                      <window.RMAvatar id={it.who} people={people} size={16}/>
                      <span>{people[it.who].name}</span>
                    </div>
                  )}
                  {it.badges && it.badges.length > 0 && (
                    <div className="id-note__badges">{it.badges.map((b,j)=><span key={j} className="id-note__badge">{b}</span>)}</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function tlIcon(it) {
    if (it.kind === 'start') return '◆';
    if (it.kind === 'end') return '◇';
    if (it.kind === 'milestone') return it.mkind === 'launch' ? '▲' : (it.mkind === 'decision' ? '?' : (it.mkind === 'team' ? '◉' : '●'));
    if (it.kind === 'note') return SOURCE_META[it.source]?.icon || '✎';
    if (it.kind === 'done') return '✓';
    if (it.kind === 'status') return '!';
    return '·';
  }

  // ---------- Team tab ----------
  function TeamView({ initiative, people, allInitiatives, onOpenTask }) {
    const memberIds = [initiative.owner, ...(initiative.collaborators || [])];

    const memberStats = (id) => {
      const onThis = (initiative.tasks || []).filter(t => t.owner === id);
      const openOnThis = onThis.filter(t => t.status !== 'Completed');
      const highOnThis = openOnThis.filter(t => t.priority === 'High');
      // workload across all initiatives
      const total = (allInitiatives || []).reduce((acc, init) => {
        const ts = (init.tasks || []).filter(t => t.owner === id && t.status !== 'Completed');
        return acc + ts.length;
      }, 0);
      const totalHigh = (allInitiatives || []).reduce((acc, init) => {
        const ts = (init.tasks || []).filter(t => t.owner === id && t.status !== 'Completed' && t.priority === 'High');
        return acc + ts.length;
      }, 0);
      return { onThis, openOnThis, highOnThis, total, totalHigh };
    };

    const workloadPill = (stats) => {
      if (stats.totalHigh >= 4) return { label: 'Stretched', cls: 'is-stretch' };
      if (stats.total >= 6)     return { label: 'Heavy load', cls: 'is-heavy' };
      if (stats.total <= 2)     return { label: 'Light load', cls: 'is-light' };
      return { label: 'Balanced', cls: 'is-ok' };
    };

    return (
      <div className="id-team">
        <div className="id-team__head">
          <h3 className="id-section__title">Team <span className="id-section__count">{memberIds.length} on this initiative</span></h3>
          <button className="id-btn id-btn--ghost id-btn--sm">+ Add collaborator</button>
        </div>
        <div className="id-team__grid">
          {memberIds.map((id, idx) => {
            const p = people[id]; if (!p) return null;
            const stats = memberStats(id);
            const wl = workloadPill(stats);
            const isOwner = idx === 0;
            return (
              <div key={id} className="id-team__card">
                <div className="id-team__head-row">
                  <window.RMAvatar id={id} people={people} size={36}/>
                  <div className="id-team__name-col">
                    <div className="id-team__name">{p.name}</div>
                    <div className="id-team__role">{isOwner ? 'Owner' : 'Collaborator'}</div>
                  </div>
                  <span className={`id-team__wl ${wl.cls}`}>{wl.label}</span>
                </div>
                <div className="id-team__stats">
                  <div className="id-team__stat">
                    <span className="id-team__stat-num">{stats.openOnThis.length}</span>
                    <span className="id-team__stat-lbl">open here</span>
                  </div>
                  <div className="id-team__stat">
                    <span className="id-team__stat-num">{stats.highOnThis.length}</span>
                    <span className="id-team__stat-lbl">high pri</span>
                  </div>
                  <div className="id-team__stat">
                    <span className="id-team__stat-num">{stats.total}</span>
                    <span className="id-team__stat-lbl">all initiatives</span>
                  </div>
                </div>
                {stats.onThis.length > 0 ? (
                  <ul className="id-team__tasks">
                    {stats.onThis.map(t => (
                      <li key={t.id} className="id-team__task" onClick={()=>onOpenTask?.({task:t, init:initiative})}>
                        <span className={`sib-dot status-${window.STATUS_KEY?.[t.status] || 'not-started'}`}></span>
                        <span className="id-team__task-title">{t.title}</span>
                        {t.priority === 'High' && <span className="id-team__task-pri">High</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="id-team__empty">No tasks owned on this initiative yet.</div>
                )}
                <div className="id-team__actions">
                  <button className="id-btn id-btn--ghost id-btn--sm">Message via Slack</button>
                  <button className="id-btn id-btn--ghost id-btn--sm">Reassign tasks</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  window.InitiativeDetail = function InitiativeDetail({ initiative, onClose, onOpenTask }) {
    const data = window.ROADMAP_DATA;
    const allNotes = data.notes || [];
    const allSug = data.suggestedTasks || [];
    const [tab, setTab] = useState('notes');
    const [localNotes, setLocalNotes] = useState(allNotes.filter(n => n.initiativeId === initiative.id));
    const [dismissed, setDismissed] = useState(new Set());
    const [accepted, setAccepted] = useState(new Set());

    const sug = allSug.filter(s => s.initiativeId === initiative.id && !dismissed.has(s.id) && !accepted.has(s.id));

    const sortedNotes = useMemo(() => {
      return [...localNotes].sort((a,b) => (b.when||'').localeCompare(a.when||''));
    }, [localNotes]);

    const addNote = (note) => setLocalNotes(prev => [note, ...prev]);
    const acceptSug = (s) => {
      initiative.tasks.push({
        id: 't-' + Math.random().toString(36).slice(2,7),
        title: s.title, status: 'Not Started',
        owner: s.owner, due: data.today, priority: s.priority,
      });
      setAccepted(prev => new Set([...prev, s.id]));
    };

    return (
      <div className="id-overlay" onClick={onClose}>
        <div className="id-shell" onClick={e=>e.stopPropagation()}>
          <div className="id-header">
            <div>
              <div className={`badge dept-${window.DEPT_KEY?.[initiative.department] || 'b2b'}`}>{initiative.department}</div>
              <h1 className="id-title">{initiative.name}</h1>
              <p className="id-thesis">{initiative.thesis}</p>
            </div>
            <button className="id-close" onClick={onClose}>×</button>
          </div>

          <div className="id-tabs">
            <button className={`id-tab ${tab==='notes'?'is-active':''}`} onClick={()=>setTab('notes')}>Notes &amp; Tasks</button>
            <button className={`id-tab ${tab==='timeline'?'is-active':''}`} onClick={()=>setTab('timeline')}>Timeline</button>
            <button className={`id-tab ${tab==='team'?'is-active':''}`} onClick={()=>setTab('team')}>Team</button>
            <button className="id-tab is-disabled" title="Coming soon">Activity</button>
          </div>

          {tab === 'timeline' && (
            <div className="id-body id-body--single">
              <TimelineView initiative={initiative} notes={sortedNotes} people={data.people}/>
            </div>
          )}

          {tab === 'team' && (
            <div className="id-body id-body--single">
              <TeamView initiative={initiative} people={data.people} allInitiatives={data.initiatives} onOpenTask={onOpenTask}/>
            </div>
          )}

          {tab === 'notes' && (
          <div className="id-body">
            <div className="id-col id-col--main">
              {/* Suggested Tasks queue */}
              {sug.length > 0 && (
                <section className="id-section">
                  <div className="id-section__head">
                    <h3 className="id-section__title">
                      <span className="id-section__star">✦</span>
                      Suggested tasks <span className="id-section__count">{sug.length}</span>
                    </h3>
                    <span className="id-section__hint">From recent notes — accept to add to this initiative</span>
                  </div>
                  <div className="id-sug-list">
                    {sug.map(s => (
                      <SuggestedTask key={s.id} s={s}
                        onAccept={()=>acceptSug(s)}
                        onDismiss={()=>setDismissed(prev => new Set([...prev, s.id]))} />
                    ))}
                  </div>
                </section>
              )}

              {/* Notes log */}
              <section className="id-section">
                <div className="id-section__head">
                  <h3 className="id-section__title">Notes <span className="id-section__count">{sortedNotes.length}</span></h3>
                  <div className="id-source-filter">
                    <span className="id-source-chip is-active">All</span>
                    <span className="id-source-chip">◐ Granola</span>
                    <span className="id-source-chip"># Slack</span>
                    <span className="id-source-chip">✎ Manual</span>
                  </div>
                </div>
                <AddNote initiative={initiative} onAdd={addNote} />
                <div className="id-notes-list">
                  {sortedNotes.map(n => <NoteCard key={n.id} note={n} people={data.people} />)}
                  {sortedNotes.length === 0 && (
                    <div className="id-empty">No notes yet. Paste a meeting recap above, or send one from Slack with <code>@Marketing Bot tag {initiative.name}</code>.</div>
                  )}
                </div>
              </section>
            </div>

            <div className="id-col id-col--side">
              {/* Tasks rolled up */}
              <section className="id-section">
                <h3 className="id-section__title">Tasks <span className="id-section__count">{initiative.tasks.length}</span></h3>
                <ul className="id-task-list">
                  {initiative.tasks.map(t => (
                    <li key={t.id} className="id-task-list__item" onClick={()=>onOpenTask?.({task:t, init:initiative})}>
                      <span className={`sib-dot status-${window.STATUS_KEY?.[t.status] || 'not-started'}`}></span>
                      <span className="id-task-list__title">{t.title}</span>
                      <window.RMAvatar id={t.owner} people={data.people} size={16}/>
                    </li>
                  ))}
                </ul>
              </section>

              {/* How notes get in */}
              <section className="id-section">
                <h3 className="id-section__title">Capture from anywhere</h3>
                <div className="id-channels">
                  <div className="id-channel">
                    <span className="id-channel__icon" style={{color:'#6e8ac4'}}>◐</span>
                    <div>
                      <div className="id-channel__name">Granola</div>
                      <div className="id-channel__hint">Auto-routes when meeting is tagged with initiative name</div>
                    </div>
                    <span className="id-channel__status is-on">Synced</span>
                  </div>
                  <div className="id-channel">
                    <span className="id-channel__icon" style={{color:'#4a154b'}}>#</span>
                    <div>
                      <div className="id-channel__name">Marketing Bot · Slack</div>
                      <div className="id-channel__hint"><code>@Marketing Bot tag {initiative.name}</code></div>
                    </div>
                    <span className="id-channel__status is-on">Active</span>
                  </div>
                  <div className="id-channel">
                    <span className="id-channel__icon" style={{color:'#7a6f5f'}}>✎</span>
                    <div>
                      <div className="id-channel__name">Paste / type in app</div>
                      <div className="id-channel__hint">Auto-stamps you, time, and source</div>
                    </div>
                    <span className="id-channel__status is-on">Always on</span>
                  </div>
                </div>
                <SlackBotCard/>
              </section>
            </div>
          </div>
          )}
        </div>
      </div>
    );
  };
})();
