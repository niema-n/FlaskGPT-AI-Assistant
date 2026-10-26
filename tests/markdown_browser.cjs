/* Run against tests/ui_fixture_server.py; see BROWSER_TESTS.md. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
    const artifacts = path.resolve('instance/markdown-review');
    await fs.mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto('http://127.0.0.1:5001');
        await page.locator('#conversation-list button').filter({ hasText: 'Markdown complexe' }).click();
        await page.locator('.copy-response-button').waitFor();
        const response = page.locator('.chat-message-assistant');
        assert.equal(await response.locator('.code-block').count(), 3);
        assert.equal(await response.locator('.copy-code-button').count(), 3);
        assert.equal(await response.locator('table').count(), 2);
        assert.equal(await response.locator('.message-actions').count(), 1);
        assert.equal(await response.locator('.message-actions button').count(), 4);
        const source = await response.locator('.message').evaluate(el => messageText.get(el));
        assert(source.split(/\s+/).length > 2000);
        for (const selector of ['h1', 'h2', 'h3', 'ul', 'ol', 'blockquote', 'hr', 'a', 'strong', 'em', 'code:not(pre code)']) {
            assert(await response.locator(selector).count() > 0, selector);
        }
        for (let i = 0; i < 3; i++) {
            const block = response.locator('.code-block').nth(i);
            assert.equal(await block.locator('.code-language').textContent(), 'Python');
            assert(await block.locator('.hljs').count() === 1);
            await block.locator('.copy-code-button').click();
            const code = await block.locator('pre code').textContent();
            // Windows' clipboard uses CRLF; it does not change the copied code.
            assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), code);
            assert(!code.includes('Copier'));
        }
        await response.locator('.copy-response-button').click();
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), source);
        assert(!source.includes('Copier'));
        const aligned = response.locator('table').first();
        assert.equal(await aligned.locator('th').nth(1).evaluate(el => getComputedStyle(el).textAlign), 'center');
        assert.equal(await aligned.locator('td').nth(2).evaluate(el => getComputedStyle(el).textAlign), 'right');
        assert((await aligned.textContent()).includes('a | b'));
        assert((await aligned.textContent()).includes('<div>&</div>'));

        const regressions = await page.evaluate(async (fullSource) => {
            const target = appendMessage('', 'assistant');
            const prefix = '# Exemple\n\nUn paragraphe déjà complet.\n\n';
            renderMarkdown(target, prefix + '```python\nprint("café")\n', false);
            const original = { paragraph: target.querySelector('p'), pre: target.querySelector('pre'), button: target.querySelector('button') };
            renderMarkdown(target, prefix + '```python\nprint("café")\nprint("été")\n', false);
            const stable = original.paragraph === target.querySelector('p') && original.pre === target.querySelector('pre') && original.button === target.querySelector('button');
            const unfinishedCode = target.querySelector('code').textContent;
            renderMarkdown(target, prefix + '```python\nprint("café")\nprint("été")\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n', false);
            const table = target.querySelector('table');
            const firstRow = table.querySelector('tbody tr');
            renderMarkdown(target, prefix + '```python\nprint("café")\nprint("été")\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n', false);
            const stableTable = table === target.querySelector('table') && firstRow === target.querySelector('tbody tr');

            // Reproduce the malformed source stored in the observed conversation.
            // It remains untouched; no regex guesses at missing table/code boundaries.
            const malformed = '| Méthode | Code |\n| --- | --- |\n| IQR | ```python\nQ1 = df["col"].quantile(0.25)\n``` |\n';
            renderMarkdown(target, malformed);
            const unchangedMalformed = messageText.get(target) === malformed;
            renderMarkdown(target, '```python\nmessage = "Copier le code"\n');
            const literalPreserved = target.querySelector('code').textContent.includes('"Copier le code"');
            renderMarkdown(target, '<script>window.markdownXss=1</script><img src="bad" onerror="window.markdownXss=2"><a href="javascript:alert(1)">lien</a>');
            const safe = !target.querySelector('script, [onerror], a[href^="javascript:"]');

            // Deliberately split UTF-8 codepoints and Markdown delimiters across reads.
            const bytes = new TextEncoder().encode(fullSource);
            let offset = 0, index = 0, duplicates = false, paints = 0;
            const sizes = [1, 2, 3, 7, 97, 511, 1024, 23];
            const observer = new MutationObserver(() => {
                paints++;
                if (target.querySelectorAll('.copy-code-button').length !== target.querySelectorAll('pre code').length) duplicates = true;
            });
            observer.observe(target, { childList: true, subtree: true });
            const stream = new ReadableStream({
                async pull(controller) {
                    if (offset >= bytes.length) return controller.close();
                    const end = Math.min(offset + sizes[index++ % sizes.length], bytes.length);
                    controller.enqueue(bytes.slice(offset, end)); offset = end;
                    await new Promise(resolve => setTimeout(resolve, 5));
                },
            });
            const received = await readResponseChunks(stream.getReader(), target);
            observer.disconnect();
            const expected = document.createElement('div');
            renderMarkdown(expected, fullSource);
            const renderOnly = element => {
                const copy = element.cloneNode(true);
                copy.querySelectorAll('.code-validation').forEach(status => status.remove());
                return copy.innerHTML;
            };
            return { stable, stableTable, unfinishedCode, unchangedMalformed, literalPreserved, safe, xss: Boolean(window.markdownXss),
                lossless: received === fullSource, sameFinal: renderOnly(target) === renderOnly(expected),
                duplicates, paints, buttons: target.querySelectorAll('.copy-code-button').length, tables: target.querySelectorAll('table').length };
        }, source);
        assert(regressions.stable && regressions.stableTable, JSON.stringify(regressions));
        assert.equal(regressions.unfinishedCode, 'print("café")\nprint("été")\n');
        assert(regressions.unchangedMalformed && regressions.literalPreserved);
        assert(regressions.safe && !regressions.xss);
        assert(regressions.lossless && regressions.sameFinal);
        assert(!regressions.duplicates && regressions.paints > 1);
        assert.equal(regressions.buttons, 3);
        assert.equal(regressions.tables, 2);
        await page.locator('.chat-message-assistant').last().evaluate(el => el.remove());
        console.log('GFM, three code copies, two tables, alignments, XSS, lossless UTF-8 streaming and DOM stability verified');

        for (const width of [1280, 768, 390]) {
            await page.setViewportSize({ width, height: 900 });
            for (const dark of [false, true]) {
                await page.evaluate(dark => { if (document.documentElement.classList.contains('dark') !== dark) document.querySelector('#theme-toggle').click(); }, dark);
                await response.locator('.code-block').first().scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(artifacts, `code-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
                await response.locator('.table-scroll').first().scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(artifacts, `tables-${width}-${dark ? 'dark' : 'light'}.png`), animations: 'disabled' });
                assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
                if (width === 390) assert(await response.locator('.table-scroll').first().evaluate(el => el.scrollWidth > el.clientWidth));
            }
        }
        await page.locator('[data-rating="moyenne"]').focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.querySelector('[data-rating="moyenne"]').getAttribute('aria-pressed') === 'true');
        await page.waitForFunction(() => !document.querySelector('[data-rating="moyenne"]').disabled);
        await page.screenshot({ path: path.join(artifacts, 'actions-mobile-dark.png'), animations: 'disabled' });
        assert.deepEqual(errors, []);
        console.log('Light/dark screenshots on desktop/tablet/mobile, keyboard ratings and response actions verified');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
