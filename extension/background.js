const APP_URL_MATCH = "https://untuksrt5git.github.io/srthtml/*";
const REQUEST_TAB_STORAGE_KEY = "srtLastRequestingAppTabId";
let lastRequestingAppTabId = null;

async function rememberRequestingAppTab(tabId) {
  if (!Number.isInteger(tabId)) return;
  lastRequestingAppTabId = tabId;
  try {
    await chrome.storage.session.set({[REQUEST_TAB_STORAGE_KEY]: tabId});
  } catch (_) {
    // The in-memory value remains available if session storage is unavailable.
  }
}

async function getRequestingAppTabId(message) {
  if (Number.isInteger(message?.returnTabId)) return message.returnTabId;
  if (Number.isInteger(lastRequestingAppTabId)) return lastRequestingAppTabId;
  try {
    const stored = await chrome.storage.session.get(REQUEST_TAB_STORAGE_KEY);
    if (Number.isInteger(stored?.[REQUEST_TAB_STORAGE_KEY])) {
      lastRequestingAppTabId = stored[REQUEST_TAB_STORAGE_KEY];
      return lastRequestingAppTabId;
    }
  } catch (_) {
    // Fall through to a safe single-app fallback below.
  }
  return null;
}

async function findGeminiTab() {
  const tabs = await chrome.tabs.query({url:"https://gemini.google.com/*"});
  return tabs.find(t => t.active) || tabs[0] || null;
}

async function sendToGeminiTab(tabId, task, returnTabId) {
  const routedTask = {...task, returnTabId};
  try {
    await chrome.tabs.sendMessage(tabId, {type:"SRT_GEMINI_RUN",task:routedTask});
    return;
  } catch (firstError) {
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      throw new Error("Skrip penerima Gemini belum aktif dan browser tidak menyediakan API untuk memuatnya otomatis. Tutup tab Gemini, buka ulang, lalu coba lagi. Detail: " + (firstError.message || String(firstError)));
    }
    try {
      await chrome.scripting.executeScript({target:{tabId},files:["gemini-bridge.js"]});
      await chrome.tabs.sendMessage(tabId, {type:"SRT_GEMINI_RUN",task:routedTask});
    } catch (retryError) {
      throw new Error("Skrip Gemini tidak dapat dimuat atau tidak merespons. Pastikan tab Gemini sudah selesai dimuat dan extension memiliki izin untuk gemini.google.com. Detail: " + (retryError.message || String(retryError)));
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SRT_AUTOMATION_START") return;
  (async () => {
    const returnTabId = sender?.tab?.id;
    await rememberRequestingAppTab(returnTabId);
    const tab = await findGeminiTab();
    if (!tab || !tab.id) throw new Error("Tab Gemini tidak ditemukan. Buka Gemini dan login terlebih dahulu.");
    await sendToGeminiTab(tab.id, message.task, returnTabId);
    sendResponse({ok:true});
  })().catch(error => sendResponse({error:error.message || String(error)}));
  return true;
});

async function deliverToAppTab(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
    return true;
  } catch (firstError) {
    // After an extension reload, an already-open app tab may no longer have
    // its content script listener. Re-inject it and retry before dropping data.
    if (!chrome.scripting || !chrome.scripting.executeScript) return false;
    try {
      await chrome.scripting.executeScript({target:{tabId},files:["app-bridge.js"]});
      await chrome.tabs.sendMessage(tabId, payload);
      return true;
    } catch (retryError) {
      console.warn("Could not deliver Gemini response to SRT app tab", tabId, retryError);
      return false;
    }
  }
}

async function forwardToRequestingApp(message, appMessage) {
  let tabId = await getRequestingAppTabId(message);
  if (Number.isInteger(tabId) && await deliverToAppTab(tabId, appMessage)) return;

  // Compatibility fallback for older bridge scripts. Prefer the last app tab
  // remembered for this browser session; do not silently pick an unrelated tab.
  const tabs = await chrome.tabs.query({url:APP_URL_MATCH});
  if (tabs.length === 1 && Number.isInteger(tabs[0].id)) {
    await deliverToAppTab(tabs[0].id, appMessage);
  } else {
    console.warn("Gemini reply could not be routed: requesting SRT page is unknown.");
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SRT_GEMINI_FINISHED") return;
  forwardToRequestingApp(message, {type:"SRT_AUTOMATION_RESULT",result:message.result,error:message.error});
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SRT_GEMINI_PROGRESS") return;
  forwardToRequestingApp(message, {type:"SRT_AUTOMATION_STATUS",message:message.message});
});
