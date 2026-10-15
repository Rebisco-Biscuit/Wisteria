const $ = (sel) => document.querySelector(sel);

const state = { tree: { folders: [], files: [] }, query: '', open: null };

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'x-wisteria': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
  });
  if (res.status === 401 && url !== '/api/login') {
    showLogin();
    throw new Error('Signed out');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const fileUrl = (key, download) => `/api/file?key=${encodeURIComponent(key)}${download ? '&download=1' : ''}`;

function formatSize(bytes) {
  if (bytes == null) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(i && bytes < 10 ? 1 : 0)} ${units[i]}`;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  node.append(...children.filter((c) => c != null));
  return node;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/* ---------- login ---------- */

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  if ($('#detail').open) $('#detail').close();
  $('#password').focus();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
  }
});

$('#logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  showLogin();
});

/* ---------- vault ---------- */

async function showApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  await refresh();
}

async function refresh() {
  try {
    state.tree = await api('/api/vault');
    render();
  } catch (err) {
    if (err.message !== 'Signed out') toast(err.message);
  }
}

function render() {
  const q = state.query.trim().toLowerCase();
  const items = [
    ...state.tree.folders.map((f) => ({ type: 'folder', name: f.name, mtime: f.mtime, data: f })),
    ...state.tree.files.map((f) => ({ type: 'file', name: f.name, mtime: f.mtime, data: f })),
  ]
    .filter((i) => !q || i.name.toLowerCase().includes(q)
      || (i.type === 'folder' && i.data.files.some((f) => f.name.toLowerCase().includes(q))))
    .sort((a, b) => b.mtime - a.mtime);

  const grid = $('#grid');
  grid.replaceChildren(...items.map((i) => (i.type === 'folder' ? folderCard(i.data) : fileCard(i.data))));

  const total = state.tree.folders.length + state.tree.files.length;
  $('#empty').hidden = total > 0;
  const nFiles = state.tree.files.length + state.tree.folders.reduce((n, f) => n + f.files.length, 0);
  $('#stats').textContent = total
    ? `${state.tree.folders.length} folder${state.tree.folders.length === 1 ? '' : 's'} · ${nFiles} file${nFiles === 1 ? '' : 's'}`
      + (q ? ` · showing ${items.length}` : '')
    : '';

  // keep an open dialog in sync after deletes/uploads
  if (state.open && $('#detail').open) {
    const fresh = state.open.type === 'folder'
      ? state.tree.folders.find((f) => f.name === state.open.data.name)
      : state.tree.files.find((f) => f.key === state.open.data.key);
    if (fresh) openDetail(state.open.type, fresh);
    else $('#detail').close();
  }
}

function thumb(file) {
  if (file && file.image) return el('img', { src: fileUrl(file.key), alt: '', loading: 'lazy' });
  return el('span', { class: 'ext-tile' }, (file?.ext || '?').toUpperCase());
}

function folderCard(folder) {
  const cover = folder.files.find((f) => f.key === folder.cover) || folder.files[0];
  const exts = [...new Set(folder.files.map((f) => f.ext.toUpperCase()))].join(' · ');
  return el('button', { class: 'card', type: 'button', onclick: () => openDetail('folder', folder) },
    el('div', { class: 'thumb' }, thumb(cover), el('span', { class: 'folder-badge' }, `▤ ${folder.files.length}`)),
    el('div', { class: 'card-body' },
      el('div', { class: 'card-name', title: folder.name }, folder.name),
      el('div', { class: 'card-meta' }, exts)));
}

function fileCard(file) {
  return el('button', { class: 'card', type: 'button', onclick: () => openDetail('file', file) },
    el('div', { class: 'thumb' }, thumb(file)),
    el('div', { class: 'card-body' },
      el('div', { class: 'card-name', title: file.name }, file.name),
      el('div', { class: 'card-meta' }, formatSize(file.size))));
}

/* ---------- detail dialog ---------- */

function openDetail(type, data) {
  state.open = { type, data };
  const files = type === 'folder' ? data.files : [data];
  const cover = type === 'folder' ? files.find((f) => f.key === data.cover) : (data.image ? data : null);

  $('#detail-title').textContent = type === 'folder' ? `${data.name}/` : data.name;
  $('#detail-preview').replaceChildren(...(cover ? [el('img', { src: fileUrl(cover.key), alt: cover.name })] : []));
  $('#detail-files').replaceChildren(...files.map((f) => el('li', {},
    el('span', { class: 'fname' }, f.name),
    el('span', { class: 'fsize' }, formatSize(f.size)),
    f.image ? el('a', { class: 'btn ghost', href: fileUrl(f.key), target: '_blank', rel: 'noopener' }, 'Open') : null,
    el('a', { class: 'btn', href: fileUrl(f.key, true) }, 'Download'),
    type === 'folder' ? el('button', { class: 'btn ghost danger', type: 'button', onclick: () => deleteFile(f) }, 'Delete') : null,
  )));
  $('#detail-delete').textContent = type === 'folder' ? 'Delete folder' : 'Delete';

  if (!$('#detail').open) $('#detail').showModal();
}

async function deleteFile(file) {
  if (!confirm(`Delete "${file.key}"? This can't be undone.`)) return;
  try {
    await api(`/api/file?key=${encodeURIComponent(file.key)}`, { method: 'DELETE' });
    toast(`Deleted ${file.name}`);
    await refresh();
  } catch (err) {
    toast(err.message);
  }
}

$('#detail-delete').addEventListener('click', async () => {
  const { type, data } = state.open;
  if (type === 'file') return deleteFile(data);
  if (!confirm(`Delete the folder "${data.name}" and all ${data.files.length} files in it? This can't be undone.`)) return;
  try {
    await api(`/api/folder?name=${encodeURIComponent(data.name)}`, { method: 'DELETE' });
    toast(`Deleted ${data.name}/`);
    $('#detail').close();
    await refresh();
  } catch (err) {
    toast(err.message);
  }
});

$('#detail').addEventListener('click', (e) => {
  // close on backdrop click or the ✕
  if (e.target === e.currentTarget || e.target.closest('[data-close]')) $('#detail').close();
});
$('#detail').addEventListener('close', () => (state.open = null));

/* ---------- uploads ---------- */

function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;

  const existing = new Set([
    ...state.tree.files.map((f) => f.name.toLowerCase()),
    ...state.tree.folders.flatMap((f) => f.files.map((x) => x.name.toLowerCase())),
  ]);
  const dupes = files.filter((f) => existing.has(f.name.toLowerCase()));
  if (dupes.length && !confirm(`${dupes.map((f) => f.name).join(', ')} already in the vault. Replace?`)) return;

  const form = new FormData();
  for (const f of files) form.append('files', f, f.name);

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/upload');
  xhr.setRequestHeader('x-wisteria', '1');
  $('#progress').hidden = false;
  $('#progress-text').textContent = `Uploading ${files.length} file${files.length === 1 ? '' : 's'}…`;
  $('#progress-fill').style.width = '0%';

  xhr.upload.onprogress = (e) => {
    if (!e.lengthComputable) return;
    const pct = Math.round((e.loaded / e.total) * 100);
    $('#progress-fill').style.width = `${pct}%`;
    $('#progress-text').textContent = pct < 100 ? `Uploading… ${pct}%` : 'Saving…';
  };
  xhr.onload = async () => {
    $('#progress').hidden = true;
    let data = {};
    try { data = JSON.parse(xhr.responseText); } catch {}
    if (xhr.status === 401) return showLogin();
    if (xhr.status >= 400) return toast(data.error || `Upload failed (${xhr.status})`);
    const grouped = (data.saved || []).filter((k) => k.includes('/')).length;
    toast(`Uploaded ${data.saved.length} file${data.saved.length === 1 ? '' : 's'}`
      + (grouped ? ` · ${grouped} filed into folders` : '')
      + (data.skipped?.length ? ` · skipped ${data.skipped.length}` : ''));
    await refresh();
  };
  xhr.onerror = () => {
    $('#progress').hidden = true;
    toast('Upload failed. Check your connection.');
  };
  xhr.send(form);
}

$('#file-input').addEventListener('change', (e) => {
  uploadFiles(e.target.files);
  e.target.value = '';
});

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if ($('#app').hidden || !hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('#dropzone').hidden = false;
});
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) { dragDepth = 0; $('#dropzone').hidden = true; }
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('#dropzone').hidden = true;
  if (!$('#app').hidden) uploadFiles(e.dataTransfer.files);
});

$('#search').addEventListener('input', (e) => {
  state.query = e.target.value;
  render();
});

/* ---------- boot ---------- */

api('/api/session')
  .then((s) => (s.authed ? showApp() : showLogin()))
  .catch(() => showLogin());
