# eifingers Blog

The repository for my blog under https://blog.kevineifinger.de

Using the [Hydeout](https://github.com/fongandrew/hydeout) theme for Jekyll

## Post editor

Requires Node.js 22 or newer. Run `npm install --legacy-peer-deps`, then
`npm run editor` and open the address printed in the terminal.
The install flag is needed for the existing Stylelint peer dependencies.

- Write Markdown with Write, Split view, or Preview modes.
- Paste, drop, or select PNG, JPEG, GIF, and WebP images (up to 15 MB each).
  Images go to `assets/pictures/<slug>/` with Markdown links inserted at the cursor.
- Save with **Save draft** or **Ctrl/Cmd+S**. Reopen drafts from the draft list.
  Drafts are Jekyll Markdown files in `_drafts/`; the browser also keeps a recovery copy.
- Use **Reload from disk** to load file changes made outside the editor.
  Confirm before replacing unsaved edits.
- Preview uses the blog’s article styles and highlights fenced code blocks with
  a language label, such as `typescript`. Liquid tags require a Jekyll build.

Saving does not publish, commit, or push. To prepare a finished draft for publication,
move it to `_posts/YYYY-MM-DD-<slug>.md`. Keep image paths unchanged.
The editor binds to loopback and is for trusted local use or a private Amp portal,
not public hosting. Run its tests with `npm run test:editor`.

## Attribution

Logos under [_includes/svg](_includes/svg) are taken from http://materialdesignicons.com/
