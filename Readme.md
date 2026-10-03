# AutoFill AI

A Chrome extension (Manifest V3) that intelligently scans and fills web forms using a personal profile built from your resume. Upload your resume PDF once, configure your LLM API key, and autofill job applications and complex web forms with one click or Alt+Shift+F.

## Features
- **Direct PDF to Profile:** Sends your resume PDF directly to your chosen AI model using native multimodal document intelligence (Gemini inline_data, Claude document block, or OpenAI file_data) to build a faithful, comprehensive `PROFILE.md` without any external text extractors or pdf.js dependencies.
- **Context-Aware Form Filling:** Analyzes field labels, placeholders, surrounding text, section headings, and custom comboboxes to accurately resolve every field, including tailored open-ended questions.
- **Repeatable Sections Engine:** Automatically detects "+ Add website", "+ Add link", "+ Add experience", "+ Add education", "+ Add skill", "+ Add language", and "+ Add certification" buttons, plans missing items in one batched LLM call, clicks the buttons, waits for new inputs with MutationObserver, and fills the new rows idempotently.
- **Resume & Document Auto-Attach:** Automatically attaches your stored resume (or cover letter) to file upload fields and custom drop zones using browser DataTransfer events.
- **Full Control & Review Panel:** High confidence (green) and inferred (orange) highlights, undo snapshot, and a review panel where manual corrections are memorized for future applications.
- **Zero Auto-Submission:** Never submits forms, and never touches passwords, credit cards, or OTP verification codes.

## Privacy and Safety
- **Local Storage:** Your profile, stored documents, and API keys are stored strictly in `chrome.storage.local` on your device.
- **Direct Requests:** No intermediate proxy servers. API calls are sent directly from your browser's service worker to your chosen AI provider.
- **Privacy Notice:** Your PDF is sent to your chosen AI provider once to build your profile. It is stored only on your device.
- **Strict Guardrails:** Leaves fields blank rather than hallucinating when information is absent from your profile.

## Installation
1. Clone or download this repository.
2. Open `chrome://extensions` in Google Chrome and enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select the extension folder (`/extension`).
4. Click the extension icon or open Options, enter your API key (e.g. free Gemini API key from Google AI Studio), and upload your resume PDF.
5. Navigate to any job application or web form and click **Fill This Page** or press <kbd>Alt+Shift+F</kbd>!
