const DEFAULT_SETTINGS = {
  workMinutes: 60,
  breakMinutes: 10,
  volume: 0.8,
  sound: "alarm",
  customSound: "",
  windows: [{ start: "08:30", end: "22:00" }]
};

const blankState = () => ({ mode: "outside", windowIndex: -1, elapsedMs: 0, breakEndsAt: 0, lastTickAt: Date.now(), date: dateKey() });
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function minutes(t) { const [h, m] = t.split(":").map(Number); return h * 60 + m; }
function nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); }
function getWindow(settings, minute = nowMinutes()) {
  return settings.windows.findIndex(w => minute >= minutes(w.start) && minute < minutes(w.end));
}
async function settings() { const x = await chrome.storage.local.get("settings"); return { ...DEFAULT_SETTINGS, ...(x.settings || {}) }; }
async function getState() { const x = await chrome.storage.local.get("state"); return x.state || blankState(); }
async function putState(state) { state.lastTickAt = Date.now(); await chrome.storage.local.set({ state }); }

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument?.()) return;
  await chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["AUDIO_PLAYBACK"], justification: "播放用户配置的休息提醒声音" });
}
async function ring(s) {
  try { await ensureOffscreen(); await chrome.runtime.sendMessage({ type: "ring", sound: s.sound, customSound: s.customSound, volume: s.volume }); } catch (e) { console.warn("sound unavailable", e); }
}
async function notify(title, message, sound = true) {
  await chrome.notifications.create(`break-${Date.now()}`, { type: "basic", iconUrl: "icon.svg", title, message, priority: 2 });
  if (sound) await ring(await settings());
}

async function tick() {
  const s = await settings();
  let st = await getState();
  const today = dateKey();
  if (st.date !== today) st = blankState();
  const locked = (await chrome.idle.queryState(60)) === "locked";
  const now = Date.now();
  const delta = Math.max(0, now - (st.lastTickAt || now));
  if (locked) {
    if (st.mode === "break") st.breakEndsAt += delta;
    await putState(st);
    return;
  }
  const wi = getWindow(s);

  if (wi < 0) {
    if (st.mode !== "outside") {
      st = { ...blankState(), date: today };
      await notify("休息时间到了", "当前工作时段结束，请休息、走动一下。", true);
    } else st.lastTickAt = now;
    await putState(st); return;
  }
  if (st.mode === "outside" || st.windowIndex !== wi) {
    st = { ...blankState(), mode: "work", windowIndex: wi, date: today, lastTickAt: now };
    await notify("开始工作时段", `现在是 ${s.windows[wi].start}，计时开始。`, true);
    await putState(st); return;
  }
  if (st.mode === "break") {
    if (now >= st.breakEndsAt) {
      st.mode = "work"; st.elapsedMs = 0; st.breakEndsAt = 0;
      await notify("休息结束", "休息时间结束，下一轮工作计时开始。", true);
    }
    await putState(st); return;
  }
  st.elapsedMs += delta;
  if (st.elapsedMs >= s.workMinutes * 60000) {
    st.mode = "break"; st.breakEndsAt = now + s.breakMinutes * 60000; st.elapsedMs = 0;
    await notify("该休息了", `请离开座位活动 ${s.breakMinutes} 分钟。`, true);
  }
  await putState(st);
}

chrome.runtime.onInstalled.addListener(async () => { const x = await chrome.storage.local.get("settings"); if (!x.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS }); chrome.alarms.create("tick", { periodInMinutes: 1 }); tick(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create("tick", { periodInMinutes: 1 }); tick(); });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "tick") tick(); });
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === "getStatus") { await tick(); sendResponse({ settings: await settings(), state: await getState() }); }
    if (msg.type === "reset") { const st = await getState(); st.mode = getWindow(await settings()) >= 0 ? "work" : "outside"; st.elapsedMs = 0; st.breakEndsAt = 0; st.windowIndex = getWindow(await settings()); await putState(st); sendResponse({ ok: true }); }
  })(); return true;
});
