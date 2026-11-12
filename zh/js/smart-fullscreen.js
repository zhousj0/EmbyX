(function (window) {
    'use strict';
    class SmartFullscreenController {
        constructor(app) {
            this.app = app;
            this.active = false;
            this.generation = 0;
            this.direction = null;
            this.button = document.getElementById('smartFullscreenBtn');
            this.button?.addEventListener('click', e => {
                e.stopPropagation();
                this.toggle();
            });
            document.getElementById('fullscreenBtn')?.addEventListener('click', e => {
                if (!this.active) return;
                e.stopImmediatePropagation();
                this.exit();
            }, true);
            document.addEventListener('fullscreenchange', () => {
                if (this.active && !document.fullscreenElement && !this.busy) this.reset();
            });
            for (const event of ['loadedmetadata', 'playing', 'resize']) {
                document.addEventListener(event, e => {
                    if (!this.active || this.busy || e.target !== this.video) return;
                    const direction = this.videoDirection();
                    if (direction && direction !== this.direction) {
                        this.applyDirection(direction, this.generation).catch(() => {
                            if (this.active) this.app.showToast(this.message('当前浏览器无法自动旋转屏幕', 'Automatic rotation is unavailable'));
                        });
                    }
                }, true);
            }
        }

        message(zh, en) { return document.documentElement.lang.startsWith('en') ? en : zh; }

        get video() {
            return document.getElementById(`video-p${(this.app.state.currentIndex % 3 + 3) % 3}`);
        }

        videoDirection() {
            const item = this.app.state.videos[this.app.state.currentIndex];
            const video = this.video;
            let width, height;
            if (video && String(video._playbackItem?.Id) === String(item?.Id)) {
                width = video.videoWidth;
                height = video.videoHeight;
            }
            if (!width || !height) {
                const source = item?.MediaSources?.[item._selectedMediaSourceIndex || 0];
                const stream = source?.MediaStreams?.find(s => s.Type === 'Video');
                width = stream?.Width;
                height = stream?.Height;
            }
            return width > 0 && height > 0 ? (width > height ? 'landscape' : 'portrait') : null;
        }

        get native() { return window.EmbyXNative?.setSmartFullscreenOrientation; }

        async applyDirection(direction, generation) {
            if (!this.active || generation !== this.generation) return;
            if (this.native) {
                window.EmbyXNative.setSmartFullscreenOrientation(direction);
            } else {
                if (!window.screen?.orientation?.lock) throw new Error('Orientation lock unavailable');
                await window.screen.orientation.lock(direction);
                if (!this.active || generation !== this.generation) {
                    if (!this.active) window.screen.orientation.unlock?.();
                    return;
                }
            }
            this.direction = direction;
        }

        updateButton() {
            this.button?.setAttribute('aria-pressed', String(this.active));
            this.button?.classList.toggle('text-primary', this.active);
        }

        reset() {
            this.active = false;
            this.direction = null;
            this.generation++;
            if (this.native) window.EmbyXNative.setSmartFullscreenOrientation('restore');
            else window.screen?.orientation?.unlock?.();
            this.updateButton();
            document.getElementById('app')?.classList.remove('interface-hidden');
        }

        async exit() {
            this.reset();
            if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
        }

        async toggle() {
            if (this.busy) return;
            if (this.active) { await this.exit(); return; }
            if (this.app.state.viewMode !== 'stream' || this.app.castManager?.isCasting) return;
            let direction = this.videoDirection();
            if (!direction) {
                this.app.showToast(this.message('视频尺寸尚未就绪，请稍后重试', 'Video dimensions are not ready yet'));
                return;
            }
            this.busy = true;
            this.active = true;
            const generation = ++this.generation;
            this.updateButton();
            try {
                if (!document.fullscreenElement) {
                    if (this.native) {
                        // The APK is already immersive; Web fullscreen is optional.
                        await document.documentElement.requestFullscreen?.().catch(() => {});
                    } else {
                        if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen unavailable');
                        await document.documentElement.requestFullscreen();
                    }
                }
                direction = this.videoDirection() || direction;
                await this.applyDirection(direction, generation);
                if (this.active) this.app.showInterfaceTemp?.();
            } catch (e) {
                await this.exit();
                this.app.showToast(this.message('当前浏览器不支持智能全屏旋转，请使用安卓 APK', 'Smart fullscreen rotation requires a supported browser or the Android app'));
            } finally {
                this.busy = false;
            }
        }
    }
    window.SmartFullscreenController = SmartFullscreenController;
})(window);
