import { getGenerativeModel, InferenceMode, Schema } from "firebase/ai";
import { ai } from "./firebase.js";

const CLOUD_MODEL = "gemini-3.5-flash-lite";
const CHUNK_CHARS = 9000;

const MODES = {
  auto: InferenceMode.PREFER_ON_DEVICE,
  private: InferenceMode.ONLY_ON_DEVICE,
  cloud: InferenceMode.ONLY_IN_CLOUD,
};

const SYSTEM = "You are a study assistant for university students. You only use facts from the notes you are given. You write short, clear, simple English.";

const summarySchema = Schema.object({
  properties: {
    title: Schema.string(),
    keyPoints: Schema.array({ items: Schema.string() }),
    terms: Schema.array({
      items: Schema.object({
        properties: { term: Schema.string(), meaning: Schema.string() },
      }),
    }),
  },
});

const quizSchema = Schema.object({
  properties: {
    questions: Schema.array({
      items: Schema.object({
        properties: {
          question: Schema.string(),
          options: Schema.array({ items: Schema.string() }),
          answer: Schema.integer(),
          explanation: Schema.string(),
        },
      }),
    }),
  },
});

const summaryJson = {
  type: "object",
  properties: {
    title: { type: "string" },
    keyPoints: { type: "array", items: { type: "string" } },
    terms: {
      type: "array",
      items: {
        type: "object",
        properties: { term: { type: "string" }, meaning: { type: "string" } },
        required: ["term", "meaning"],
      },
    },
  },
  required: ["title", "keyPoints", "terms"],
};

const quizJson = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" } },
          answer: { type: "integer" },
          explanation: { type: "string" },
        },
        required: ["question", "options", "answer", "explanation"],
      },
    },
  },
  required: ["questions"],
};

const models = new Map();

function modelFor(mode, schema) {
  const key = mode + ":" + (schema === quizSchema ? "quiz" : "summary");
  if (models.has(key)) return models.get(key);
  const model = getGenerativeModel(ai, {
    mode: MODES[mode],
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: SYSTEM,
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: [{ type: "text", value: SYSTEM }] }],
      },
      promptOptions: { responseConstraint: schema === quizSchema ? quizJson : summaryJson },
    },
  });
  models.set(key, model);
  return model;
}

export async function deviceStatus() {
  if (!("LanguageModel" in self)) return "missing";
  try {
    return await self.LanguageModel.availability({
      expectedInputs: [{ type: "text", languages: ["en"] }],
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
  } catch {
    return "unavailable";
  }
}

export async function prepareDevice(mode, onProgress) {
  if (mode === "cloud") return;
  const status = await deviceStatus();
  if (status === "missing" || status === "unavailable") return;
  const work = modelFor(mode, summarySchema).initializeDeviceModel(onProgress);
  modelFor(mode, quizSchema).initializeDeviceModel();
  if (mode === "private") await work;
}

export function chunkText(text) {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  const chunks = [];
  let rest = clean;
  while (rest.length > CHUNK_CHARS) {
    let cut = rest.lastIndexOf("\n\n", CHUNK_CHARS);
    if (cut < CHUNK_CHARS * 0.5) cut = rest.lastIndexOf(". ", CHUNK_CHARS) + 1;
    if (cut < CHUNK_CHARS * 0.5) cut = CHUNK_CHARS;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

async function ask(mode, schema, prompt) {
  const started = performance.now();
  try {
    const result = await modelFor(mode, schema).generateContent(prompt);
    return {
      data: JSON.parse(result.response.text()),
      source: result.response.inferenceSource || (mode === "cloud" ? "in_cloud" : "on_device"),
      ms: performance.now() - started,
    };
  } catch (error) {
    if (mode !== "auto" || /Error fetching from/.test(String(error?.message))) throw error;
    console.warn("On-device attempt failed, retrying in the cloud", error);
    const run = await ask("cloud", schema, prompt);
    return { ...run, fallback: true, ms: performance.now() - started };
  }
}

export async function summarize(text, mode, onStep) {
  const chunks = chunkText(text);
  const runs = [];
  const parts = [];
  for (let i = 0; i < chunks.length; i++) {
    onStep(`Reading part ${i + 1} of ${chunks.length}…`);
    const prompt =
      "Summarize these lecture notes for exam revision.\n" +
      "Give a short title, 4 to 7 key points (one sentence each) and up to 5 important terms with a one-line meaning.\n\n" +
      "NOTES:\n" + chunks[i];
    const run = await ask(mode, summarySchema, prompt);
    runs.push(run);
    parts.push(run.data);
  }
  if (parts.length === 1) return { summary: parts[0], runs };
  onStep("Combining parts…");
  const merged = parts.map((p, i) => `Part ${i + 1}: ${p.title}\n` + p.keyPoints.map((k) => "- " + k).join("\n")).join("\n\n");
  const terms = parts.flatMap((p) => p.terms || []);
  const prompt =
    "These are key points from different parts of one lecture.\n" +
    "Merge them into one revision summary: a title for the whole lecture and the 6 to 10 most important key points, no repeats.\n" +
    "Also pick up to 8 of the most important terms.\n\n" + merged +
    "\n\nTERMS:\n" + terms.map((t) => `${t.term}: ${t.meaning}`).join("\n");
  const run = await ask(mode, summarySchema, prompt);
  runs.push(run);
  return { summary: run.data, runs };
}

export async function makeQuiz(summary, mode, onStep) {
  onStep("Writing questions…");
  const notes =
    summary.title + "\n" + summary.keyPoints.map((k) => "- " + k).join("\n") +
    "\n" + (summary.terms || []).map((t) => `${t.term}: ${t.meaning}`).join("\n");
  const prompt =
    "Write 5 multiple choice questions to test a student on these notes.\n" +
    "Each question has exactly 4 options, one correct. 'answer' is the index (0 to 3) of the correct option.\n" +
    "Wrong options must be believable. Add a one-sentence explanation of the right answer.\n\n" +
    "NOTES:\n" + notes;
  const run = await ask(mode, quizSchema, prompt);
  const questions = (run.data.questions || [])
    .filter((q) => q.question && Array.isArray(q.options) && q.options.length >= 2)
    .map((q) => ({ ...q, answer: Math.min(Math.max(q.answer | 0, 0), q.options.length - 1) }));
  return { questions, runs: [run] };
}
