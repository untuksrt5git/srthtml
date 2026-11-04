(() => {
  // Hindari memasang listener ganda jika skrip pernah diinjeksi sebelumnya.
  if (window.__SRT_GEMINI_BRIDGE_READY__) return;
  window.__SRT_GEMINI_BRIDGE_READY__ = true;

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
    return buttons.find(b =>
      /send|kirim/i.test((b.getAttribute("aria-label")||"") + " " + (b.getAttribute("data-tooltip")||"")) && !b.disabled
    ) || document.querySelector('button[aria-label*="Send"],button[aria-label*="Kirim"]');
  }

  function readLastAnswer() {
    // Selector utama Gemini, lalu beberapa variasi DOM sebagai fallback.
    const selectors = [
      "model-response",
      "message-content",
      "[data-test-id*='model-response']",
      ".model-response-text",
      ".response-container",
      ".markdown-main-panel",
      "structured-content"
    ];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(node => {
        const text = (node.innerText || node.textContent || "").trim();
        return text.length > 0;
      });
      if (nodes.length) {
        const text = (nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || "").trim();
        if (text) return text;
      }
    }
    return "";
  }

  function isActuallyVisible(element) {
    if (!element || element.hidden || element.getAttribute("aria-hidden") === "true") return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    return element.getClientRects().length > 0;
  }

  function isGenerating() {
    return [...document.querySelectorAll("button")].some(button => {
      if (!isActuallyVisible(button)) return false;
      const label = [
        button.getAttribute("aria-label") || "",
        button.getAttribute("data-tooltip") || "",
        button.getAttribute("title") || "",
        button.innerText || ""
      ].join(" ");
      // Jangan gunakan kata "stop" secara umum: tombol audio/fitur lain
      // bisa tetap ada setelah jawaban selesai dan membuat antrean menunggu selamanya.
      return /(stop generating|stop response|stop generation|berhenti membuat|hentikan pembuatan|hentikan respons|menghentikan respons)/i.test(label);
    });
  }

  async function waitForAnswer(previous, timeoutMs=240000) {
    const start = Date.now();
    let stable = 0, last = "";
    while (Date.now()-start < timeoutMs) {
      await sleep(900);
      const text = readLastAnswer();
      const generating = isGenerating();

      if (text && text !== previous) {
        if (text === last) stable++; else stable = 0;
        last = text;
        // Pastikan jawaban baru stabil dan Gemini tidak lagi menghasilkan teks.
        if (stable >= 3 && !generating) return text;
      }
    }
    const latest = readLastAnswer();
    if (latest && latest !== previous && !isGenerating()) return latest;
    throw new Error("Waktu tunggu jawaban Gemini habis. Jawaban belum berhasil dibaca otomatis; periksa tab Gemini.");
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