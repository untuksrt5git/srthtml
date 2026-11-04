
async function findGeminiTab() {
  const tabs = await chrome.tabs.query({url:"https://gemini.google.com/*"});
  return tabs.find(t => t.active) || tabs[0] || null;
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== "SRT_AUTOMATION_START") return;
  (async () => {
    const tab = await findGeminiTab();
    if (!tab || !tab.id) throw new Error("Tab Gemini tidak ditemukan. Buka Gemini dan login terlebih dahulu.");
    await chrome.tabs.sendMessage(tab.id,{type:"SRT_GEMINI_RUN",task:message.task});
    sendResponse({ok:true});
  })().catch(error => sendResponse({error:error.message || String(error)}));
  return true;
});
chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "SRT_GEMINI_FINISHED") return;
  chrome.tabs.query({url:"https://untuksrt5git.github.io/srthtml/*"}).then(tabs => {
    const appTab = tabs.find(t => t.active) || tabs[0];
    if (appTab?.id) chrome.tabs.sendMessage(appTab.id,{type:"SRT_AUTOMATION_RESULT",result:message.result,error:message.error});
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || message.type !== "SRT_GEMINI_PROGRESS") return;
  chrome.tabs.query({url:"https://untuksrt5git.github.io/srthtml/*"}).then(tabs => {
    const appTab = tabs.find(t => t.active) || tabs[0];
    if (appTab?.id) chrome.tabs.sendMessage(appTab.id,{type:"SRT_AUTOMATION_STATUS",message:message.message});
  });
});
