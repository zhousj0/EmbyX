const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(lang, type = 'jellyfin') {
    const app = {
        config: { folderMode: true, server: 'http://media', userId: 'user', token: 'token' },
        state: { currentLibraryId: 'library', viewMode: 'grid', startIndex: 150, currentIndex: 0, totalCount: 301, videos: [] },
        toggleLoading() {}, showToast(message) { this.error = message; },
        getAuthHeaders() { return {}; }, fetchVideos() {}, renderGridView() {},
        toggleViewMode() { this.state.viewMode = 'stream'; }
    };
    const context = { window: { EmbyXCommon: { getServerType: () => type } }, console };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(`${lang}/js/drama.js`, 'utf8'), context);
    const manager = new context.window.ShortDramaManager(app);
    return { app, manager, context };
}

for (const lang of ['zh', 'en']) {
    test(`${lang}: random folder playback keeps the clicked video first and preserves sequential order`, async () => {
        const { manager, app, context } = setup(lang);
        const videos = [2, 10, 1].map(n => ({ Id: String(n), Name: `Clip ${n}`, Type: 'Video' }));
        app.state.playMode = 'random';
        app.state.videos = videos;
        let shuffled = false;
        app._shuffleAroundCurrent = () => {
            shuffled = true;
            assert.equal(app.state.currentIndex, 0);
            assert.equal(app.state.videos[0].Id, '10');
            app.state.videos.splice(1, 2, ...app.state.videos.slice(1).reverse());
        };
        context.fetch = async () => ({ ok: true, json: async () => ({ Items: videos, TotalRecordCount: 3 }) });
        await manager.playFolderItem(videos[1]);
        assert.equal(app.error, undefined);
        assert.equal(shuffled, true);
        assert.equal(app.state.videos[0].Id, '10');
        assert.equal(Array.from(app.state.originalVideos, v => v.Id).join(','), '1,2,10');
        manager.restoreFolderListing();
        assert.equal(app.state.videos, videos);
    });
    test(`${lang}: directory mode works independently, preserves small folders and pagination`, async () => {
        const { manager, app } = setup(lang);
        assert.equal(manager.isDramaMode(), false);
        assert.equal(manager.isFolderModeActive(), true);
        const folder = { Id: 'child', Name: 'Child', Type: 'Folder', IsFolder: true, ChildCount: 1 };
        app.state.videos = [folder];
        assert.equal(manager.isSingleVideoFolder(folder), false);
        await manager.enterItem(folder);
        assert.equal(manager.currentFolderId, 'child');
        app.state.startIndex = 0;
        manager.popFolder();
        assert.equal(manager.currentFolderId, null);
        assert.equal(app.state.startIndex, 150);
        assert.equal(app.state.videos[0], folder);
        assert.equal(await manager.loadNextSiblingRelay(), false);
        app.state.currentLibraryId = 'favorites';
        assert.equal(manager.isFolderModeActive(), false);
    });

    test(`${lang}: playback loads all direct children, then restores the mixed directory page`, async () => {
        const { manager, app, context } = setup(lang);
        const videos = Array.from({ length: 151 }, (_, i) => ({ Id: String(i), Name: `Clip ${i}`, Type: 'Video' }));
        const listing = [{ Id: 'sub', Type: 'Folder', IsFolder: true }, videos[150]];
        app.state.videos = listing;
        manager.currentFolderId = 'folder & 1';
        const offsets = [];
        context.fetch = async url => {
            const parsed = new URL(url);
            assert.equal(parsed.searchParams.get('ParentId'), 'folder & 1');
            assert.equal(parsed.searchParams.get('Recursive'), 'false');
            const offset = Number(parsed.searchParams.get('StartIndex'));
            offsets.push(offset);
            return { ok: true, json: async () => ({ Items: videos.slice(offset, offset + 150), TotalRecordCount: 151 }) };
        };
        await manager.playFolderItem(videos[150]);
        assert.equal(app.error, undefined);
        assert.deepEqual(offsets, [0, 150]);
        assert.equal(app.state.videos.length, 151);
        assert.equal(app.state.videos[app.state.currentIndex].Id, '150');
        assert.equal(app.state.viewMode, 'stream');
        manager.restoreFolderListing();
        assert.equal(app.state.videos, listing);
        assert.equal(app.state.startIndex, 150);
        assert.equal(app.state.totalCount, 301);
    });

    test(`${lang}: OpenList advances past filtered pages and excludes subdirectories`, async () => {
        const { manager, app, context } = setup(lang, 'openlist');
        const video = { Id: 'clip', Name: 'Clip', Type: 'Movie' };
        const offsets = [];
        context.window.OpenListManager = { fetchItems: async args => {
            offsets.push(args.startIndex);
            return { Items: args.startIndex === 0 ? [] : [{ Type: 'Folder', IsFolder: true }, video], TotalRecordCount: 151 };
        } };
        await manager.playFolderItem(video);
        assert.deepEqual(offsets, [0, 150]);
        assert.equal(app.state.videos.length, 1);
        assert.equal(app.state.videos[0], video);
    });

    test(`${lang}: network failure or leaving a directory does not replace its listing`, async () => {
        const { manager, app, context } = setup(lang);
        const listing = [{ Id: 'clip', Name: 'Clip', Type: 'Video' }];
        app.state.videos = listing;
        context.fetch = async () => ({ ok: false, status: 503 });
        await manager.playFolderItem(listing[0]);
        assert.equal(app.state.videos, listing);
        assert.equal(app.state.viewMode, 'grid');
        assert.equal(app.error, 'HTTP 503');
        context.fetch = async () => {
            manager.reset();
            return { ok: true, json: async () => ({ Items: listing, TotalRecordCount: 1 }) };
        };
        await manager.playFolderItem(listing[0]);
        assert.equal(app.state.viewMode, 'grid');
        assert.equal(manager._folderPlayback, null);
    });
}
