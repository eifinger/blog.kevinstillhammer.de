import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { editorServer } from './server.mjs';

async function setup(t) {
  const base = resolve('.amp/in/orb-backup');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, 'editor-test-'));
  const server = editorServer(root).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise(done => server.close(done));
    await rm(root, { recursive: true, force: true });
  });
  const request = (path, options) => fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
  const post = (path, data) => request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { root, request, post };
}

test('drafts round-trip Markdown and YAML, reject collisions, and update without publishing', async t => {
  const { root, request, post } = await setup(t);
  assert.deepEqual(await (await request('/api/drafts')).json(), []);
  const draft = { slug: 'a-post-with-images', metadata: { title: 'Tests: "Kotlin" & YAML', date: '2026-11-17', categories: ['Archive'], tags: ['JVM', 'Testing'], custom: 'preserved', excerpt_separator: '<!--more-->' }, markdown: 'First paragraph.\n\n<!--more-->\n\n## Next\n\n![A](/assets/pictures/a-post-with-images/a.png)\n' };
  assert.equal((await post('/api/drafts', draft)).status, 200);
  assert.deepEqual(await (await request('/api/drafts')).json(), ['a-post-with-images.md']);
  assert.deepEqual(await (await request('/api/drafts/a-post-with-images')).json(), { metadata: { ...draft.metadata, layout: 'post' }, markdown: draft.markdown });
  assert.equal((await post('/api/drafts', { ...draft, markdown: 'must not overwrite' })).status, 409);
  assert.match(await readFile(resolve(root, '_drafts/a-post-with-images.md'), 'utf8'), /First paragraph/);
  assert.equal((await post('/api/drafts', { ...draft, existing: true, markdown: 'Updated body' })).status, 200);
  assert.equal((await (await request('/api/drafts/a-post-with-images')).json()).markdown, 'Updated body');
  await assert.rejects(readFile(resolve(root, '_posts/2026-11-17-a-post-with-images.md')), { code: 'ENOENT' });
});

test('images are written and served byte-for-byte in the post folder with unique names', async t => {
  const { root, request } = await setup(t);
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4T8AAAAASUVORK5CYII=', 'base64');
  const upload = () => request('/api/images?slug=my-first-post', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
  const first = await upload();
  assert.equal(first.status, 201);
  const { path } = await first.json();
  const second = await (await upload()).json();
  assert.match(path, /^\/assets\/pictures\/my-first-post\/[a-f0-9-]+\.png$/);
  assert.notEqual(path, second.path);
  assert.deepEqual(await readFile(resolve(root, path.slice(1))), bytes);
  const served = await request(path);
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), bytes);
  assert.equal((await request('/api/images?slug=my-first-post', { method: 'POST', headers: { 'Content-Type': 'image/svg+xml' }, body: '<svg/>' })).status, 400);
  const oversized = await request('/api/images?slug=my-first-post', { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: Buffer.alloc(15 * 1024 * 1024 + 1) });
  assert.equal(oversized.status, 413);
  assert.match((await oversized.json()).error, /15 MB/);
});

test('preview renders Markdown and writes cannot escape the repository or come from another origin', async t => {
  const { request, post } = await setup(t);
  const response = await post('/api/preview', { markdown: '## A heading\n\n**Strong** and `inline`\n\n```kotlin\nval x = 3\n```\n\n![alt](/assets/pictures/photo.png)\n\nAWS setup[^amp].\n\n[^amp]: See the [Amp doc](https://ampcode.com/docs/orbs/handling-secrets#oidc).' });
  const { html } = await response.json();
  assert.match(html, /<h2>A heading<\/h2>/);
  assert.match(html, /<strong>Strong<\/strong> and <code>inline<\/code>/);
  assert.match(html, /class="[^"]*\blanguage-kotlin\b/);
  assert.match(html, /src="\/assets\/pictures\/photo.png" alt="alt"/);
  assert.match(html, /<sup><a[^>]*href="#[^"]+"[^>]*>1<\/a><\/sup>/);
  assert.match(html, /href="https:\/\/ampcode.com\/docs\/orbs\/handling-secrets#oidc">Amp doc<\/a>/);
  assert.doesNotMatch(html, /\[\^amp\]/);
  for (const slug of ['../outside', 'a/b', '', 'Uppercase', 'a'.repeat(101)]) {
    assert.equal((await post('/api/drafts', { slug })).status, 400);
    assert.equal((await request(`/api/images?slug=${encodeURIComponent(slug)}`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'x' })).status, 400);
  }
  assert.equal((await request('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' }, body: '{"markdown":"hello"}' })).status, 403);
  assert.equal((await request('/package.json')).status, 404);
  assert.equal((await request('/.git/config')).status, 404);
  assert.equal((await request('/api/drafts/missing')).status, 404);
});

test('preview highlights labeled code, including in details, and safely leaves other code plain', async t => {
  const { post } = await setup(t);
  for (const [language, code] of [
    ['typescript', 'const name: string = "<script>alert(1)</script>";'],
    ['ts', 'interface Grant { expiresAt: string }'],
    ['json', '{ "approved": true }'],
    ['bash', 'echo "$HOME"'],
    ['not-a-language', '<script>alert("plain")</script>'],
    ['', '<script>alert("unlabeled")</script>'],
  ]) {
    const markdown = `<details markdown="block">\n<summary>Example</summary>\n\n\`\`\`${language}\n${code}\n\`\`\`\n\n</details>`;
    const response = await post('/api/preview', { markdown });
    assert.equal(response.status, 200);
    const { html } = await response.json();
    assert.match(html, /<details[^>]*>[\s\S]*<pre><code/);
    assert.doesNotMatch(html, /<script>/);
    if (language && language !== 'not-a-language') {
      assert.match(html, /<span\b/);
    } else {
      assert.doesNotMatch(html, /<span\b/);
      assert.match(html, /&lt;script&gt;alert\(/);
    }
  }
});
