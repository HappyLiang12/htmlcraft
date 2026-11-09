# htmlcraft

Visual editor, CLI, and MCP server for self-contained HTML presentations. A deck
is one HTML file: slides are ordinary DOM elements, styles are ordinary CSS, and
every object keeps a stable id so the editor and AI agents can address it.

This package bundles the editor assets and the `htmlcraft` agent skill, so it works
without a build step or extra downloads.

## Install

```bash
npm install -g htmlcraft
# or run without installing
npx -y htmlcraft --help
```

## CLI

```bash
npx htmlcraft new deck.html --slides 3
npx htmlcraft validate deck.html
npx htmlcraft open deck.html
npx htmlcraft stop deck.html
npx htmlcraft export deck.html --format html
npx htmlcraft export deck.html --format pdf
npx htmlcraft export deck.html --format png --out dist/png
```

`htmlcraft open` starts a local editor on `127.0.0.1` with a capability token
recorded for that deck. Later `open` calls for the same deck reuse the recorded
port and token, so the printed tokenized URL keeps working across a host
restart; `htmlcraft stop` rotates the token, and replacing a stale-build host
rotates it too because `open` stops the broken host first, so a URL bookmarked
before the replacement needs the newly printed one. The first tokenized visit
exchanges the token for an HttpOnly, `SameSite=Strict` session cookie with a
30-day `Max-Age`, so the browser stays signed in to that deck. Add
`--no-browser` to only print the URL. The editor's
Export menu writes HTML, PDF, or PNG next to the deck; unsaved edits are also
mirrored to IndexedDB so a crash can offer recovery. Without a host, the editor
falls back to upload/download mode. PDF and PNG export use a locally installed
Chrome, Edge, or Chromium; set `HTMLCRAFT_CHROMIUM` to choose one explicitly. The
CLI refuses to overwrite the source deck.

## MCP

Add the server to an MCP client:

```json
{
  "mcpServers": {
    "htmlcraft": {
      "command": "npx",
      "args": ["-y", "htmlcraft", "mcp"]
    }
  }
}
```

If you installed the package globally, `"command": "htmlcraft-mcp"` works too.

The server exposes deck tools (`create_deck`, `validate_deck`, `set_text`,
`open_editor`, and more) plus the `htmlcraft://contract` and
`htmlcraft://authoring` resources. Reference material ships in `dist/skill/`.

## Requirements

- Node.js 20 or newer.
- Chrome, Edge, or Chromium for PDF/PNG export; set `HTMLCRAFT_CHROMIUM` to choose
  one explicitly.
- No telemetry and no remote calls: the editor and MCP server only touch the
  deck you open.

## License

MIT. See [LICENSE](LICENSE); third-party notices are in
[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md); report vulnerabilities as
described in [SECURITY.md](SECURITY.md).
