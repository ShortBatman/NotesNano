import { deviceStatus, prepareDevice, summarize, makeQuiz, chunkText } from "./ai.js";
import { readFile } from "./files.js";

const $ = (id) => document.getElementById(id);
const notes = $("notes");
const statusLine = $("status");
const engine = $("engine");
const summaryBtn = $("summaryBtn");
const quizBtn = $("quizBtn");

let cache = { text: null, summary: null };
let busy = false;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const mode = () => document.querySelector('input[name="mode"]:checked').value;

async function refreshDevice() {
  const status = await deviceStatus();
  const dot = $("deviceDot");
  const text = $("deviceText");
  const btn = $("downloadBtn");
  btn.hidden = true;
  dot.className = "dot";
  if (status === "available") {
    dot.classList.add("on");
    text.textContent = "Gemini Nano ready on this laptop";
  } else if (status === "downloadable") {
    dot.classList.add("warn");
    text.textContent = "Gemini Nano not downloaded yet";
    btn.hidden = false;
  } else if (status === "downloading") {
    dot.classList.add("warn");
    text.textContent = "Gemini Nano downloading…";
    setTimeout(refreshDevice, 4000);
  } else {
    dot.classList.add("off");
    text.textContent = status === "missing" ? "No on-device AI in this browser · cloud only" : "This laptop can't run Gemini Nano · cloud only";
  }
  return status;
}

$("downloadBtn").addEventListener("click", async () => {
  $("downloadBtn").hidden = true;
  $("deviceText").textContent = "Starting download…";
  try {
    await prepareDevice("private", (p) => {
      $("deviceText").textContent = `Downloading Gemini Nano… ${Math.round(p * 100)}%`;
    });
  } catch (error) {
    console.error(error);
  }
  refreshDevice();
});

function countWords() {
  const words = notes.value.trim() ? notes.value.trim().split(/\s+/).length : 0;
  const parts = words ? chunkText(notes.value).length : 0;
  $("notesMeta").textContent = `${words.toLocaleString()} words${parts > 1 ? ` · read in ${parts} parts` : ""}`;
}
notes.addEventListener("input", countWords);

$("fileInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  setStatus(`Opening ${file.name}…`);
  try {
    const { text, pages } = await readFile(file, setStatus);
    if (!text.trim()) {
      setStatus("Couldn't find any text in this file. Scanned PDFs (photos of pages) don't work yet.", true);
      return;
    }
    notes.value = text;
    countWords();
    setStatus(`Loaded ${file.name}${pages ? ` (${pages} pages)` : ""}. The file stays on your laptop.`);
  } catch (error) {
    console.error(error);
    setStatus("Couldn't read that file.", true);
  }
  event.target.value = "";
});

document.querySelectorAll(".tab").forEach((tab) =>
  tab.addEventListener("click", () => showTab(tab.dataset.tab))
);

function showTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  $("summaryView").hidden = name !== "summary";
  $("quizView").hidden = name !== "quiz";
}

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.classList.toggle("error", isError);
}

function setBusy(value) {
  busy = value;
  summaryBtn.disabled = value;
  quizBtn.disabled = value;
  document.body.classList.toggle("working", value);
}

function showEngine(runs, chosen) {
  const local = runs.filter((r) => r.source === "on_device").length;
  const cloud = runs.length - local;
  const fell = runs.filter((r) => r.fallback).length;
  const seconds = (runs.reduce((a, r) => a + r.ms, 0) / 1000).toFixed(1);
  let label;
  let cls;
  if (cloud === 0) {
    label = "Ran on your laptop · nothing left this device";
    cls = "local";
  } else if (local === 0) {
    label = chosen === "cloud" ? "Ran in the cloud (you picked Cloud)" : "Ran in the cloud · Gemini Nano wasn't available here";
    cls = "cloud";
  } else {
    label = `Hybrid · ${local} step${local > 1 ? "s" : ""} on your laptop, ${cloud} in the cloud`;
    cls = "mixed";
  }
  if (fell) label += ` · ${fell} step${fell > 1 ? "s" : ""} moved to the cloud after the laptop model struggled`;
  engine.className = "engine " + cls;
  engine.innerHTML = `<b>${esc(label)}</b><span>${runs.length} AI call${runs.length > 1 ? "s" : ""} · ${seconds}s</span>`;
  engine.hidden = false;
}

async function canRun(chosen) {
  const text = notes.value.trim();
  if (text.split(/\s+/).length < 30) {
    setStatus("Add a bit more text first (at least a few sentences).", true);
    return false;
  }
  if (chosen === "private") {
    const status = await deviceStatus();
    if (status === "missing" || status === "unavailable") {
      setStatus("Private mode needs Gemini Nano in desktop Chrome. Switch to Auto or Cloud.", true);
      return false;
    }
  } else if (!navigator.onLine && chosen === "cloud") {
    setStatus("You're offline. Switch to Private to keep working on your laptop.", true);
    return false;
  }
  return true;
}

async function getSummary(chosen) {
  const text = notes.value.trim();
  if (cache.text === text && cache.summary && cache.mode === chosen) return { summary: cache.summary, runs: [] };
  const result = await summarize(text, chosen, setStatus);
  cache = { text, summary: result.summary, mode: chosen };
  renderSummary(result.summary);
  return result;
}

function renderSummary(summary) {
  const terms = (summary.terms || []).filter((t) => t.term);
  $("summaryView").innerHTML = `
    <h3>${esc(summary.title)}</h3>
    <ul class="points">${summary.keyPoints.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>
    ${terms.length ? `<h4>Key terms</h4><dl class="terms">${terms.map((t) => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join("")}</dl>` : ""}
    <button class="ghost small" id="copyBtn">Copy summary</button>`;
  $("copyBtn").addEventListener("click", () => {
    const plain = summary.title + "\n\n" + summary.keyPoints.map((k) => "• " + k).join("\n") +
      (terms.length ? "\n\nKey terms\n" + terms.map((t) => `${t.term}: ${t.meaning}`).join("\n") : "");
    navigator.clipboard.writeText(plain);
    $("copyBtn").textContent = "Copied";
  });
}

function renderQuiz(questions) {
  if (!questions.length) {
    $("quizView").innerHTML = `<div class="empty">The model didn't return usable questions. Try again.</div>`;
    return;
  }
  let answered = 0;
  let score = 0;
  $("quizView").innerHTML =
    questions.map((q, i) => `
      <div class="question" data-i="${i}">
        <p><b>${i + 1}.</b> ${esc(q.question)}</p>
        <div class="options">${q.options.map((o, j) => `<button class="option" data-j="${j}">${esc(o)}</button>`).join("")}</div>
        <p class="explain" hidden></p>
      </div>`).join("") +
    `<div class="score" id="score">0 / ${questions.length} answered</div>`;
  $("quizView").querySelectorAll(".question").forEach((block) => {
    const q = questions[block.dataset.i];
    block.querySelectorAll(".option").forEach((btn) =>
      btn.addEventListener("click", () => {
        if (block.classList.contains("done")) return;
        block.classList.add("done");
        const picked = Number(btn.dataset.j);
        block.querySelectorAll(".option")[q.answer].classList.add("right");
        if (picked === q.answer) score++;
        else btn.classList.add("wrong");
        const explain = block.querySelector(".explain");
        explain.textContent = (picked === q.answer ? "Correct. " : "Not quite. ") + (q.explanation || "");
        explain.hidden = false;
        answered++;
        $("score").textContent = answered === questions.length ? `Score: ${score} / ${questions.length}` : `${answered} / ${questions.length} answered`;
      })
    );
  });
}

summaryBtn.addEventListener("click", async () => {
  if (busy) return;
  const chosen = mode();
  if (!(await canRun(chosen))) return;
  setBusy(true);
  showTab("summary");
  try {
    await prepareDevice(chosen);
    cache = { text: null, summary: null };
    const { runs } = await getSummary(chosen);
    showEngine(runs, chosen);
    setStatus("Done.");
  } catch (error) {
    console.error(error);
    setStatus(friendlyError(error), true);
  } finally {
    setBusy(false);
    refreshDevice();
  }
});

quizBtn.addEventListener("click", async () => {
  if (busy) return;
  const chosen = mode();
  if (!(await canRun(chosen))) return;
  setBusy(true);
  showTab("quiz");
  try {
    await prepareDevice(chosen);
    const first = await getSummary(chosen);
    const quiz = await makeQuiz(first.summary, chosen, setStatus);
    renderQuiz(quiz.questions);
    showEngine([...first.runs, ...quiz.runs], chosen);
    setStatus("Done. Tap an option to answer.");
  } catch (error) {
    console.error(error);
    setStatus(friendlyError(error), true);
  } finally {
    setBusy(false);
    refreshDevice();
  }
});

function friendlyError(error) {
  const msg = String(error?.message || error);
  if (/free tier is not available|denied access|billing/i.test(msg)) return "Cloud fallback is unavailable right now (Gemini free tier is restricted for this project). Use Private mode in Chrome with Gemini Nano.";
  if (/app.?check|attestation/i.test(msg)) return "The cloud model refused the request (App Check). See the README to register a debug token.";
  if (/quota|429/i.test(msg)) return "Cloud quota hit. Wait a minute, or use Private mode.";
  if (/ONLY_ON_DEVICE|not available/i.test(msg)) return "Gemini Nano isn't ready on this laptop yet. Download it, or switch to Auto.";
  if (/fetch|network|offline/i.test(msg)) return "Couldn't reach the cloud. Check your internet, or switch to Private.";
  if (/JSON/i.test(msg)) return "The model's answer came back garbled. Try again.";
  return "Something went wrong: " + msg;
}

window.addEventListener("online", () => setStatus("Back online."));
window.addEventListener("offline", () => setStatus("You're offline. Private mode still works on this laptop."));

countWords();
refreshDevice();
