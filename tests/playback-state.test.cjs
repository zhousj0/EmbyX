const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

for (const lang of ['zh', 'en']) {
    test(`${lang}: resumes only videos watched in the current playback queue`, () => {
        const legacyKey = 'embyx_playback_resume_["http://media","account","clip"]';
        const saved = new Map([[legacyKey, '24']]);
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
        const nextItem = { Id: 'next', UserData: { PlaybackPositionTicks: 160000000 } };
        const app = {
            config: { server: 'http://media', userId: 'account' },
            state: { viewMode: 'stream', currentIndex: 0, videos: [item, nextItem] },
            toggleLoading() {}
        };
        const player = new context.window.VideoPlayer({ app });
        const load = (index, activePlayer = player, reuse = null) => {
            app.state.currentIndex = index;
            const videoData = app.state.videos[index];
            const playedAt = [];
            const video = reuse ?? {
                dataset: {}, style: { opacity: '0' }, readyState: 0, duration: NaN,
                time: 0, paused: true, seeking: false,
                get currentTime() { return this.time; },
                set currentTime(position) { this.time = position; this.seeking = true; },
                canPlayType: () => '', pause() {},
                load() {
                    this.readyState = 0;
                    this.duration = NaN;
                    this.time = 0;
                    this.seeking = false;
                    this.ended = false;
                }
            };
            video.style.opacity = '0';
            video.play = () => { playedAt.push(video.time); };
            slots[`video-p${index % 3}`] = video;
            activePlayer.setVideoSource(video, `${videoData.Id}.mp4`, index, videoData, { autoplay: true });
            activePlayer.bindVideoEvents(video, index, videoData);
            return { video, playedAt };
        };
        const start = ({ video, playedAt }, position) => {
            assert.equal(video.autoplay, position === 0);
            video.readyState = 3;
            video.duration = 100;
            video.oncanplay();
            assert.equal(video.currentTime, position);
            if (position > 0) {
                assert.equal(video.style.opacity, '0');
                assert.deepEqual(playedAt, []);
                video.seeking = false;
                video.onseeked();
            }
            assert.deepEqual(playedAt, [position]);
            video.onplaying();
            assert.equal(video.style.opacity, '1');
        };

        const first = load(0);
        start(first, 0);
        first.video.time = 37;
        first.video.onpause();

        const next = load(1);
        start(next, 0);
        next.video.time = 22;
        next.video.onpause();
        assert.equal(first.video.currentTime, 0);
        start(load(0, player, first.video), 37);
        start(load(1, player, next.video), 22);

        app.state.videos.push({ Id: 'appended' }, { Id: 'last' });
        const last = load(3);
        start(last, 0);
        last.video.time = 61;
        last.video.onpause();

        const previous = load(0);
        start(previous, 37);
        first.video.time = 0;
        first.video.onpause();
        start(load(3), 61);
        start(load(1), 22);
        const previousAgain = load(0);
        start(previousAgain, 37);
        previousAgain.video.ended = true;
        previousAgain.video.time = 100;
        previousAgain.video.onended();

        const replay = load(0);
        start(replay, 0);
        replay.video.time = 56;
        replay.video.onpause();
        app.state.videos = [item, nextItem];
        replay.video.onpause();
        const refreshed = load(0);
        start(refreshed, 0);
        refreshed.video.time = 43;
        refreshed.video.onpause();

        const reopenedPlayer = new context.window.VideoPlayer({ app });
        start(load(0, reopenedPlayer), 0);
        assert.deepEqual([...saved], [[legacyKey, '24']]);

        const folderListing = [item, nextItem];
        app.drama = { _folderPlayback: { videos: folderListing }, savePlaybackLocation() {} };
        app.state.videos = [...folderListing];
        const folderVideo = load(0);
        start(folderVideo, 0);
        folderVideo.video.time = 45;
        folderVideo.video.onpause();

        // Returning to the folder grid and choosing a video builds a new queue.
        app.state.videos = folderListing;
        app.drama._folderPlayback = null;
        app.drama._folderPlayback = { videos: folderListing };
        app.state.videos = [nextItem, item];
        start(load(1), 45);
        player.resetPlaybackRound();
        start(load(1), 0);
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
        let roundResets = 0;
        Object.assign(app, {
            config: { server: 'http://media', token: 'test', userId: 'user' },
            state: { currentLibraryId: 'lib', viewMode: 'grid', playMode: 'sequence', videos: [] },
            toggleLoading() {}, getAuthHeaders: () => ({}),
            showToast() { throw new Error('stale request showed an error'); },
            player: { resetPlaybackRound() { roundResets++; } },
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
        assert.equal(roundResets, 1);
        const staleFailure = app.fetchVideos();
        const current = app.fetchVideos();
        pending[3].resolve({ ok: true, json: async () => ({ Items: [{ Id: 'current' }], TotalRecordCount: 1 }) });
        await current;
        pending[2].reject(new Error('old network failure'));
        await staleFailure;
        assert.equal(app.state.videos[0].Id, 'current');
        assert.equal(roundResets, 2);
    });
}
