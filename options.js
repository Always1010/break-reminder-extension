const DEFAULTS = {
  workMinutes: 60,
  breakMinutes: 10,
  volume: 0.8,
  sound: "alarm",
  soundDurationMinutes: 5,
  customSound: "",
  audioOutputDeviceId: "",
  audioOutputDeviceLabel: "",
  soundEnabled: true,
  systemNotificationEnabled: true,
  popupEnabled: true,
  displaySleepAllowed: true,
  windows: [{ start: "08:30", end: "22:00" }]
};

const SNAP_MINUTES = 5;
const MIN_PERIOD_MINUTES = 30;
const $ = id => document.getElementById(id);
const timeline = $("scheduleTimeline");
let settings;
let periods = [];
let selectedIndex = -1;
let drag = null;
let audioOutputSelectionInitialized = false;

function setAudioOutputStatus(message, kind = "") {
  const status = $("audioOutputStatus");
  status.textContent = message;
  status.dataset.kind = kind;
}

function renderAudioOutputs(outputs) {
  const select = $("audioOutput");
  const selectedId = audioOutputSelectionInitialized ? select.value : settings?.audioOutputDeviceId || "";
  const selectedLabel = settings?.audioOutputDeviceLabel || "已保存的音频设备";
  const defaultOption = new Option("系统默认输出（跟随浏览器）", "");
  defaultOption.dataset.deviceLabel = "系统默认输出（跟随浏览器）";
  select.replaceChildren(defaultOption);

  outputs.forEach((device, index) => {
    const label = device.label || `音频输出设备 ${index + 1}`;
    const option = new Option(label, device.deviceId);
    option.dataset.deviceLabel = label;
    select.add(option);
  });

  if (selectedId && !outputs.some(device => device.deviceId === selectedId)) {
    const unavailable = new Option(`${selectedLabel}（当前未连接或需要授权刷新）`, selectedId);
    unavailable.dataset.unavailable = "true";
    unavailable.dataset.deviceLabel = selectedLabel;
    select.add(unavailable);
  }
  select.value = selectedId;
  audioOutputSelectionInitialized = true;
}

async function refreshAudioOutputs({ requestPermission = false } = {}) {
  const button = $("refreshAudioOutputs");
  if (!navigator.mediaDevices?.enumerateDevices || !("setSinkId" in AudioContext.prototype)) {
    button.disabled = true;
    setAudioOutputStatus("当前浏览器不支持为插件单独选择声音输出设备。", "error");
    return;
  }

  button.disabled = true;
  button.textContent = requestPermission ? "正在请求授权…" : "正在读取设备…";
  try {
    if (requestPermission) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop());
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(device => device.kind === "audiooutput");
    renderAudioOutputs(outputs);
    const namedOutputs = outputs.filter(device => device.label).length;
    setAudioOutputStatus(
      namedOutputs
        ? `已发现 ${namedOutputs} 个可识别的输出设备。选择后请保存设置并测试铃声。`
        : "浏览器尚未显示完整设备名称，请点击“授权并刷新设备”。",
      namedOutputs ? "success" : ""
    );
  } catch (error) {
    const denied = error?.name === "NotAllowedError";
    setAudioOutputStatus(
      denied ? "未获得音频设备权限，仍可继续使用系统默认输出。" : `读取音频设备失败：${error?.message || error}`,
      "error"
    );
  } finally {
    button.disabled = false;
    button.textContent = "授权并刷新设备";
  }
}

function toMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function toTime(value) {
  const minutes = Math.max(0, Math.min(1439, Math.round(value)));
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function snap(value) {
  return Math.max(0, Math.min(1440, Math.round(value / SNAP_MINUTES) * SNAP_MINUTES));
}

function snapDelta(value) {
  return Math.round(value / SNAP_MINUTES) * SNAP_MINUTES;
}

function normalizePeriods(items) {
  const sorted = items
    .map(period => ({ start: snap(period.start), end: snap(period.end) }))
    .filter(period => period.end - period.start >= MIN_PERIOD_MINUTES)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const period of sorted) {
    const previous = merged.at(-1);
    if (previous && period.start <= previous.end) previous.end = Math.max(previous.end, period.end);
    else merged.push({ ...period });
  }
  return merged;
}

function announce(message) {
  $("timelineMessage").textContent = message;
}

function updateEditor() {
  const editor = $("periodEditor");
  const period = periods[selectedIndex];
  editor.hidden = !period;
  if (!period) return;
  $("selectedStart").value = toTime(period.start);
  $("selectedEnd").value = toTime(period.end);
}

function renderTimeline() {
  timeline.replaceChildren();
  periods.forEach((period, index) => {
    const block = document.createElement("button");
    block.type = "button";
    block.className = `period-block${index === selectedIndex ? " selected" : ""}`;
    block.dataset.index = index;
    block.style.left = `${period.start / 14.4}%`;
    block.style.width = `${(period.end - period.start) / 14.4}%`;
    block.setAttribute("aria-label", `工作时段 ${toTime(period.start)} 到 ${toTime(period.end)}`);
    block.innerHTML = `<span class="period-handle start-handle" data-edge="start" aria-hidden="true"></span><span class="period-label"><strong>${toTime(period.start)}</strong><span>—</span><strong>${toTime(period.end)}</strong></span><span class="period-handle end-handle" data-edge="end" aria-hidden="true"></span>`;
    timeline.appendChild(block);
  });
  updateEditor();
}

function selectPeriod(index) {
  selectedIndex = index;
  renderTimeline();
}

function addPeriodAt(centerMinutes = 9 * 60 + 30) {
  const start = Math.max(0, Math.min(1380, snap(centerMinutes - 30)));
  periods = normalizePeriods([...periods, { start, end: start + 60 }]);
  selectedIndex = periods.findIndex(period => start >= period.start && start < period.end);
  renderTimeline();
  announce("已新增工作时段，可以直接拖动调整。");
}

timeline.addEventListener("pointerdown", event => {
  const block = event.target.closest(".period-block");
  if (!block) return;
  event.preventDefault();
  selectedIndex = Number(block.dataset.index);
  const period = periods[selectedIndex];
  drag = {
    pointerId: event.pointerId,
    mode: event.target.dataset.edge || "move",
    pointerX: event.clientX,
    originalStart: period.start,
    originalEnd: period.end
  };
  timeline.setPointerCapture(event.pointerId);
  renderTimeline();
});

timeline.addEventListener("pointermove", event => {
  if (!drag || event.pointerId !== drag.pointerId) return;
  const delta = snapDelta((event.clientX - drag.pointerX) / timeline.clientWidth * 1440);
  const period = periods[selectedIndex];

  if (drag.mode === "start") {
    period.start = Math.max(0, Math.min(drag.originalEnd - MIN_PERIOD_MINUTES, snap(drag.originalStart + delta)));
  } else if (drag.mode === "end") {
    period.end = Math.min(1440, Math.max(drag.originalStart + MIN_PERIOD_MINUTES, snap(drag.originalEnd + delta)));
  } else {
    const duration = drag.originalEnd - drag.originalStart;
    period.start = Math.max(0, Math.min(1440 - duration, snap(drag.originalStart + delta)));
    period.end = period.start + duration;
  }
  renderTimeline();
});

function finishDrag(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  drag = null;
  const selectedMinute = periods[selectedIndex]?.start ?? 0;
  const countBefore = periods.length;
  periods = normalizePeriods(periods);
  selectedIndex = Math.max(0, periods.findIndex(period => selectedMinute >= period.start && selectedMinute <= period.end));
  renderTimeline();
  if (periods.length < countBefore) announce("重叠的工作时段已自动合并。");
}

timeline.addEventListener("pointerup", finishDrag);
timeline.addEventListener("pointercancel", finishDrag);

timeline.addEventListener("click", event => {
  if (event.target.closest(".period-block")) return;
  const bounds = timeline.getBoundingClientRect();
  addPeriodAt((event.clientX - bounds.left) / bounds.width * 1440);
});

$("selectedStart").addEventListener("change", event => {
  const period = periods[selectedIndex];
  if (!period) return;
  period.start = Math.min(period.end - MIN_PERIOD_MINUTES, snap(toMinutes(event.target.value)));
  periods = normalizePeriods(periods);
  selectedIndex = periods.findIndex(item => period.start >= item.start && period.start <= item.end);
  renderTimeline();
});

$("selectedEnd").addEventListener("change", event => {
  const period = periods[selectedIndex];
  if (!period) return;
  period.end = Math.max(period.start + MIN_PERIOD_MINUTES, snap(toMinutes(event.target.value)));
  periods = normalizePeriods(periods);
  selectedIndex = periods.findIndex(item => period.start >= item.start && period.start <= item.end);
  renderTimeline();
});

$("deletePeriod").addEventListener("click", () => {
  if (selectedIndex < 0) return;
  periods.splice(selectedIndex, 1);
  selectedIndex = periods.length ? Math.min(selectedIndex, periods.length - 1) : -1;
  renderTimeline();
  announce("工作时段已删除，保存后生效。");
});

$("add").addEventListener("click", () => {
  const lastEnd = periods.at(-1)?.end ?? 8 * 60;
  addPeriodAt(Math.min(1410, lastEnd + 90));
});

$("refreshAudioOutputs").addEventListener("click", () => {
  void refreshAudioOutputs({ requestPermission: true });
});

navigator.mediaDevices?.addEventListener("devicechange", () => {
  void refreshAudioOutputs();
});

$("testReminder").addEventListener("click", async () => {
  const button = $("testReminder");
  button.disabled = true;
  button.textContent = "正在测试…";
  try {
    let customSound = settings.customSound;
    const previewFile = $("custom").files[0];
    if (previewFile) {
      customSound = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(previewFile);
      });
    }
    const response = await chrome.runtime.sendMessage({
      type: "testReminder",
      sound: $("sound").value,
      volume: Math.min(1, Math.max(0, Number($("volume").value) / 100)),
      soundDurationMinutes: Math.min(30, Math.max(0.5, Number($("soundDuration").value) || 5)),
      customSound,
      audioOutputDeviceId: $("audioOutput").value,
      soundEnabled: $("soundEnabled").checked,
      systemNotificationEnabled: $("systemNotificationEnabled").checked,
      popupEnabled: $("popupEnabled").checked
    });
    if (!response?.ok) throw new Error(response?.error || "测试提醒失败");
    const enabledCount = [$("soundEnabled").checked, $("systemNotificationEnabled").checked, $("popupEnabled").checked].filter(Boolean).length;
    announce(response.warning ? `测试已发出，但有部分异常：${response.warning}` : enabledCount ? "测试提醒已发出。仅已启用的提醒方式会生效。" : "提醒方式均未开启，本次测试不会产生提醒。");
  } catch (error) {
    announce(`测试失败：${error?.message || error}`);
  } finally {
    button.disabled = false;
    button.textContent = "🔔 测试声音、通知和弹窗";
  }
});

$("custom").addEventListener("change", () => {
  if ($("custom").files.length) $("sound").value = "custom";
});

async function init() {
  const stored = await chrome.storage.local.get("settings");
  settings = { ...DEFAULTS, ...(stored.settings || {}) };
  periods = normalizePeriods(settings.windows.map(period => ({ start: toMinutes(period.start), end: toMinutes(period.end) })));
  selectedIndex = periods.length ? 0 : -1;
  $("work").value = settings.workMinutes;
  $("break").value = settings.breakMinutes;
  $("volume").value = Math.round(settings.volume * 100);
  $("sound").value = settings.sound;
  $("soundDuration").value = settings.soundDurationMinutes;
  $("soundEnabled").checked = settings.soundEnabled;
  $("systemNotificationEnabled").checked = settings.systemNotificationEnabled;
  $("popupEnabled").checked = settings.popupEnabled;
  $("audioOutput").value = settings.audioOutputDeviceId;
  renderTimeline();
  await refreshAudioOutputs();
}

$("save").addEventListener("click", async () => {
  if (!periods.length) {
    announce("请至少设置一个工作时段。");
    return;
  }

  let customSound = settings.customSound;
  const file = $("custom").files[0];
  if (file) {
    customSound = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const nextSettings = {
    workMinutes: Math.max(1, Number($("work").value)),
    breakMinutes: Math.max(1, Number($("break").value)),
    volume: Math.min(1, Math.max(0, Number($("volume").value) / 100)),
    sound: $("sound").value,
    soundDurationMinutes: Math.min(30, Math.max(0.5, Number($("soundDuration").value) || 5)),
    customSound,
    audioOutputDeviceId: $("audioOutput").value,
    audioOutputDeviceLabel: $("audioOutput").selectedOptions[0]?.dataset.deviceLabel || "",
    soundEnabled: $("soundEnabled").checked,
    systemNotificationEnabled: $("systemNotificationEnabled").checked,
    popupEnabled: $("popupEnabled").checked,
    displaySleepAllowed: settings.displaySleepAllowed,
    windows: normalizePeriods(periods).map(period => ({ start: toTime(period.start), end: toTime(Math.min(1439, period.end)) }))
  };

  await chrome.storage.local.set({ settings: nextSettings });
  await chrome.runtime.sendMessage({ type: "settingsChanged" });
  settings = nextSettings;
  $("saved").textContent = "已保存";
  setTimeout(() => $("saved").textContent = "", 1800);
});

init();
