const DEFAULTS = {
  workMinutes: 60,
  breakMinutes: 10,
  volume: 0.8,
  sound: "alarm",
  customSound: "",
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

async function init() {
  const stored = await chrome.storage.local.get("settings");
  settings = { ...DEFAULTS, ...(stored.settings || {}) };
  periods = normalizePeriods(settings.windows.map(period => ({ start: toMinutes(period.start), end: toMinutes(period.end) })));
  selectedIndex = periods.length ? 0 : -1;
  $("work").value = settings.workMinutes;
  $("break").value = settings.breakMinutes;
  $("volume").value = Math.round(settings.volume * 100);
  $("sound").value = settings.sound;
  renderTimeline();
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
    customSound,
    windows: normalizePeriods(periods).map(period => ({ start: toTime(period.start), end: toTime(Math.min(1439, period.end)) }))
  };

  await chrome.storage.local.set({ settings: nextSettings });
  settings = nextSettings;
  $("saved").textContent = "已保存";
  setTimeout(() => $("saved").textContent = "", 1800);
});

init();
