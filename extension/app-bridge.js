
(() => {
  const APP_ORIGIN = "https://untuksrt5git.github.io";
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== APP_ORIGIN) return;
    const data = event.data;
    if (!data || data.source !== "srt-batch-app" || data.type !== "SRT_GEMINI_SEND") return;
    chrome.runtime.sendMessage({type:"SRT_AUTOMATION_START",task:data.task}, (response) => {
      if (chrome.runtime.lastError) {
        window.postMessage({source:"srt-gemini-extension",type:"SRT_AUTO_ACK",ok:false,error:chrome.runtime.lastError.message}, APP_ORIGIN);
        return;
      }
      if (response && response.error) {
        window.postMessage({source:"srt-gemini-extension",type:"SRT_AUTO_ACK",ok:false,error:response.error}, APP_ORIGIN);
      } else {
        window.postMessage({source:"srt-gemini-extension",type:"SRT_AUTO_ACK",ok:true}, APP_ORIGIN);
      }
    });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === "SRT_AUTOMATION_RESULT") {
      window.postMessage({source:"srt-gemini-extension",type:"SRT_AUTO_RESULT",result:message.result,error:message.error}, APP_ORIGIN);
    } else if (message.type === "SRT_AUTOMATION_STATUS") {
      window.postMessage({source:"srt-gemini-extension",type:"SRT_AUTO_STATUS",message:message.message}, APP_ORIGIN);
    }
  });
})();
