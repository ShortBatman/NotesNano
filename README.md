# NotesNano

Turn lecture slides and notes into a revision summary and a quiz. NotesNano runs the AI **on your laptop with Gemini Nano** when it can, and falls back to **Gemini in the cloud** when it can't. It's built with the Firebase AI Logic hybrid inference SDK.

Built for university students who revise from long slide decks the night before an exam, often on patchy internet.

## What it does

- **Open a PDF or paste notes.** PDFs are read in the browser with pdf.js, so the file never gets uploaded.
- **Summarize.** You get a title, key points and key terms. Long lectures are split into parts. Each part is summarized, then the parts are merged into one summary.
- **Quiz me.** Five multiple-choice questions with explanations and a score.
- **Pick where the AI runs:**
  - **Auto:** `PREFER_ON_DEVICE`. Gemini Nano first, cloud if Nano isn't available. If Nano fails on a step (input too long, broken JSON), that step is retried in the cloud.
  - **Private:** `ONLY_ON_DEVICE`. Nothing leaves the laptop. Works offline once the model is downloaded.
  - **Cloud:** `ONLY_IN_CLOUD`. Gemini Flash-Lite.
- **See where it ran.** After every result, a banner shows how many steps ran on the laptop and how many in the cloud, using `response.inferenceSource`.

## How Firebase AI Logic is used

| Where | What |
|---|---|
| `src/firebase.js` | `initializeApp`, App Check (reCAPTCHA Enterprise / Fraud Defense, debug provider in dev), `getAI` with `GoogleAIBackend` |
| `src/ai.js` | `getGenerativeModel` with `mode` (`PREFER_ON_DEVICE` / `ONLY_ON_DEVICE` / `ONLY_IN_CLOUD`), `inCloudParams` (model, system instruction, JSON schema) and `onDeviceParams` (`createOptions`, `promptOptions.responseConstraint`) |
| `src/ai.js` | `initializeDeviceModel()` on the first click to download Gemini Nano, with progress |
| `src/ai.js` | Structured JSON output on both paths: `Schema` for the cloud, a JSON schema `responseConstraint` for Gemini Nano |
| `src/main.js` | `result.response.inferenceSource` to show on-device vs cloud for every step |

## Run it locally

Requirements: Node 20+, desktop Chrome 139+ for on-device inference.

1. Create a Firebase project. In the console go to **AI Logic → Get started → Gemini Developer API**, then register a **Web app**.
2. Clone and install:
   ```bash
   git clone https://github.com/<your-username>/notesnano.git
   cd notesnano
   npm install
   ```
3. Copy `.env.example` to `.env.local` and fill in your web app's config.
4. App Check (required by AI Logic):
   - Create a reCAPTCHA Enterprise (Fraud Defense) web key for your domain and register it under **Security → App Check → Apps**. Put the site key in `VITE_RECAPTCHA_SITE_KEY`.
   - For localhost, run the app once, copy the debug token from the browser console, and add it under **App Check → Apps → Manage debug tokens**. You can pin it in `.env.development.local` as `VITE_APPCHECK_DEBUG_TOKEN`.
5. Turn on Gemini Nano in Chrome: set `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` to **Enabled** and restart Chrome. Then check `await LanguageModel.availability()` in DevTools.
6. `npm run dev` and open http://localhost:5173

## Deploy

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Limits

- Gemini Nano needs desktop Chrome on a machine with 16 GB RAM and 4+ cores, or a GPU with more than 4 GB VRAM, plus about 22 GB of free disk. Other browsers and smaller laptops use the cloud.
- Scanned PDFs (photos of pages) have no text layer, so they aren't supported yet.
- English notes work best on-device.

## License

Apache 2.0
