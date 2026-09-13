import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const optionsHtml = await readFile(new URL("../options.html", import.meta.url), "utf8");
const optionsJs = await readFile(new URL("../options.js", import.meta.url), "utf8");
const backgroundJs = await readFile(new URL("../background.js", import.meta.url), "utf8");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");

assert.ok(optionsHtml.includes('id="audioOutput"'), "设置页应提供铃声输出设备选择器");
assert.ok(optionsHtml.includes('id="refreshAudioOutputs"'), "设置页应提供设备授权和刷新入口");
assert.ok(optionsHtml.includes("只改变本插件的铃声"), "设置页应说明不会改变浏览器其他音频的输出");
assert.ok(optionsHtml.includes("不录音，也不上传音频"), "设置页应说明麦克风权限用途");
assert.ok(optionsJs.includes("navigator.mediaDevices.getUserMedia({ audio: true })"), "授权按钮应请求完整音频设备列表所需的权限");
assert.ok(optionsJs.includes("stream.getTracks().forEach(track => track.stop())"), "取得权限后应立即关闭麦克风输入");
assert.ok(optionsJs.includes("audioOutputDeviceId"), "设置页应持久化所选输出设备");
assert.ok(backgroundJs.includes("audioOutputDeviceId: settings.audioOutputDeviceId"), "后台应把输出设备传给离屏播放器");
assert.ok(readme.includes("不影响浏览器中音乐、视频的默认输出"), "README 应说明独立音频路由能力");

console.log("audio output settings tests passed");
