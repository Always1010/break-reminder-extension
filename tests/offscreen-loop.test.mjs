import assert from "node:assert/strict";

const sources = [];
const timers = [];
let messageListener;

class FakeAudioBuffer {
  constructor(channels, frames, sampleRate) {
    this.duration = frames / sampleRate;
    this.channels = Array.from({ length: channels }, () => new Float32Array(frames));
  }

  getChannelData(channel) {
    return this.channels[channel];
  }
}

class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
    this.sampleRate = 8000;
    this.state = "running";
  }

  createBuffer(channels, frames, sampleRate) {
    return new FakeAudioBuffer(channels, frames, sampleRate);
  }

  createGain() {
    return { gain: { value: 0 }, connect() {} };
  }

  createBufferSource() {
    const listeners = new Map();
    const source = {
      loop: false,
      buffer: null,
      connect() {},
      disconnect() {},
      start() { this.started = true; },
      stop() {
        this.stopped = true;
        listeners.get("ended")?.();
      },
      addEventListener(type, listener) { listeners.set(type, listener); }
    };
    sources.push(source);
    return source;
  }
}

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay) => {
  timers.push({ callback, delay });
  return timers.length;
};
globalThis.clearTimeout = () => {};
globalThis.AudioContext = FakeAudioContext;
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) { messageListener = listener; }
    },
    getURL(path) { return `chrome-extension://test/${path}`; }
  }
};

await import(`../offscreen.js?test=${Date.now()}`);

function send(message) {
  return new Promise(resolve => messageListener(message, {}, resolve));
}

const alarmResponse = await send({
  target: "offscreen",
  type: "ring",
  sound: "alarm",
  volume: 0.8,
  durationMinutes: 5
});

assert.deepEqual(alarmResponse, { ok: true }, "默认闹钟应能开始播放");
assert.equal(sources.length, 1, "默认闹钟应创建一个持续音源");
assert.equal(sources[0].loop, true, "默认闹钟应由音频引擎持续循环，而非依赖 JavaScript 定时重播");
assert.equal(sources[0].started, true, "默认闹钟应开始播放");
assert.equal(timers.at(-1).delay, 5 * 60 * 1000, "默认闹钟应在五分钟后自动停止");

const softResponse = await send({
  target: "offscreen",
  type: "ring",
  sound: "soft",
  volume: 0.5,
  durationMinutes: 0.5
});

assert.deepEqual(softResponse, { ok: true }, "轻柔提示音应能开始播放");
assert.equal(sources[0].stopped, true, "开始新铃声前应停止旧铃声");
assert.equal(sources[1].loop, true, "轻柔提示音也应持续循环");
assert.equal(timers.at(-1).delay, 30 * 1000, "可配置的播放时长应生效");

await send({ target: "offscreen", type: "stop" });
assert.equal(sources[1].stopped, true, "收到停止消息后应立即停止循环音源");

globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;

console.log("offscreen loop tests passed");
