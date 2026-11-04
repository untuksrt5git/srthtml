async function findGeminiTab() {
  const tabs = await chrome.tabs.query({url:"https://gemini.google.com/*"});
  return tabs.find(t => t.active) || tabs[0] || null;
}

async function sendToGeminiTab(tabId, task) {
  try {
    await chrome.tabs.sendMessage(tabId, {type:"SRT_GEMINI_RUN",task});
    return;
  } catch (firstError) {
    // The Gemini content script may not have been injected into an already-open tab.
    if (!chrome.scripting || !chrome.scripting.executeScript) {
      throw new Error("Skrip penerima Gemini belum aktif dan browser tidak menyediakan API untuk memuatnya otomatis. Tutup tab Gemini, buka ulang, lalu coba lagi. Detail: " + (firstError.message || String(firstError)));
    }
    try {
      await chrome.scripting.executeScript({
        target: {tabId},
        files: ["gemini-bridge.js"]
      });
      await chrome.tabs.sendMessage(tabId, {type:"SRT_GEMINI_RUN",task});
    } catch (retryError) {
      throw new Error("Skrip Gemini tidak dapat dimuat atau tidak merespons. Pastikan tab Gemini sudah selesai dimuat dan extension memiliki izin untuk gemini.google.com. Detail: " + (retryError.message || String(retryError)));
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SRT_AUTOMATION_START") return;
  (async () => {
    const tab = await findGeminiTab();
    if (!tab || !tab.id) throw new Error("Tab Gemini tidak ditemukan. Buka Gemini dan login terlebih dahulu.");
    await sendToGeminiTab(tab.id, message.task);
    sendResponse({ok:true});
  })().catch(error => sendResponse({error:error.message || String(error)}));
  return true;
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SRT_GEMINI_FINISHED") return;
  chrome.tabs.query({url:"https://untuksrt5git.github.io/srthtml/*"}).then(tabs => {
    const appTab = tabs.find(t => t.active) || tabs[0];
    if (appTab?.id) chrome.tabs.sendMessage(appTab.id,{type:"SRT_AUTOMATION_RESULT",result:message.result,error:message.error}).catch(()=>{});
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SRT_GEMINI_PROGRESS") return;
  chrome.tabs.query({url:"https://untuksrt5git.github.io/srthtml/*"}).then(tabs => {
    const appTab = tabs.find(t => t.active) || tabs[0];
    if (appTab?.id) chrome.tabs.sendMessage(appTab.id,{type:"SRT_AUTOMATION_STATUS",message:message.message}).catch(()=>{});
  });
});
