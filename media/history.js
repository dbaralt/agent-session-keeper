// @ts-check
(function () {
  const vscode = acquireVsCodeApi();

  /** @type {any[]} */
  let sessions = [];
  /** @type {{path: string, name: string}[]} */
  let workspaces = [];
  const selected = new Set();
  let sortBy = 'lastActive';
  let sortDir = 'desc';

  const el = (id) => document.getElementById(id);
  const rows = el('rows');
  const empty = el('empty');
  const count = el('count');

  const BADGES = { claude: 'C', pi: '\u03c0' };

  function formatDate(iso) {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function key(session) {
    return `${session.agent}/${session.sessionId}`;
  }

  function matches(session) {
    const text = el('search').value.trim().toLowerCase();
    const agent = el('agent').value;
    const status = el('status').value;
    const workspace = el('workspace').value;
    const from = el('from').value ? Date.parse(`${el('from').value}T00:00:00`) : undefined;
    const to = el('to').value ? Date.parse(`${el('to').value}T23:59:59`) : undefined;

    if (status !== 'archived' && session.status === 'archived' && status === '') return false;
    if (status && session.status !== status) return false;
    if (agent && session.agent !== agent) return false;
    if (workspace && session.workspaceFolder !== workspace) return false;
    const lastActive = Date.parse(session.lastActiveAt);
    if (from !== undefined && lastActive < from) return false;
    if (to !== undefined && lastActive > to) return false;
    if (text) {
      const haystack = `${session.title} ${session.cwd} ${session.workspaceName || ''} ${
        session.gitBranch || ''
      } ${session.sessionId}`.toLowerCase();
      if (!haystack.includes(text)) return false;
    }
    return true;
  }

  function filtered() {
    const list = sessions.filter(matches);
    const direction = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      let compare;
      if (sortBy === 'title') compare = a.title.localeCompare(b.title);
      else if (sortBy === 'agent') compare = a.agent.localeCompare(b.agent);
      else if (sortBy === 'created') compare = Date.parse(a.createdAt) - Date.parse(b.createdAt);
      else compare = Date.parse(a.lastActiveAt) - Date.parse(b.lastActiveAt);
      return compare * direction;
    });
    return list;
  }

  function actionButton(label, action, session, title) {
    const button = document.createElement('button');
    button.className = 'row-action';
    button.textContent = label;
    button.title = title;
    button.addEventListener('click', () => {
      vscode.postMessage({
        type: 'action',
        action,
        agent: session.agent,
        sessionId: session.sessionId,
      });
    });
    return button;
  }

  function render() {
    const list = filtered();
    rows.replaceChildren();
    count.textContent = `${list.length} of ${sessions.length}`;
    empty.style.display = list.length === 0 ? 'block' : 'none';

    for (const session of list) {
      const tr = document.createElement('tr');

      const selectCell = document.createElement('td');
      selectCell.className = 'select';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(key(session));
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(key(session));
        else selected.delete(key(session));
      });
      selectCell.appendChild(checkbox);
      tr.appendChild(selectCell);

      const titleCell = document.createElement('td');
      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = session.title;
      const sub = document.createElement('div');
      sub.className = 'sub';
      sub.textContent = session.sessionId;
      titleCell.append(title, sub);
      tr.appendChild(titleCell);

      const agentCell = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = BADGES[session.agent] || session.agent.slice(0, 1).toUpperCase();
      badge.title = session.agent;
      agentCell.appendChild(badge);
      tr.appendChild(agentCell);

      const folderCell = document.createElement('td');
      folderCell.textContent = session.workspaceName || session.cwd;
      folderCell.title = session.cwd;
      tr.appendChild(folderCell);

      const branchCell = document.createElement('td');
      branchCell.textContent = session.gitBranch || '';
      tr.appendChild(branchCell);

      const startedCell = document.createElement('td');
      startedCell.textContent = formatDate(session.createdAt);
      tr.appendChild(startedCell);

      const activeCell = document.createElement('td');
      activeCell.textContent = formatDate(session.lastActiveAt);
      tr.appendChild(activeCell);

      const statusCell = document.createElement('td');
      const status = document.createElement('span');
      status.className = `status status-${session.status}`;
      status.textContent = session.status;
      statusCell.appendChild(status);
      tr.appendChild(statusCell);

      const actionsCell = document.createElement('td');
      actionsCell.className = 'actions';
      actionsCell.append(
        actionButton('Resume', 'resume', session, 'Resume this session'),
        actionButton(session.pinned ? 'Unpin' : 'Pin', 'togglePin', session, 'Pin or unpin'),
        actionButton('Rename', 'rename', session, 'Rename this session'),
        actionButton('Copy', 'copyResumeCommand', session, 'Copy resume command'),
        actionButton('Transcript', 'openTranscript', session, 'Open transcript file'),
        actionButton('Archive', 'archive', session, 'Archive this session'),
        actionButton('Delete', 'deleteRecord', session, 'Delete this record'),
      );
      tr.appendChild(actionsCell);

      rows.appendChild(tr);
    }
  }

  function fillFilters() {
    const agentSelect = el('agent');
    const agents = [...new Set(sessions.map((session) => session.agent))].sort();
    for (const agent of agents) {
      const option = document.createElement('option');
      option.value = agent;
      option.textContent = agent;
      agentSelect.appendChild(option);
    }
    const statusSelect = el('status');
    const statuses = [...new Set(sessions.map((session) => session.status))].sort();
    for (const status of statuses) {
      const option = document.createElement('option');
      option.value = status;
      option.textContent = status === 'archived' ? 'Archived' : status;
      statusSelect.appendChild(option);
    }
    const workspaceSelect = el('workspace');
    for (const workspace of workspaces) {
      const option = document.createElement('option');
      option.value = workspace.path;
      option.textContent = workspace.name;
      workspaceSelect.appendChild(option);
    }
  }

  for (const id of ['search', 'agent', 'status', 'workspace', 'from', 'to']) {
    el(id).addEventListener('input', render);
  }

  el('resume-selected').addEventListener('click', () => {
    if (selected.size === 0) return;
    vscode.postMessage({ type: 'resumeSelected', sessionIds: [...selected] });
    selected.clear();
    render();
  });

  el('select-all').addEventListener('change', (event) => {
    const checked = event.target.checked;
    for (const session of filtered()) {
      if (checked) selected.add(key(session));
      else selected.delete(key(session));
    }
    render();
  });

  for (const th of document.querySelectorAll('th[data-sort]')) {
    th.addEventListener('click', () => {
      const next = th.getAttribute('data-sort');
      if (sortBy === next) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else {
        sortBy = next;
        sortDir = next === 'title' ? 'asc' : 'desc';
      }
      render();
    });
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'sessions') {
      const firstLoad = sessions.length === 0;
      sessions = message.sessions || [];
      workspaces = message.workspaces || [];
      if (firstLoad) fillFilters();
      render();
    }
  });

  vscode.postMessage({ type: 'ready' });
})();
