import assert from "node:assert/strict";

const storage = {
  settings: {
    workMinutes: 60,
    breakMinutes: 10,
    volume: 0.8,
    sound: "alarm",
    soundDurationMinutes: 5,
    customSound: "",
    soundEnabled: true,
    systemNotificationEnabled: true,
    popupEnabled: true,
    windows: [{ start: "00:00", end: "24:00" }]
  }
};
const alarms = new Map();
const calls = { notifications: [], windows: [], messages: [] };
let messageListener;
let offscreenOpen = false;

function eventSlot(setter) {
  return { addListener(listener) { setter(listener); } };
}

globalThis.clients = { matchAll: async () => [] };
globalThis.chrome = {
  storage: {
    local: {
      async get(key) {
        if (typeof key === "string") return { [key]: storage[key] };
        return { ...storage };
      },
      async set(values) { Object.assign(storage, values); }
    }
  },
  alarms: {
    async get(name) { return alarms.get(name); },
    async create(name, options) { alarms.set(name, { name, ...options }); },
    onAlarm: eventSlot(() => {})
  },
  idle: { async queryState() { return "active"; } },
  offscreen: { async createDocument() { offscreenOpen = true; } },
  notifications: {
    async create(id, options) { calls.notifications.push({ id, options }); }
  },
  windows: {
    async create(options) { calls.windows.push(options); return { id: calls.windows.length }; },
    async remove() {},
    onRemoved: eventSlot(() => {})
  },
  runtime: {
    getURL(path) { return `chrome-extension://test/${path}`; },
    async getContexts() { return offscreenOpen ? [{ contextType: "OFFSCREEN_DOCUMENT" }] : []; },
    async sendMessage(message) { calls.messages.push(message); return { ok: true }; },
    onInstalled: eventSlot(() => {}),
    onStartup: eventSlot(() => {}),
    onMessage: eventSlot(listener => { messageListener = listener; })
  }
};

await import(`../background.js?test=${Date.now()}`);
await new Promise(resolve => setTimeout(resolve, 25));

assert.ok(alarms.has("break-bell-tick"), "后台启动时应自动创建周期闹钟");
assert.equal(storage.state.mode, "work", "当前位于工作时段时应进入工作模式");
assert.ok(calls.notifications.length >= 1, "进入工作时段时应创建系统通知");
assert.ok(calls.windows.length >= 1, "进入工作时段时应打开提醒弹窗");
assert.ok(calls.messages.some(message => message.target === "offscreen"), "提醒时应独立发送声音播放消息");
assert.ok(calls.messages.some(message => message.type === "ring" && message.durationMinutes === 5), "铃声默认应循环五分钟");

function send(message) {
  return new Promise(resolve => {
    const keepPortOpen = messageListener(message, {}, resolve);
    assert.equal(keepPortOpen, true, "异步消息应保持消息通道打开");
  });
}

const response = await send({ type: "testReminder" });

assert.equal(response.ok, true, "测试提醒应成功返回");
assert.ok(calls.notifications.length >= 2, "测试提醒应创建系统通知");
assert.ok(calls.windows.length >= 2, "测试提醒应打开弹窗");
await send({ type: "stopReminderSound" });
assert.ok(calls.messages.some(message => message.type === "stop"), "点击知道了时应向声音页面发送停止消息");

storage.state = {
  ...storage.state,
  mode: "work",
  windowIndex: 0,
  elapsedMs: 15 * 60 * 1000,
  lastTickAt: Date.now()
};
const pauseResponse = await send({ type: "togglePause" });
assert.deepEqual(pauseResponse, { ok: true, paused: true }, "工作计时应能暂停");
const pausedElapsed = storage.state.elapsedMs;
await send({ type: "getStatus" });
assert.equal(storage.state.mode, "paused", "暂停时应保持暂停状态");
assert.equal(storage.state.elapsedMs, pausedElapsed, "暂停时不应累计工作时长");
const resumeResponse = await send({ type: "togglePause" });
assert.deepEqual(resumeResponse, { ok: true, paused: false }, "暂停后的工作计时应能继续");
assert.equal(storage.state.mode, "work", "恢复后应回到工作计时");
assert.equal(storage.state.elapsedMs, pausedElapsed, "恢复时应延续原有工作进度");

const countsBeforeSilence = {
  notifications: calls.notifications.length,
  windows: calls.windows.length,
  messages: calls.messages.length
};
const silentResponse = await send({
  type: "testReminder",
  soundEnabled: false,
  systemNotificationEnabled: false,
  popupEnabled: false
});
assert.equal(silentResponse.ok, true, "全部提醒方式关闭时测试应正常完成");
assert.equal(calls.notifications.length, countsBeforeSilence.notifications, "关闭系统通知后不应创建通知");
assert.equal(calls.windows.length, countsBeforeSilence.windows, "关闭浏览器弹窗后不应打开窗口");
assert.equal(calls.messages.length, countsBeforeSilence.messages, "关闭声音后不应发送播放消息");

alarms.delete("break-bell-tick");
storage.state.mode = "work";
storage.state.elapsedMs = 60 * 60 * 1000;
storage.state.lastTickAt = Date.now();
await send({ type: "getStatus" });

assert.ok(alarms.has("break-bell-tick"), "周期闹钟丢失后应自动重建");
assert.equal(storage.state.mode, "break", "达到工作时长后应自动进入休息倒计时");
assert.ok(calls.notifications.some(call => call.options.title === "该休息了"), "达到工作时长后应发出休息通知");

console.log("background reminder tests passed");
