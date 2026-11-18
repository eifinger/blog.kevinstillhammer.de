import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, rename } from 'node:fs/promises';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { marked } from 'marked';
import markedFootnote from 'marked-footnote';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';
import { parse, stringify } from 'yaml';
import { compileString } from 'sass';

marked.use(markedFootnote({ headingClass: '' }), markedHighlight({
  emptyLangClass: 'hljs',
  langPrefix: 'hljs language-',
  highlight(code, language) {
    if (hljs.getLanguage(language)) return hljs.highlight(code, { language }).value;
  },
}));

const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../..');
const imageTypes = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function check(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function slug(value) {
  check(typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 100, 'Use a slug with lowercase letters, numbers, and hyphens (up to 100 characters).');
  return value;
}

async function body(request, limit = 15 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= limit) chunks.push(chunk);
  }
  check(size <= limit, 'File too large. Maximum size is 15 MB.', 413);
  return Buffer.concat(chunks);
}

function readDraft(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  check(match, 'This draft has no YAML front matter.');
  const metadata = parse(match[1]);
  check(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'Invalid draft metadata.');
  return { metadata, markdown: source.slice(match[0].length).replace(/^\r?\n/, '') };
}

// Only the article styles are needed inside the isolated Markdown preview.
const previewCss = await readFile(new URL(import.meta.resolve('highlight.js/styles/github.css')), 'utf8') + compileString(`
  @import 'hydeout/variables', 'hydeout/base', 'hydeout/type', 'hydeout/syntax', 'hydeout/code', 'hydeout/posts';
  body { background: white; padding: 32px; margin: 0 auto; max-width: 780px; }
  h1 { overflow-wrap: anywhere; } img { max-width: 100%; height: auto; }
  pre, table { max-width: 100%; overflow: auto; } .post-meta { margin-top: 0; }
  pre code.hljs { font-size: .8rem; line-height: 1.4; background: #f9f9f9; border-radius: .25rem; }
`, { loadPaths: [resolve(repository, '_sass')], logger: { warn() {}, debug() {} } }).css;

export function editorServer(root = repository) {
  return createServer(async (request, response) => {
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(value));
    };
    try {
      const url = new URL(request.url, 'http://editor.local');
      const path = decodeURIComponent(url.pathname);
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Cache-Control', 'no-store');
      if (request.method === 'POST') {
        // JSON and binary-only writes, plus same-origin checks, prevent cross-site writes.
        const origin = request.headers.origin;
        check(!origin || new URL(origin).host === request.headers.host, 'Cross-origin writes are not allowed.', 403);
        check(request.headers['sec-fetch-site'] !== 'cross-site', 'Cross-origin writes are not allowed.', 403);
        if (path === '/api/images') {
          const folder = slug(url.searchParams.get('slug'));
          check(Object.hasOwn(imageTypes, request.headers['content-type']), 'Use a PNG, JPEG, GIF, or WebP image.');
          const extension = imageTypes[request.headers['content-type']];
          const bytes = await body(request);
          check(bytes.length > 0, 'The image is empty.');
          const directory = resolve(root, 'assets/pictures', folder);
          await mkdir(directory, { recursive: true });
          const filename = `${randomUUID()}.${extension}`;
          await writeFile(resolve(directory, filename), bytes, { flag: 'wx' });
          return json(201, { path: `/assets/pictures/${folder}/${filename}` });
        }
        check(request.headers['content-type'] === 'application/json', 'Expected JSON.', 415);
        const data = JSON.parse((await body(request)).toString());
        if (path === '/api/preview') {
          check(typeof data.markdown === 'string', 'Markdown is required.');
          return json(200, { html: marked.parse(data.markdown) });
        }
        if (path === '/api/drafts') {
          const name = slug(data.slug);
          check(typeof data.markdown === 'string', 'Markdown is required.');
          check(data.metadata && typeof data.metadata.title === 'string' && data.metadata.title.trim(), 'Give your post a title.');
          check(/^\d{4}-\d{2}-\d{2}$/.test(data.metadata.date), 'Choose a date.');
          const directory = resolve(root, '_drafts');
          await mkdir(directory, { recursive: true });
          const target = resolve(directory, `${name}.md`);
          const source = `---\n${stringify({ ...data.metadata, layout: 'post' })}---\n\n${data.markdown}`;
          if (data.existing) {
            // Atomic replacement keeps an interrupted save from truncating a draft.
            await readFile(target);
            const temporary = `${target}.${randomUUID()}.tmp`;
            await writeFile(temporary, source);
            await rename(temporary, target);
          } else {
            await writeFile(target, source, { flag: 'wx' });
          }
          return json(200, { path: `_drafts/${name}.md` });
        }
      }
      if (request.method === 'GET') {
        if (path === '/api/drafts') {
          const files = await readdir(resolve(root, '_drafts')).catch(error => {
            if (error.code === 'ENOENT') return [];
            throw error;
          });
          return json(200, files.filter(name => /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name)).sort());
        }
        if (path.startsWith('/api/drafts/')) {
          const name = slug(path.slice('/api/drafts/'.length));
          return json(200, readDraft(await readFile(resolve(root, '_drafts', `${name}.md`), 'utf8')));
        }
        if (path === '/preview.css') {
          response.writeHead(200, { 'Content-Type': 'text/css' });
          return response.end(previewCss);
        }
        const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
        let filename;
        if (Object.hasOwn(files, path)) filename = resolve(here, files[path]);
        else if (/^\/assets\/pictures\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+\.(png|jpe?g|gif|webp)$/i.test(path)) filename = resolve(root, path.slice(1));
        if (filename) {
          const bytes = await readFile(filename);
          response.writeHead(200, { 'Content-Type': mime[extname(filename)] || 'application/octet-stream' });
          return response.end(bytes);
        }
      }
      json(404, { error: 'Not found.' });
    } catch (error) {
      const status = error.status || ({ ENOENT: 404, EEXIST: 409 })[error.code] || (error instanceof SyntaxError ? 400 : 500);
      json(status, { error: error.code === 'EEXIST' ? 'That draft already exists. Open it from the draft list or choose a different slug.' : status === 500 ? 'Could not complete the request. Check the editor terminal.' : error.message });
      if (status === 500) console.error(error);
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  editorServer().listen(port, '127.0.0.1', () => console.log(`Blog editor: http://localhost:${port}`));
}
