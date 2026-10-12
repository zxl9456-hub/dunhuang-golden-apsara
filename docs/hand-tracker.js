export class HandTracker {
  constructor(video, onResult, onState) {
    Object.assign(this, { video, onResult, onState, stream: null, worker: null, active: false, starting: false, session: 0, busy: false, ready: false, interval: 34, lastSent: -Infinity, lastVideoTime: -1 });
    this.capture = document.createElement('canvas');
    this.captureContext = this.capture.getContext('2d', { alpha: false });
  }
  async start() {
    if (this.active || this.starting) return;
    const session = ++this.session;
    this.starting = true;
    this.onState('starting', '正在开启摄像头…');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('请通过 localhost 或 HTTPS 打开页面后使用摄像头。');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } } });
      if (session !== this.session) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      if (session !== this.session) return;
      this.active = true; this.starting = false; this.busy = false; this.ready = false;
      this.lastSent = -Infinity; this.lastVideoTime = -1;
      this.capture.width = 480;
      this.capture.height = Math.round(480 * this.video.videoHeight / this.video.videoWidth);
      this.onState('loading', '摄像头已开启 · 正在加载手部识别…');
      const worker = this.worker = new Worker(new URL('./hand-worker.js', import.meta.url), { type: 'module' });
      this.initTimeout = setTimeout(() => { if (session === this.session) this.fail('手部模型加载超时，请重试。'); }, 45000);
      worker.onmessage = ({ data }) => {
        if (session !== this.session) return;
        if (data.type === 'ready') {
          clearTimeout(this.initTimeout); this.ready = true; this.delegate = data.delegate;
          this.onState('ready', '把双手伸入沙面，拨动这片沙粒');
          this.tick(performance.now());
        } else if (data.type === 'result') {
          this.busy = false; this.inferenceMs = data.inferenceMs; this.latencyMs = performance.now() - data.timestamp;
          this.interval = 24;
          this.onResult(data.hands || [], data.timestamp);
          // Send the newest frame immediately when inference finishes; RAF remains
          // the fallback when the video has not advanced yet. Never queue frames.
          this.tick(performance.now());
        } else if (data.type === 'error') this.fail('手部识别未能启动，请重试。', data.message);
      };
      worker.onerror = event => { if (session === this.session) this.fail('手部识别加载失败，请重试。', event.message); };
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (session === this.session) this.fail('摄像头已断开，请重新开启。'); });
      worker.postMessage({ type: 'init', delegate: new URLSearchParams(location.search).get('tracker') || 'CPU' });
    } catch (error) {
      if (session !== this.session) return;
      const messages = {
        NotAllowedError: '摄像头未获允许。请在浏览器地址栏允许摄像头，再点击重试。',
        NotFoundError: '没有找到摄像头，请连接摄像头后重试。',
        NotReadableError: '摄像头无法读取，可能正在被其他程序占用。',
      };
      this.fail(messages[error.name] || error.message);
    }
  }
  async tick(now) {
    if (!this.active || !this.ready || this.busy || document.hidden || this.video.readyState < 2 || now - this.lastSent < this.interval || this.video.currentTime === this.lastVideoTime) return;
    this.busy = true; this.lastSent = now; this.lastVideoTime = this.video.currentTime;
    const session = this.session;
    try {
      this.captureContext.drawImage(this.video, 0, 0, this.capture.width, this.capture.height);
      const bitmap = await createImageBitmap(this.capture);
      if (session !== this.session) { bitmap.close(); return; }
      this.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
    } catch (error) { if (session === this.session) this.fail('无法读取摄像头画面，请重试。', error.message); }
  }
  fail(message, detail) {
    if (detail) console.error('Hand tracking:', detail);
    this.stop(false); this.onState('error', message);
  }
  stop(notify = true) {
    this.session++; clearTimeout(this.initTimeout);
    this.worker?.terminate(); this.worker = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null;
    this.active = false; this.starting = false; this.ready = false; this.busy = false;
    this.onResult([], performance.now());
    if (notify) this.onState('off', '摄像头已关闭');
  }
}
