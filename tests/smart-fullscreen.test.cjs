const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(lang, native = true) {
    const listeners = {}, changes = [], messages = [];
    const button = { addEventListener() {}, setAttribute() {}, classList: { toggle() {} } };
    const video = { _playbackItem: { Id: '1' }, videoWidth: 1080, videoHeight: 1920 };
    const document = {
        documentElement: { lang, async requestFullscreen() { document.fullscreenElement = {}; } },
        fullscreenElement: null,
        async exitFullscreen() { document.fullscreenElement = null; },
        getElementById: id => id.startsWith('video-p') ? video : id === 'app' ? { classList: { remove() {} } } : button,
        addEventListener: (name, callback) => listeners[name] = callback
    };
    const window = { screen: { orientation: {} } };
    if (native) window.EmbyXNative = { setSmartFullscreenOrientation: value => changes.push(value) };
    const context = { window, document };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(`${lang}/js/smart-fullscreen.js`, 'utf8'), context);
    const app = { state: { currentIndex: 0, viewMode: 'stream', videos: [{ Id: '1' }] }, showToast: text => messages.push(text) };
    return { controller: new window.SmartFullscreenController(app), video, changes, messages, listeners, document, window };
}

for (const lang of ['zh', 'en']) {
    test(`${lang}: native fullscreen follows video dimensions and restores orientation on exit`, async () => {
        const { controller, video, changes, listeners, document } = setup(lang);
        await controller.toggle();
        assert.equal(controller.active, true);
        assert.equal(changes.at(-1), 'portrait');
        video.videoWidth = 1920; video.videoHeight = 1080;
        listeners.resize({ target: video });
        assert.equal(changes.at(-1), 'landscape');
        await controller.toggle();
        assert.equal(changes.at(-1), 'restore');
        assert.equal(controller.active, false);
        assert.equal(document.fullscreenElement, null);
    });
    test(`${lang}: unknown size does not rotate, unsupported browsers roll back`, async () => {
        const unknown = setup(lang);
        unknown.video.videoWidth = unknown.video.videoHeight = 0;
        await unknown.controller.toggle();
        assert.equal(unknown.controller.active, false);
        assert.equal(unknown.changes.length, 0);
        const browser = setup(lang, false);
        await browser.controller.toggle();
        assert.equal(browser.controller.active, false);
        assert.equal(browser.document.fullscreenElement, null);
        assert.equal(browser.messages.length, 1);
    });
    test(`${lang}: browser orientation lock follows dimensions and is released`, async () => {
        const { controller, window, changes, listeners, document } = setup(lang, false);
        window.screen.orientation = { lock: async dir => changes.push(dir), unlock: () => changes.push('unlock') };
        await controller.toggle();
        assert.equal(changes[0], 'portrait');
        document.fullscreenElement = null;
        listeners.fullscreenchange();
        assert.equal(controller.active, false);
        assert.equal(changes.at(-1), 'unlock');
    });
}
