
(() => {
  let busy = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const status = message => chrome.runtime.sendMessage({type:"SRT_GEMINI_PROGRESS",message});
  function findEditor() {
    return document.querySelector('rich-textarea [contenteditable="true"]') ||
      document.querySelector('[contenteditable="true"][role="textbox"]') ||
      document.querySelector('textarea');
  }
  function findSendButton() {
    const buttons = [...document.querySelectorAll("button")];
    return buttons.find(b => /send|kirim/i.test((b.getAttribute("aria-label")||"") + " " + (b.getAttribute("data-tooltip")||"")) && !b.disabled)
      || document.querySelector('button[aria-label*="Send"],button[aria-label*="Kirim"]');
  }
  function readLastAnswer() {
    const nodes = [...document.querySelectorAll("model-response")];
    if (nodes.length) return (nodes[nodes.length-1].innerText || "").trim();
    const candidates = [...document.querySelectorAll("message-content,.model-response-text,.response-container")];
    return candidates.length ? (candidates[candidates.length-1].innerText || "").trim() : "";
  }
  async function waitForAnswer(previous, timeoutMs=240000) {
    const start = Date.now();
    let stable = 0, last = "";
    while (Date.now()-start < timeoutMs) {
      await sleep(900);
      const text = readLastAnswer();
      const stopVisible = [...document.querySelectorAll("button")].some(b => /stop|berhenti/i.test((b.getAttribute("aria-label")||"") + " " + (b.getAttribute("data-tooltip")||"")));
      if (text && text !== previous && !stopVisible) {
        if (text === last) stable++; else stable = 0;
        last = text;
        if (stable >= 2) return text;
      }
    }
    throw new Error("Waktu tunggu jawaban Gemini habis. Periksa apakah Gemini masih memproses atau meminta login/konfirmasi.");
  }
  async function run(task) {
    if (busy) throw new Error("Ekstensi masih memproses tugas sebelumnya.");
    if (!task || !Array.isArray(task.items) || !task.items.length) throw new Error("Data tugas kosong atau tidak valid.");
    busy = true;
    try {
      status("Menyiapkan prompt dan JSON…");
      const previous = readLastAnswer();
      const editor = findEditor();
      if (!editor) throw new Error("Kolom pesan Gemini tidak ditemukan. Pastikan halaman Gemini selesai dimuat.");
      const prompt = task.prompt + "\n\nDATA JSON (" + task.items.length + " dialog):\n" + JSON.stringify(task.items,null,2);
      editor.focus();
      if (editor.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set;
        setter.call(editor,prompt);
        editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:prompt}));
      } else {
        editor.textContent = prompt;
        editor.dispatchEvent(new InputEvent("input",{bubbles:true,inputType:"insertText",data:prompt}));
      }
      await sleep(700);
      const send = findSendButton();
      if (!send) throw new Error("Tombol Kirim Gemini tidak ditemukan. Periksa kolom pesan.");
      send.click();
      status("Prompt terkirim. Menunggu jawaban Gemini…");
      const result = await waitForAnswer(previous);
      chrome.runtime.sendMessage({type:"SRT_GEMINI_FINISHED",result});
    } catch (error) {
      chrome.runtime.sendMessage({type:"SRT_GEMINI_FINISHED",error:error.message || String(error)});
    } finally {
      busy = false;
    }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "SRT_GEMINI_RUN") run(message.task);
  });
})();
