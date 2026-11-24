const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

for (const lang of ['zh', 'en']) {
    test(`${lang}: resumes a video after reload and clears its position when it finishes`, () => {
        const saved = new Map();
        const slots = {};
        const context = {
            window: {}, console, setTimeout, clearTimeout,
            document: { getElementById: id => slots[id] },
            localStorage: {
                getItem: key => saved.get(key) ?? null,
                setItem: (key, value) => saved.set(key, value)
            }
        };
        vm.runInNewContext(fs.readFileSync(`${lang}/js/player.js`, 'utf8'), context);
        const item = { Id: 'clip', UserData: { PlaybackPositionTicks: 120000000 } };
        const app = {
            config: { server: 'http://media', userId: 'account' },
            state: { viewMode: 'stream', currentIndex: 0, videos: [item] },
            toggleLoading() {}
        };
        const load = () => {
            const player = new context.window.VideoPlayer({ app });
            const playedAt = [];
            const video = {
                dataset: {}, style: { opacity: '0' }, readyState: 0, duration: NaN,
                time: 0, paused: true, seeking: false,
                get currentTime() { return this.time; },
                set currentTime(position) { this.time = position; this.seeking = true; },
                canPlayType: () => '', load() {}, pause() {},
                play() { playedAt.push(this.time); }
            };
            slots['video-p0'] = video;
            player.setVideoSource(video, 'movie.mp4', 0, item, { autoplay: true });
            player.bindVideoEvents(video, 0, item);
            return { player, video, playedAt };
        };
        const start = ({ video, playedAt }, position) => {
            assert.equal(video.autoplay, false);
            video.readyState = 3;
            video.duration = 100;
            video.oncanplay();
            assert.equal(video.currentTime, position);
            assert.equal(video.style.opacity, '0');
            assert.deepEqual(playedAt, []);
            video.seeking = false;
            video.onseeked();
            assert.deepEqual(playedAt, [position]);
            video.onplaying();
            assert.equal(video.style.opacity, '1');
        };

        const first = load();
        start(first, 12);
        first.video.time = 37;
        first.video.onpause();

        const second = load();
        start(second, 37);
        first.video.time = 0;
        first.video.onpause();
        assert.equal(second.player.getResumePosition(item), 37);
        assert.equal(second.player.getResumePosition({ Id: 'other' }), 0);

        app.config.userId = 'other-account';
        assert.equal(second.player.getResumePosition(item), 12);
        app.config.userId = 'account';
        app.config.server = 'http://another-server';
        assert.equal(second.player.getResumePosition(item), 12);
        app.config.server = 'http://media';

        second.video.ended = true;
        second.video.time = 100;
        second.video.onended();
        const replay = load();
        assert.equal(replay.player.getResumePosition(item), 0);
        assert.equal(replay.video.autoplay, true);
        assert.equal(replay.video.dataset.resumeTime, undefined);
    });

    test(`${lang}: old video events cannot change playback or report another item`, () => {
        const requests = [];
        const slots = {};
        const context = {
            window: { EmbyXCommon: { getServerType: () => 'jellyfin' } },
            document: { getElementById: id => slots[id] }, console,
            fixUrlForJellyfin: url => url, setTimeout, clearTimeout,
            fetch: (url, options) => { requests.push({ url, body: JSON.parse(options.body || '{}') }); return Promise.resolve({}); }
        };
        vm.createContext(context);
        vm.runInContext(fs.readFileSync(`${lang}/js/player.js`, 'utf8'), context);
        const app = {
            config: { server: 'http://media', token: 'test' },
            state: { viewMode: 'stream', videos: [{ Id: 'old' }, { Id: 'new' }], currentIndex: 1 },
            getAuthHeaders: () => ({}), setPlayState() { throw new Error('stale event changed playing state'); }
        };
        const player = new context.window.VideoPlayer({ app, onEnded() { throw new Error('stale video advanced playlist'); } });
        const old = { dataset: { requestedSrc: 'old-src', playSessionId: 'old-session' }, currentTime: 37, duration: 100, paused: true, volume: 1 };
        slots['video-p0'] = old;
        slots['video-p1'] = {};
        player.bindVideoEvents(old, 0, { Id: 'old' });
        old.onpause(); old.onplay(); old.onplaying(); old.ontimeupdate(); old.onended(); old.onwaiting();
        assert.equal(requests.length, 0);
        player.reportPlayback('progress', old);
        assert.equal(requests.length, 0);
        player.reportPlayback('stopped', old);
        const stop = requests.filter(r => r.url.includes('/Sessions/Playing/Stopped'));
        assert.equal(stop.length, 1);
        assert.equal(stop[0].body.ItemId, 'old');
        assert.equal(stop[0].body.PositionTicks, 370000000);
        assert.equal(stop[0].body.PlaySessionId, 'old-session');
        assert.equal(requests.some(r => r.url.includes('/Playing/Progress')), false);
        app.state.videos = [];
        player.reportPlayback('stopped', old);
        assert.equal(requests.at(-1).body.ItemId, 'old');
    });

    test(`${lang}: out-of-order list responses and failures cannot overwrite new results`, async () => {
        const html = fs.readFileSync(`${lang}/index.html`, 'utf8');
        const start = html.indexOf('            async fetchVideos(');
        const end = html.indexOf('            renderSlides()', start);
        const pending = [];
        const context = {
            console, window: {}, localStorage: { getItem: () => null },
            EmbyXCommon: { getServerType: () => 'jellyfin' },
            fetch: () => new Promise((resolve, reject) => pending.push({ resolve, reject }))
        };
        const App = vm.runInNewContext(`(class { ${html.slice(start, end)} })`, context);
        const app = new App();
        let renders = 0;
        Object.assign(app, {
            config: { server: 'http://media', token: 'test', userId: 'user' },
            state: { currentLibraryId: 'lib', viewMode: 'grid', playMode: 'sequence', videos: [] },
            toggleLoading() {}, getAuthHeaders: () => ({}),
            showToast() { throw new Error('stale request showed an error'); },
            renderGridView() { renders++; }
        });
        app.state.searchTerm = 'old';
        const old = app.fetchVideos(null, null, false, false, false, 'old');
        app.state.searchTerm = 'new';
        const newest = app.fetchVideos(null, null, false, false, false, 'new');
        pending[1].resolve({ ok: true, json: async () => ({ Items: [{ Id: 'new' }], TotalRecordCount: 1 }) });
        await newest;
        pending[0].resolve({ ok: true, json: async () => ({ Items: [{ Id: 'old' }], TotalRecordCount: 1 }) });
        await old;
        assert.equal(app.state.videos[0].Id, 'new');
        assert.equal(renders, 1);
        const staleFailure = app.fetchVideos();
        const current = app.fetchVideos();
        pending[3].resolve({ ok: true, json: async () => ({ Items: [{ Id: 'current' }], TotalRecordCount: 1 }) });
        await current;
        pending[2].reject(new Error('old network failure'));
        await staleFailure;
        assert.equal(app.state.videos[0].Id, 'current');
    });
}
