import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [optionsHtml, popupHtml, popupJs, reminderJs, backgroundJs] = await Promise.all([
  readFile(new URL("../options.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.html", import.meta.url), "utf8"),
  readFile(new URL("../popup.js", import.meta.url), "utf8"),
  readFile(new URL("../reminder.js", import.meta.url), "utf8"),
  readFile(new URL("../background.js", import.meta.url), "utf8")
]);

for (const id of ["soundEnabled", "systemNotificationEnabled", "popupEnabled"]) {
  assert.ok(optionsHtml.includes(`id="${id}"`), `设置页应提供 ${id} 开关`);
}

assert.ok(popupHtml.includes('id="pause"'), "主界面应提供全局暂停按钮");
assert.ok(popupHtml.includes('id="stopSound"'), "主界面应提供停止当前声音按钮");
assert.ok(popupJs.includes('type: "togglePause"'), "暂停按钮应调用暂停接口");
assert.ok(popupJs.includes('type: "stopReminderSound"'), "停止声音按钮应调用停止接口");
assert.ok(reminderJs.includes('type: "dismissReminder"'), "确认提醒应请求后台关闭整个窗口");
assert.ok(backgroundJs.includes('state.mode === "paused"'), "后台应持久化处理暂停状态");
assert.ok(backgroundJs.includes('break-bell-work-deadline'), "后台应创建独立的工作截止闹钟");
assert.ok(backgroundJs.includes('soundStatus'), "后台应提供当前声音状态");

console.log("reminder controls tests passed");
