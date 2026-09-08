const params = new URLSearchParams(location.search);
const title = params.get("title") || "休息提醒";
const message = params.get("message") || "请起身活动一下。";
const kind = params.get("kind") || "reminder";
const durationMinutes = Math.max(0, Number(params.get("durationMinutes")) || 0);
const icons = { break: "🚶", work: "⏱️", outside: "🌙", test: "🔔", reminder: "🔔" };

document.title = title;
document.getElementById("reminderTitle").textContent = title;
document.getElementById("reminderMessage").textContent = message;
document.getElementById("reminderIcon").textContent = icons[kind] || icons.reminder;
document.getElementById("reminderKicker").textContent = kind === "break" ? "休息倒计时已开始" : "休息提醒";
document.getElementById("acknowledge").addEventListener("click", async () => {
  try { await chrome.runtime.sendMessage({ type: "stopReminderSound" }); }
  finally { window.close(); }
});

if (durationMinutes > 0) {
  const countdown = document.getElementById("reminderCountdown");
  const endsAt = Date.now() + durationMinutes * 60 * 1000;
  let timer;
  countdown.hidden = false;
  const update = () => {
    const seconds = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    countdown.textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
    if (seconds === 0) clearInterval(timer);
  };
  update();
  timer = setInterval(update, 1000);
}
