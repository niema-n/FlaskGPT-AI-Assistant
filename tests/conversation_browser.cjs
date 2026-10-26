/* Run against ui_fixture_server.py with Playwright installed (or PLAYWRIGHT_MODULE_PATH).
   Screenshots and downloaded artifacts stay in the ignored instance/ui-review directory. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = 'http://127.0.0.1:5001';
const artifacts = path.resolve('instance/ui-review');

(async () => {
    await fs.mkdir(artifacts, { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.goto(base);
        await page.locator('#conversation-list button').filter({ hasText: 'Lecture longue' }).click();
        await page.locator('.chat-message-assistant h1').waitFor();
        const content = await page.locator('.chat-message-assistant .message').textContent();
        assert(content.split(/\s+/).length > 2000);
        assert(content.includes('FIN_LONGUE_REPONSE'));
        assert.equal(await page.locator('.chat-message-assistant pre code').count(), 1);
        assert.equal(await page.locator('.chat-message-assistant h2').count(), 26);

        for (const [width, height] of [[1440, 900], [1280, 720], [768, 1024], [390, 844], [360, 740], [844, 390]]) {
            await page.setViewportSize({ width, height });
            for (const dark of [false, true]) {
                await page.evaluate(dark => { if (document.documentElement.classList.contains('dark') !== dark) document.querySelector('#theme-toggle').click(); }, dark);
                await page.evaluate(() => {
                    followConversation = false;
                    document.querySelector('#conversation-scroll').scrollTop = 0;
                });
                await page.waitForTimeout(120);
                const geometry = await page.evaluate(() => {
                    const viewport = document.querySelector('#conversation-scroll');
                    const composer = document.querySelector('#prompt-form').getBoundingClientRect();
                    const scrollBox = viewport.getBoundingClientRect();
                    return {
                        documentOverflowX: document.documentElement.scrollWidth - innerWidth,
                        documentOverflowY: document.documentElement.scrollHeight - innerHeight,
                        scrolls: viewport.scrollHeight > viewport.clientHeight,
                        composerBottom: composer.bottom, composerTop: composer.top, composerHeight: composer.height,
                        viewportBottom: scrollBox.bottom, viewportHeight: scrollBox.height,
                        nested: [...document.querySelectorAll('#gpt-output .message, #gpt-output .chat-message')].filter(el => {
                            const style = getComputedStyle(el);
                            return style.maxHeight !== 'none' || /auto|scroll|hidden/.test(style.overflowY);
                        }).length,
                    };
                });
                assert(geometry.documentOverflowX <= 1, JSON.stringify(geometry));
                assert(geometry.documentOverflowY <= 1, JSON.stringify(geometry));
                assert(geometry.scrolls && geometry.viewportHeight > 100, JSON.stringify(geometry));
                assert(geometry.composerBottom <= height && geometry.composerHeight < 190, JSON.stringify(geometry));
                assert(geometry.viewportBottom <= geometry.composerTop + 1, JSON.stringify(geometry));
                assert.equal(geometry.nested, 0);
                await page.screenshot({ path: path.join(artifacts, `conversation-${width}-${dark ? 'dark' : 'light'}.png`) });
                await page.evaluate(() => syncConversationScroll(true));
                await page.waitForFunction(() => {
                    const viewport = document.querySelector('#conversation-scroll');
                    return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 3;
                });
                const lastTextPosition = await page.locator('.chat-message-assistant .message > p').last().boundingBox();
                assert(lastTextPosition.y + lastTextPosition.height <= geometry.composerTop + 1);
                console.log(`Layout verified: ${width}x${height}, ${dark ? 'dark' : 'light'}`);
            }
        }
        // Code/table accessibility and clipboard, including history rendering.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('.table-scroll').scrollIntoViewIfNeeded();
        assert(await page.locator('.table-scroll').evaluate(el => el.scrollWidth > el.clientWidth));
        await page.screenshot({ path: path.join(artifacts, 'mobile-table-code.png') });
        await page.locator('.copy-code-button').click();
        assert((await page.evaluate(() => navigator.clipboard.readText())).includes('Ligne 350'));
        assert(await page.locator('pre').evaluate(el => el.scrollHeight <= el.clientHeight + 1));
        assert(await page.locator('pre').evaluate(el => el.scrollWidth > el.clientWidth));
        await page.screenshot({ path: path.join(artifacts, 'mobile-code.png') });

        // Sanitization uses the real Markdown rendering function.
        await page.evaluate(() => appendMessage('<img src="x" onerror="window.xssExecuted=1"><script>window.xssExecuted=2</script><a href="javascript:alert(1)">unsafe</a>', 'assistant'));
        assert.equal(await page.evaluate(() => window.xssExecuted), undefined);
        assert.equal(await page.locator('#gpt-output [onerror], #gpt-output script, #gpt-output a[href^="javascript:"]').count(), 0);

        // Start afresh, exercise composer keyboard behavior and real Flask streaming.
        await page.locator('#new-chat-button').click();
        await page.locator('#confirm-new-chat').click();
        await page.locator('#conversation-welcome').waitFor({ state: 'visible' });
        await page.locator('#prompt').fill('Ligne une');
        await page.locator('#prompt').press('Shift+Enter');
        assert((await page.locator('#prompt').inputValue()).includes('\n'));
        await page.locator('#prompt').fill('Ligne\n'.repeat(40));
        assert(await page.locator('#prompt').evaluate(el => el.scrollHeight > el.clientHeight));
        await page.locator('#prompt').press('Escape');
        assert.equal(await page.locator('#prompt').inputValue(), '');
        assert(await page.locator('#prompt').evaluate(el => el.clientHeight < 60));
        await page.selectOption('#domain', 'Autre');
        await page.locator('#custom-domain').fill('Éducation');
        await page.locator('#prompt').fill('Réponse courte de test');
        await page.locator('#prompt').press('Enter');
        await page.locator('.copy-response-button').waitFor();
        assert((await page.locator('.chat-message-assistant .message').textContent()).includes('réponse courte'));
        assert.equal(await page.locator('#prompt').inputValue(), '');
        await page.selectOption('#domain', 'Général');
        await page.locator('#prompt').fill('LONGUE_TEST');
        await page.locator('#prompt').press('Enter');
        await page.waitForFunction(() => document.querySelector('#conversation-scroll').scrollHeight > 2500);
        await page.waitForTimeout(180);
        assert(await page.evaluate(() => isNearConversationEnd()));
        await page.locator('#conversation-scroll').evaluate(el => { el.scrollTop = 100; });
        await page.waitForTimeout(150);
        const stoppedAt = await page.locator('#conversation-scroll').evaluate(el => el.scrollTop);
        await page.waitForTimeout(900);
        assert(Math.abs(await page.locator('#conversation-scroll').evaluate(el => el.scrollTop) - stoppedAt) < 3, 'Streaming must not move a reader who scrolled up');
        await page.locator('#jump-to-latest').waitFor({ state: 'visible' });
        await page.locator('#jump-to-latest').click();
        await page.waitForTimeout(250);
        assert(await page.evaluate(() => isNearConversationEnd()));
        await page.waitForFunction(() => document.querySelectorAll('.copy-response-button').length === 2, null, { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('#generation-status').classList.contains('hidden'));
        assert(await page.evaluate(() => isNearConversationEnd()));
        console.log('Short/long streaming, keyboard, auto-follow and reading position verified');

        // Export menu, exports, summary and evaluation on the short saved conversation.
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.locator('#conversation-list button').filter({ hasText: 'Lecture courte' }).click();
        await page.locator('#conversation-actions summary').click();
        for (const format of ['txt', 'json', 'pdf']) {
            const pending = page.waitForEvent('download');
            await page.selectOption('#export-format', format);
            const download = await pending;
            assert(download.suggestedFilename().endsWith('.' + format));
            await download.saveAs(path.join(artifacts, 'export.' + format));
            await page.waitForFunction(() => !document.querySelector('#export-format').disabled);
        }
        const summary = page.waitForEvent('download');
        await page.locator('#export-pdf-button').click();
        assert((await summary).suggestedFilename().endsWith('.pdf'));
        await page.waitForFunction(() => !document.querySelector('#export-format').disabled);
        await page.locator('#conversation-actions summary').press('Escape');
        assert.equal(await page.locator('#conversation-actions').getAttribute('open'), null);
        console.log('TXT / JSON / PDF / summary downloads verified');
        await page.locator('[data-rating="satisfaisante"]').click();
        await page.waitForFunction(() => document.querySelector('[data-rating="satisfaisante"]').getAttribute('aria-pressed') === 'true');
        for (const view of ['dashboard', 'history', 'sources', 'analysis', 'performance', 'ratings', 'assistant']) {
            await page.locator(`.sidebar-link[data-view-target="${view}"]`).click();
            await page.locator(`[data-view-panel="${view}"]`).waitFor({ state: 'visible' });
        }
        await page.locator('#prompt').fill('ERREUR_TEST');
        await page.locator('#prompt').press('Enter');
        await page.locator('#chat-error').waitFor({ state: 'visible' });
        assert(await page.locator('#retry-last-prompt').isVisible());
        await page.waitForFunction(() => !document.querySelector('#prompt-form button[type="submit"]').disabled);
        await page.locator('#retry-last-prompt').click();
        await page.waitForFunction(() => document.querySelectorAll('.copy-response-button').length === 2);
        await page.waitForFunction(() => document.querySelector('#generation-status').classList.contains('hidden'));
        await page.locator('#prompt').fill('INTERRUPTION_TEST');
        await page.locator('#prompt').press('Enter');
        await page.waitForFunction(() => document.querySelector('#chat-error-message').textContent.includes('Le texte reçu reste visible'));
        assert.equal(await page.locator('.chat-message-assistant').count(), 3);
        assert((await page.locator('.chat-message-assistant').last().textContent()).includes('réponse courte'));
        await page.screenshot({ path: path.join(artifacts, 'interrupted-stream.png') });
        assert.deepEqual(errors, []);
        console.log('Navigation, ratings, successful retry, partial response retention and XSS protection verified; no JavaScript errors');
    } finally {
        await browser.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });

