/* Run against the isolated ui_fixture_server.py; requires Chrome + Playwright. */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
    await fs.mkdir('instance/user-message-review', { recursive: true });
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const api = async url => (await page.request.get(`http://127.0.0.1:5001${url}`)).json();
        await page.goto('http://127.0.0.1:5001');
        await page.locator('#conversation-list button').filter({ hasText: 'Lecture courte' }).click();
        await page.locator('.copy-response-button').waitFor();
        const originalId = (await api('/api/conversations')).find(c => c.title === 'Lecture courte').id;
        const original = await api(`/api/conversations/${originalId}`);
        await page.locator('.copy-user-message').click();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), original.messages[0].content);
        await page.locator('#prompt').fill('Brouillon conservé');
        await page.locator('.edit-user-message').click();
        assert(await page.locator('#prompt').isDisabled());
        await page.locator('.edit-message-input').fill('Modification annulée');
        await page.locator('.cancel-message-edit').click();
        assert.equal(await page.locator('.chat-message-user .message').textContent(), original.messages[0].content);
        assert.equal(await page.locator('#prompt').inputValue(), 'Brouillon conservé');

        // Add two turns, then edit the middle turn: the last turn must not be reused.
        for (const [i, question] of ['Deuxième question', 'Troisième question'].entries()) {
            await page.locator('#prompt').fill(question);
            await page.locator('#prompt').press('Enter');
            await page.waitForFunction(count => document.querySelectorAll('.copy-response-button').length === count, i + 2);
            await page.waitForFunction(() => !document.querySelector('#prompt-form button[type="submit"]').disabled);
        }
        const before = await api(`/api/conversations/${originalId}`);
        const countBefore = (await api('/api/conversations')).length;
        const edited = 'Question corrigée : café\n<script>window.editXss = 1</script>';
        await page.locator('.edit-user-message').nth(1).click();
        await page.locator('.edit-message-input').fill('   ');
        assert(await page.locator('.save-message-edit').isDisabled());
        await page.locator('.edit-message-input').fill(edited);
        await page.screenshot({ path: 'instance/user-message-review/editor-desktop.png', animations: 'disabled' });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.locator('#theme-toggle').click();
        await page.screenshot({ path: 'instance/user-message-review/editor-mobile.png', animations: 'disabled' });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

        // Creation failure leaves the editor and original conversation untouched.
        await page.route('**/api/conversations/*/edit', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Erreur temporaire de test"}' }));
        await page.locator('.save-message-edit').click();
        await page.locator('#chat-error').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.edit-message-input').inputValue(), edited);
        assert.equal((await api('/api/conversations')).length, countBefore);
        await page.unroute('**/api/conversations/*/edit');
        const created = page.waitForResponse(r => r.url().endsWith('/edit') && r.request().method() === 'POST');
        const prompted = page.waitForRequest(r => r.url().endsWith('/prompt') && r.method() === 'POST');
        await page.locator('.save-message-edit').click();
        const branch = await (await created).json();
        const payload = (await prompted).postDataJSON();
        assert.deepEqual(payload.messages, before.messages.slice(0, 2).map(m => m.content).concat(edited));
        await page.waitForFunction(() => document.querySelectorAll('.copy-response-button').length === 2);
        await page.waitForFunction(() => !document.querySelector('#prompt-form button[type="submit"]').disabled);
        assert.deepEqual(await api(`/api/conversations/${originalId}`), before);
        const saved = await api(`/api/conversations/${branch.id}`);
        assert.equal(saved.messages.length, 4);
        assert.equal(saved.messages[2].content, edited);
        assert.equal((await api('/api/conversations')).length, countBefore + 1);
        assert.equal(await page.evaluate(() => window.editXss), undefined);
        await page.locator('.copy-user-message').last().click();
        assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), edited);
        await page.screenshot({ path: 'instance/user-message-review/result-mobile.png', animations: 'disabled' });

        // Reopening the persisted branch must keep its controls functional.
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.locator('#conversation-list button').filter({ hasText: 'Lecture courte' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.edit-user-message').length === 3);
        await page.locator('#conversation-list button').filter({ hasText: 'Modifié · Question corrigée' }).click();
        await page.waitForFunction(() => document.querySelectorAll('.edit-user-message').length === 2);
        await page.locator('.edit-user-message').last().click();
        await page.locator('.edit-message-input').press('Escape');
        assert.equal(await page.locator('.user-message-editor').count(), 0);
        assert.deepEqual(errors, []);
        console.log('User copy, edit, cancel, validation, failure retry, saved branch, exact context and original history preservation passed.');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
