# Conversation browser checks

These checks use Chrome and Playwright against a separate Flask server on port 5001.
The fixture server uses a temporary SQLite database and a fake Groq client: no paid
API calls are made and existing conversations are not used as test fixtures.

1. Install Playwright in a temporary directory (PowerShell):

   ```powershell
   npm install --prefix "$env:TEMP\flaskgpt-browser-check" --no-package-lock --no-audit --no-fund playwright
   ```

2. Start the fixture server from the project directory:

   ```powershell
   poetry run python tests/ui_fixture_server.py
   ```

3. In another terminal, run the browser checks:

   ```powershell
   $env:PLAYWRIGHT_MODULE_PATH = Join-Path $env:TEMP 'flaskgpt-browser-check\node_modules\playwright'
   node tests/conversation_browser.cjs
   node tests/markdown_browser.cjs
   ```

Restart the fixture server before repeating the suite (the simulated failure happens
once per server run). Screenshots and downloaded exports are saved in the ignored
`instance/ui-review/` directory. The suite verifies a response over 2,000 words and
a 350-line code block, six viewport sizes in both themes, full content access,
composer geometry and keyboard input, streaming scroll behavior, copying, XSS
sanitization, navigation, ratings, exports, summary PDF, retry and interrupted streams.

The simulated provider verifies the browser and Flask integration. It does not
validate availability or response quality of the live Groq service.

The Markdown suite verifies three Python blocks, two aligned GFM tables, escaped
pipes, exact code/source copying (allowing Windows clipboard newline normalization),
unfinished fences, preserved malformed source, UTF-8 split across streamed chunks,
stable code/table DOM nodes and keyboard-accessible response actions. Its screenshots
are saved to `instance/markdown-review/`.

The pinned Marked browser bundle is committed with its license. After updating the
dependency, refresh it with `npm run vendor:markdown`.

The user-message suite verifies copying, cancelling an inline edit, empty input,
failed requests, safe rendering and creating a saved conversation from an edited
message. It checks that later turns are excluded from the new prompt and that the
original conversation is untouched. Run it against a freshly started fixture server:

```powershell
node tests/user_message_browser.cjs
```

This suite adds turns to its fixture conversation; restart the fixture server before
running the other suites afterward. Screenshots are saved in `instance/user-message-review/`.
