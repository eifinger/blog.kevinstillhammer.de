const $ = id => document.getElementById(id);
const fields = ['title', 'date', 'slug', 'categories', 'tags', 'markdown'];
let metadata = {};
let existing = false;
let dirty = false;
let locked = false;
let uploading = false;
let saving = false;
let loading = false;
let previewVersion = 0;
let previewTimer;
let revision = 0;
const backupKey = 'blog-editor-draft';

function fail(error) {
  $('error').textContent = error.message;
  $('error').hidden = false;
}

async function api(path, options = {}) {
  const response = await fetch(path, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result;
}

function post(path, data) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 100).replace(/-$/, '');
}

function values() {
  return Object.fromEntries(fields.map(key => [key, $(key).value]));
}

function backup() {
  try {
    localStorage.setItem(backupKey, JSON.stringify({ fields: values(), metadata, existing, locked, dirty }));
  } catch {
    fail(new Error('Browser recovery is unavailable. Save your draft to keep your changes.'));
  }
}

function update() {
  const name = $('slug').value || 'your-next-idea';
  $('title').style.height = 'auto';
  $('title').style.height = `${$('title').scrollHeight}px`;
  $('document-name').textContent = $('title').value || 'UNTITLED';
  $('draft-path').textContent = `Draft → _drafts/${name}.md`;
  $('image-path').textContent = `Images → assets/pictures/${name}/`;
  const words = $('markdown').value.trim().split(/\s+/).filter(Boolean).length;
  $('word-count').textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
  $('reading-time').textContent = `${Math.max(1, Math.ceil(words / 200))} min read`;
  $('preview-empty').hidden = Boolean($('title').value || $('markdown').value);
  $('markdown').readOnly = uploading;
  $('slug').readOnly = locked || saving;
  $('status').textContent = loading ? 'Loading from disk…' : uploading ? 'Adding image…' : saving ? 'Saving…' : dirty ? 'Unsaved changes' : existing ? 'Saved to repository' : 'New draft';
  fields.forEach(key => { $(key).disabled = loading; });
  $('save').disabled = uploading || saving || loading;
  $('new').disabled = uploading || saving || loading;
  $('drafts').disabled = uploading || saving || loading;
  $('add-image').disabled = uploading || saving || loading;
  $('reload').disabled = !existing || uploading || saving || loading;
  clearTimeout(previewTimer);
  const version = ++previewVersion;
  previewTimer = setTimeout(() => preview(version), 200);
}

function changed() {
  dirty = true;
  revision++;
  backup();
  update();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

async function preview(version) {
  try {
    const { title, date, markdown } = values();
    const { html } = await post('/api/preview', { markdown });
    if (version !== previewVersion) return;
    // Fragment links in srcdoc otherwise resolve against the editor's URL.
    const content = html.replaceAll('href="#', 'href="about:srcdoc#');
    $('preview').srcdoc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data:; style-src 'unsafe-inline' ${location.origin};"><link rel="stylesheet" href="${location.origin}/preview.css"></head><body class="post"><h1 class="post-title">${escapeHtml(title || 'Untitled post')}</h1><div class="post-meta">${escapeHtml(date)} · Kevin Stillhammer</div><div class="content"><div class="post-body">${content}</div></div></body></html>`;
  } catch (error) {
    if (version === previewVersion) fail(error);
  }
}

async function refreshDrafts() {
  const drafts = await api('/api/drafts');
  $('drafts').replaceChildren(new Option('Choose a draft…', ''), ...drafts.map(file => new Option(file.slice(0, -3), file.slice(0, -3))));
  $('drafts').value = existing ? $('slug').value : '';
}

async function save() {
  if (uploading || saving || loading) return;
  $('error').hidden = true;
  const data = values();
  const savedRevision = revision;
  saving = true;
  update();
  try {
    const list = value => value.split(',').map(item => item.trim()).filter(Boolean);
    const nextMetadata = { ...metadata, layout: 'post', title: data.title, date: data.date, excerpt_separator: metadata.excerpt_separator || '<!--more-->', categories: list(data.categories), tags: list(data.tags) };
    await post('/api/drafts', { slug: data.slug, markdown: data.markdown, metadata: nextMetadata, existing });
    metadata = nextMetadata;
    existing = locked = true;
    dirty = revision !== savedRevision;
    backup();
    await refreshDrafts();
  } catch (error) {
    fail(error);
  } finally {
    saving = false;
    update();
  }
}

function reset() {
  metadata = {};
  existing = dirty = locked = false;
  fields.forEach(key => { $(key).value = ''; });
  const today = new Date();
  $('date').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  $('drafts').value = '';
  $('error').hidden = true;
  backup();
  update();
}

fields.forEach(key => $(key).addEventListener('input', () => {
  if (key === 'title' && !locked && !saving && !$('slug').dataset.manual) $('slug').value = slugify($('title').value);
  if (key === 'slug') $('slug').dataset.manual = 'true';
  changed();
}));

$('save').addEventListener('click', save);
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});
window.addEventListener('resize', update);
window.addEventListener('beforeunload', event => {
  if (dirty || uploading || saving) { event.preventDefault(); event.returnValue = ''; }
});

$('new').addEventListener('click', () => {
  if (dirty && !confirm('Discard unsaved changes and start a new draft?')) return;
  delete $('slug').dataset.manual;
  reset();
  $('title').focus();
});
async function loadDraft(name) {
  if (!name || uploading || saving || loading) return;
  if (dirty && !confirm('Discard unsaved changes and load the saved draft from disk?')) {
    $('drafts').value = existing ? $('slug').value : '';
    return;
  }
  loading = true;
  update();
  try {
    const draft = await api(`/api/drafts/${encodeURIComponent(name)}`);
    metadata = draft.metadata;
    const list = value => Array.isArray(value) ? value.join(', ') : value || '';
    $('title').value = metadata.title || '';
    $('date').value = String(metadata.date || '').slice(0, 10);
    $('slug').value = name;
    $('categories').value = list(metadata.categories);
    $('tags').value = list(metadata.tags);
    $('markdown').value = draft.markdown;
    existing = locked = true;
    dirty = false;
    $('error').hidden = true;
    $('drafts').value = name;
    backup();
  } catch (error) {
    fail(error);
  } finally {
    loading = false;
    update();
  }
}

$('drafts').addEventListener('change', () => loadDraft($('drafts').value));
$('reload').addEventListener('click', () => loadDraft($('slug').value));

document.querySelectorAll('[data-view]').forEach(button => {
  if (button.tagName !== 'BUTTON') return;
  button.addEventListener('click', () => {
    $('panes').dataset.view = button.dataset.view;
    document.querySelectorAll('button[data-view]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  });
});

async function addImages(files) {
  if (uploading || saving || loading || !files.length) return;
  if (!$('slug').value || !$('slug').checkValidity()) return fail(new Error('Add a title and a valid file slug before adding images.'));
  const editor = $('markdown');
  const name = $('slug').value;
  // Keep the insertion point stable until all images have been added.
  let position = editor.selectionStart;
  uploading = true;
  locked = true;
  backup();
  update();
  try {
    $('error').hidden = true;
    for (const file of files) {
      if (file.size > 15 * 1024 * 1024) throw new Error('File too large. Maximum size is 15 MB.');
      const result = await api(`/api/images?slug=${encodeURIComponent(name)}`, { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]\\\r\n]/g, ' ').trim() || 'Image';
      const insertion = `\n![${alt}](${result.path})\n`;
      editor.setRangeText(insertion, position, position, 'preserve');
      position += insertion.length;
      changed();
    }
    editor.focus();
    editor.setSelectionRange(position, position);
  } catch (error) {
    fail(error);
  } finally {
    uploading = false;
    backup();
    update();
  }
}

$('markdown').addEventListener('paste', event => {
  const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile());
  if (files.length) { event.preventDefault(); addImages(files); }
});
$('markdown').addEventListener('dragover', event => event.preventDefault());
$('markdown').addEventListener('drop', event => {
  if (event.dataTransfer.files.length) { event.preventDefault(); addImages([...event.dataTransfer.files]); }
});
$('add-image').addEventListener('click', () => $('image-file').click());
$('image-file').addEventListener('change', () => {
  addImages([...$('image-file').files]);
  $('image-file').value = '';
});

try {
  const saved = JSON.parse(localStorage.getItem(backupKey) || 'null');
  if (saved) {
    fields.forEach(key => { $(key).value = saved.fields[key] || ''; });
    ({ metadata, existing, locked, dirty } = saved);
    if ($('slug').value) $('slug').dataset.manual = 'true';
    update();
  } else reset();
} catch { reset(); }
refreshDrafts().catch(fail);
