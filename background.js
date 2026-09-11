const TICK_ALARM = "break-bell-tick";
const WORK_DEADLINE_ALARM = "break-bell-work-deadline";
const MAX_CONTINUOUS_TICK_GAP_MS = 5 * 60 * 1000;
const NOTIFICATION_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const DEFAULT_SETTINGS = {
  workMinutes: 60,
  breakMinutes: 10,
  volume: 0.8,
  sound: "alarm",
  soundDurationMinutes: 5,
  customSound: "",
  soundEnabled: true,
  systemNotificationEnabled: true,
  popupEnabled: true,
  displaySleepAllowed: true,
  windows: [{ start: "08:30", end: "22:00" }]
};

let creatingOffscreen = null;
let runningTick = null;
let pendingWorkDeadlineDue = false;
let reminderWindowId = null;

function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function blankState() {
  return {
    mode: "outside",
    windowIndex: -1,
    elapsedMs: 0,
    breakEndsAt: 0,
    pausedFrom: null,
    pausedAt: 0,
    lastTickAt: Date.now(),
    date: dateKey()
  };
}

function minutes(time) {
  const [hours, mins] = time.split(":").map(Number);
  return hours * 60 + mins;
}

function nowMinutes() {
  const date = new Date();
  return date.getHours() * 60 + date.getMinutes();
}

function getWindow(settings, minute = nowMinutes()) {
  return settings.windows.findIndex(window => minute >= minutes(window.start) && minute < minutes(window.end));
}

async function getSettings() {
  const stored = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
}

function syncDisplaySleep(settings) {
  if (settings.displaySleepAllowed) {
    chrome.power.releaseKeepAwake();
  } else {
    chrome.power.requestKeepAwake("display");
  }
}

async function getState() {
  const stored = await chrome.storage.local.get("state");
  return stored.state || blankState();
}

async function putState(state) {
  state.lastTickAt = Date.now();
  await chrome.storage.local.set({ state });
}

async function recordDiagnostic(values) {
  await chrome.storage.local.set({ diagnostics: { ...(await chrome.storage.local.get("diagnostics")).diagnostics, ...values } });
}

async function ensureTickAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) await chrome.alarms.create(TICK_ALARM, { delayInMinutes: 1, periodInMinutes: 1 });
  await recordDiagnostic({ alarmReadyAt: Date.now() });
}

async function clearWorkDeadline() {
  await chrome.alarms.clear(WORK_DEADLINE_ALARM);
}

async function scheduleWorkDeadline(state, settings, now = Date.now()) {
  if (state.mode !== "work") {
    await clearWorkDeadline();
    return;
  }
  const remainingMs = Math.max(0, settings.workMinutes * 60 * 1000 - state.elapsedMs);
  await chrome.alarms.create(WORK_DEADLINE_ALARM, { when: now + remainingMs });
}

async function hasOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL("offscreen.html");
  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  const clientsList = await clients.matchAll();
  return clientsList.some(client => client.url === offscreenUrl);
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  if (!creatingOffscreen) {
    creatingOffscreen = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "播放用户配置的休息提醒声音"
    }).finally(() => { creatingOffscreen = null; });
  }
  await creatingOffscreen;
}

async function ring(settings, soundStatus) {
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "ring",
    sound: settings.sound,
    customSound: settings.customSound,
    volume: settings.volume,
    durationMinutes: settings.soundDurationMinutes
  });
  if (!response?.ok) throw new Error(response?.error || "声音播放失败");
  const durationMinutes = Math.min(30, Math.max(0.5, Number(settings.soundDurationMinutes) || 5));
  await chrome.storage.local.set({
    soundStatus: { ...soundStatus, endsAt: Date.now() + durationMinutes * 60 * 1000 }
  });
}

async function stopSound() {
  if (await hasOffscreenDocument()) {
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stop" });
  }
  await chrome.storage.local.set({ soundStatus: null });
}

async function getSoundStatus() {
  const stored = await chrome.storage.local.get("soundStatus");
  return stored.soundStatus?.endsAt > Date.now() ? stored.soundStatus : null;
}

async function showReminderWindow(title, message, kind, durationMinutes = 0) {
  if (reminderWindowId !== null) {
    try { await chrome.windows.remove(reminderWindowId); } catch { /* window was already closed */ }
    reminderWindowId = null;
  }

  const query = new URLSearchParams({ title, message, kind, durationMinutes: String(durationMinutes) });
  const popup = await chrome.windows.create({
    url: `reminder.html?${query}`,
    type: "popup",
    focused: true,
    width: 430,
    height: 360
  });
  reminderWindowId = popup.id ?? null;
}

async function notify(title, message, { kind = "reminder", durationMinutes = 0, settingsOverride = {} } = {}) {
  const settings = { ...await getSettings(), ...settingsOverride };
  if (kind !== "test") await stopSound();
  const channels = [];
  if (settings.systemNotificationEnabled) {
    channels.push(chrome.notifications.create(`break-bell-${Date.now()}`, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title,
      message,
      priority: 2
    }));
  }
  if (settings.soundEnabled) channels.push(ring(settings, { title, kind }));
  if (settings.popupEnabled) channels.push(showReminderWindow(title, message, kind, durationMinutes));

  const results = await Promise.allSettled(channels);

  const errors = results
    .filter(result => result.status === "rejected")
    .map(result => String(result.reason?.message || result.reason));
  await recordDiagnostic({
    lastReminderAt: Date.now(),
    lastReminderTitle: title,
    lastReminderError: errors.join("；")
  });
  if (results.length && errors.length === results.length) throw new Error(errors.join("；"));
  return { errors };
}

async function tick({ workDeadlineDue = false } = {}) {
  await ensureTickAlarm();
  const settings = await getSettings();
  let state = await getState();
  const today = dateKey();
  if (state.date !== today && state.mode !== "paused") state = blankState();

  const now = Date.now();
  const rawDelta = Math.max(0, now - (state.lastTickAt || now));
  const locked = (await chrome.idle.queryState(60)) === "locked";

  if (locked) {
    if (state.mode === "break") state.breakEndsAt += rawDelta;
    await putState(state);
    await scheduleWorkDeadline(state, settings, now);
    return;
  }

  if (rawDelta > MAX_CONTINUOUS_TICK_GAP_MS && state.mode === "break") {
    state.breakEndsAt += rawDelta;
  }

  if (state.mode === "paused") {
    await putState(state);
    await clearWorkDeadline();
    return;
  }

  const activeWindowIndex = getWindow(settings);
  if (activeWindowIndex < 0) {
    if (state.mode !== "outside") {
      state = blankState();
      await putState(state);
      await clearWorkDeadline();
      await notify("休息时间到了", "当前工作时段结束，请休息、走动一下。", { kind: "outside" });
    } else {
      await putState(state);
      await clearWorkDeadline();
    }
    return;
  }

  if (state.mode === "outside" || state.windowIndex !== activeWindowIndex) {
    state = {
      ...blankState(),
      mode: "work",
      windowIndex: activeWindowIndex,
      date: today
    };
    await putState(state);
    await scheduleWorkDeadline(state, settings, now);
    await notify("开始工作时段", `现在是 ${settings.windows[activeWindowIndex].start}，新一轮计时开始。`, { kind: "work" });
    return;
  }

  if (state.mode === "break") {
    if (now >= state.breakEndsAt) {
      state.mode = "work";
      state.elapsedMs = 0;
      state.breakEndsAt = 0;
      await putState(state);
      await scheduleWorkDeadline(state, settings, now);
      await notify("休息结束", "休息时间结束，下一轮工作计时开始。", { kind: "work" });
    } else {
      await putState(state);
      await clearWorkDeadline();
    }
    return;
  }

  if (rawDelta <= MAX_CONTINUOUS_TICK_GAP_MS) state.elapsedMs += rawDelta;
  if (workDeadlineDue || state.elapsedMs >= settings.workMinutes * 60 * 1000) {
    state.mode = "break";
    state.breakEndsAt = now + settings.breakMinutes * 60 * 1000;
    state.elapsedMs = 0;
    await putState(state);
    await clearWorkDeadline();
    await notify("该休息了", `请离开座位活动 ${settings.breakMinutes} 分钟。`, {
      kind: "break",
      durationMinutes: settings.breakMinutes
    });
  } else {
    await putState(state);
    await scheduleWorkDeadline(state, settings, now);
  }
}

function runTick(options) {
  if (options?.workDeadlineDue) pendingWorkDeadlineDue = true;
  if (!runningTick) {
    const workDeadlineDue = pendingWorkDeadlineDue;
    pendingWorkDeadlineDue = false;
    runningTick = tick({ workDeadlineDue }).catch(async error => {
    console.error("Break Bell tick failed", error);
    await recordDiagnostic({ lastTickError: String(error?.message || error), lastTickErrorAt: Date.now() });
    }).finally(() => {
      runningTick = null;
      if (pendingWorkDeadlineDue) void runTick();
    });
  }
  return runningTick;
}

async function initialize({ reset = false } = {}) {
  const stored = await chrome.storage.local.get("settings");
  if (!stored.settings) await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  syncDisplaySleep(await getSettings());
  if (reset) await chrome.storage.local.set({ state: blankState() });
  await ensureTickAlarm();
  await runTick();
}

chrome.runtime.onInstalled.addListener(() => { void initialize({ reset: true }); });
chrome.runtime.onStartup.addListener(() => { void initialize({ reset: true }); });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === TICK_ALARM) void runTick();
  if (alarm.name === WORK_DEADLINE_ALARM) void runTick({ workDeadlineDue: true });
});
chrome.windows.onRemoved.addListener(windowId => { if (windowId === reminderWindowId) reminderWindowId = null; });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target === "offscreen") return false;

  if (message.type === "getStatus") {
    (async () => {
      await runTick();
      sendResponse({
        settings: await getSettings(),
        state: await getState(),
        soundStatus: await getSoundStatus(),
        diagnostics: (await chrome.storage.local.get("diagnostics")).diagnostics || {},
        alarmReady: Boolean(await chrome.alarms.get(TICK_ALARM))
      });
    })();
    return true;
  }

  if (message.type === "reset") {
    (async () => {
      await stopSound();
      const settings = await getSettings();
      const windowIndex = getWindow(settings);
      const state = {
        ...blankState(),
        mode: windowIndex >= 0 ? "work" : "outside",
        windowIndex
      };
      await putState(state);
      await scheduleWorkDeadline(state, settings);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "togglePause") {
    (async () => {
      await runTick();
      const settings = await getSettings();
      let state = await getState();
      const windowIndex = getWindow(settings);
      const now = Date.now();

      if (state.mode === "paused") {
        const sameWindow = windowIndex >= 0 && windowIndex === state.windowIndex && state.date === dateKey();
        const pauseDuration = Math.max(0, now - (state.pausedAt || now));
        if (sameWindow && state.pausedFrom === "work") {
          state = { ...state, mode: "work", pausedFrom: null, pausedAt: 0 };
        } else if (sameWindow && state.pausedFrom === "break") {
          state = {
            ...state,
            mode: "break",
            breakEndsAt: state.breakEndsAt + pauseDuration,
            pausedFrom: null,
            pausedAt: 0
          };
        } else {
          state = {
            ...blankState(),
            mode: windowIndex >= 0 ? "work" : "outside",
            windowIndex
          };
        }
      } else {
        state = { ...state, mode: "paused", pausedFrom: state.mode, pausedAt: now };
        await stopSound();
      }

      await putState(state);
      await scheduleWorkDeadline(state, settings, now);
      sendResponse({ ok: true, paused: state.mode === "paused" });
    })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "settingsChanged") {
    (async () => {
      await stopSound();
      const settings = await getSettings();
      syncDisplaySleep(settings);
      const windowIndex = getWindow(settings);
      const state = { ...blankState(), mode: windowIndex >= 0 ? "work" : "outside", windowIndex };
      await putState(state);
      await scheduleWorkDeadline(state, settings);
      await ensureTickAlarm();
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "setDisplaySleepAllowed") {
    (async () => {
      const settings = {
        ...await getSettings(),
        displaySleepAllowed: Boolean(message.displaySleepAllowed)
      };
      await chrome.storage.local.set({ settings });
      syncDisplaySleep(settings);
      sendResponse({ ok: true, displaySleepAllowed: settings.displaySleepAllowed });
    })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "testReminder") {
    const settingsOverride = Object.fromEntries(Object.entries({
      sound: message.sound,
      volume: message.volume,
      soundDurationMinutes: message.soundDurationMinutes,
      customSound: message.customSound,
      soundEnabled: message.soundEnabled,
      systemNotificationEnabled: message.systemNotificationEnabled,
      popupEnabled: message.popupEnabled
    }).filter(([, value]) => value !== undefined));
    notify("测试提醒", "如果你看到弹窗并听到声音，提醒功能已经正常工作。", {
      kind: "test",
      settingsOverride
    })
      .then(result => sendResponse({ ok: true, warning: result.errors.join("；") }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "stopReminderSound") {
    stopSound()
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "dismissReminder") {
    (async () => {
      await stopSound();
      const windowId = Number.isInteger(message.windowId) ? message.windowId : reminderWindowId;
      reminderWindowId = null;
      if (windowId !== null && windowId !== undefined) {
        try { await chrome.windows.remove(windowId); } catch { /* window was already closed */ }
      }
      sendResponse({ ok: true });
    })().catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return false;
});

void ensureTickAlarm().then(runTick).catch(error => {
  console.error("Break Bell initialization failed", error);
  void recordDiagnostic({ initializationError: String(error?.message || error), initializationErrorAt: Date.now() });
});

void getSettings().then(syncDisplaySleep).catch(error => {
  console.error("Break Bell display power initialization failed", error);
  void recordDiagnostic({ displayPowerInitializationError: String(error?.message || error), displayPowerInitializationErrorAt: Date.now() });
});
