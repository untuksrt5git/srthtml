(() => {
  // Hindari memasang listener ganda jika skrip pernah diinjeksi sebelumnya.
  if (window.__SRT_GEMINI_BRIDGE_READY__) return;
  window.__SRT_GEMINI_BRIDGE_READY__ = true;

  let busy = false;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const status = (message,returnTabId) => chrome.runtime.sendMessage({type:"SRT_GEMINI_PROGRESS",message,returnTabId});

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
    // Gabungkan semua selector: jangan berhenti pada selector pertama,
    // karena DOM Gemini dapat menyimpan node jawaban lama/bersarang.
    const selectors = [
      "model-response",
      "message-content",
      "[data-test-id*='model-response']",
      ".model-response-text",
      ".response-container",
      ".markdown-main-panel",
      "structured-content"
    ];
    const found = new Set();
    for (const selector of selectors) {
      document.querySelectorAll(selector).forEach(node => found.add(node));
    }
    const candidates = [...found].map(node => ({
      node,
      text: (node.innerText || node.textContent || "").trim()
    })).filter(item =>
      item.text.length > 0 &&
      !item.node.hidden &&
      item.node.getAttribute("aria-hidden") !== "true" &&
      item.node.getClientRects().length > 0
    );
    if (!candidates.length) return "";

    // Ambil node paling akhir dalam urutan DOM, bukan node dari
    // selector dengan prioritas tertinggi yang mungkin berisi jawaban lama.
    candidates.sort((a, b) => {
      if (a.node === b.node) return 0;
      return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });
    return candidates[candidates.length - 1].text;
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

  function extractCompleteJsonArray(text) {
    if (!text) return "";
    // Cari array JSON lengkap walaupun Gemini menambahkan pagar kode
    // atau kalimat pengantar. Hitung kurung sambil mengabaikan isi string.
    const start = text.indexOf("[");
    if (start < 0) return "";
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            const parsed = JSON.parse(candidate);
            return Array.isArray(parsed) && parsed.length ? candidate : "";
          } catch (_) {
            return "";
          }
        }
      }
    }
    return "";
  }

  function looksLikeCompleteJsonArray(text) {
    return !!extractCompleteJsonArray(text);
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
        // Terima jawaban yang stabil setelah tombol stop hilang.
        // Jika isi sudah berupa JSON array lengkap dan valid, jangan tertahan
        // hanya karena indikator/tombol Gemini salah terbaca masih generating.
        if (stable >= 3 && (!generating || looksLikeCompleteJsonArray(text))) {
          const jsonArray = extractCompleteJsonArray(text);
          return jsonArray || text;
        }
      }
    }
    const latest = readLastAnswer();
    if (latest && latest !== previous) {
      const jsonArray = extractCompleteJsonArray(latest);
      if (jsonArray) return jsonArray;
      if (!isGenerating()) return latest;
    }
    throw new Error("Waktu tunggu jawaban Gemini habis. Jawaban belum berhasil dibaca otomatis; periksa tab Gemini.");
  }

  async function run(task) {
    if (busy) throw new Error("Ekstensi masih memproses tugas sebelumnya.");
    if (!task || !Array.isArray(task.items) || !task.items.length) throw new Error("Data tugas kosong atau tidak valid.");
    busy = true;
    try {
      status("Menyiapkan prompt dan JSON…",task.returnTabId);
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
      status("Prompt terkirim. Menunggu jawaban Gemini…",task.returnTabId);
      const result = await waitForAnswer(previous);
      chrome.runtime.sendMessage({type:"SRT_GEMINI_FINISHED",result,returnTabId:task.returnTabId});
    } catch (error) {
      chrome.runtime.sendMessage({type:"SRT_GEMINI_FINISHED",error:error.message || String(error),returnTabId:task?.returnTabId});
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === "SRT_GEMINI_RUN") run(message.task);
  });
})();