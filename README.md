# RowBot_frontend

Static frontend for [RowBot](../RowBot_backend). Upload a spreadsheet, ask a
question in plain English, get SQL and results back.

## There is nothing to install

No build step, no bundler, no `npm install`. Four files ship as-is:

| File | Role |
|---|---|
| `index.html` | Markup, CSP, and the topbar / cards / results structure |
| `style.css` | Design tokens and all styling |
| `script.js` | App logic, connection handling, and page animation |
| `particles.js` | Background particle field (own canvas + rAF loop) |
| `game.js` | "Rogue Rows" — the game behind the mystery box |

## Runtime dependencies

Loaded by the browser from a CDN at page load. **Versions are pinned on
purpose** — an unpinned CDN import runs whatever that URL serves tomorrow,
with full DOM access to the API key field.

| Dependency | Version | Loaded from |
|---|---|---|
| `animejs` | **4.5.0** | `https://esm.sh/animejs@4.5.0` |
| `animejs/text` | **4.5.0** | `https://esm.sh/animejs@4.5.0/text` |

To upgrade, change both URLs in `script.js` **and** the `connect-src` /
`script-src` entries in the CSP in `index.html`.

Everything else — the particle field, the game, all layout — is hand-written
with no dependency.

## Running locally

The ES module imports and the CSP both need a real origin, so opening
`index.html` from the filesystem will not work. Serve it:

```bash
python -m http.server 8777
# then open http://localhost:8777
```

The frontend points at `http://localhost:8000` when served from `localhost`
or `127.0.0.1`, and at the deployed backend otherwise. See `API_BASE` and
`WS_URL` at the top of `script.js`.

## The API key

The user's Gemini key is **held in memory only** — never written to
`localStorage`, `sessionStorage`, or a cookie, and cleared on `pagehide` so
back/forward navigation cannot restore it. It is sent only with the
WebSocket query, in the message body, never in a URL. The upload request
does not carry it at all, because loading a file into SQLite needs no model
call.

## Dev helpers

On `localhost` only, a `rowbot` object is exposed on `window`:

```js
rowbot.waitLines()      // play every "waiting for the server" message
rowbot.coldStart()      // play the connection pill states + popovers
rowbot.pop(key)         // one popover: waking | snoozing | retrying |
                        //   noAnswer | unreachable | uploadStalled
rowbot.game()           // the game instance (getState() for debugging)
rowbot.reset()          // back to idle
```

These are gated behind `IS_LOCAL` and do not exist on the deployed site.

## Browser support

Modern evergreen browsers. Uses ES modules, CSS nesting, `:has`-free
selectors, `CanvasRenderingContext2D.roundRect` (Chrome 99+, Safari 16.4+,
Firefox 127+), and `backdrop-filter`.
