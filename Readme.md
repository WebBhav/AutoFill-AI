# AutoFill AI

A Chrome extension (Manifest V3) that fills web forms using a personal profile built from your resume. Upload a PDF once, add your own LLM API key, and fill job applications and other forms with one click or Alt+Shift+F.

## Features
- **Resume to profile:** extracts text from your PDF locally (pdf.js) and uses an LLM to build an editable `PROFILE.md`
- **Context-aware filling:** reads labels, placeholders and surrounding text to work out what each field asks, including open-ended questions
- **Full field support:** text inputs, native and custom dropdowns, radio buttons, checkboxes and dates
- **Repeatable sections:** clicks "+ Add website / experience / education" buttons and fills the new rows
- **Resume auto-attach:** attaches your stored resume to file upload fields
- **Confidence highlighting:** green for certain, orange for uncertain, red for left blank, with a review panel and undo
- **Learns corrections:** edits you make are remembered for next time
- **Multi-provider:** Gemini, OpenAI, Anthropic, or any OpenAI-compatible endpoint

## Privacy and safety
- Profile, resume file and API key are stored only in `chrome.storage.local`
- No backend server. Requests go directly from your browser to the provider you choose
- Only the profile text and field labels are sent to the LLM. The resume file itself is never sent
- Never auto-submits forms, and never fills password, card or OTP fields
- Leaves a field blank rather than guessing when the information isn't in your profile
- Does not handle CAPTCHAs or verification steps

## Installation
1. Clone this repo and download pdf.js into `/lib`
2. Open `chrome://extensions` and enable **Developer mode**
3. Click **Load unpacked** and select the project folder
4. Open the extension, add your API key and upload your resume

## Known limitations
Some sites use heavily customized widgets (certain Workday and Greenhouse setups, for example), so results can vary. Always review the form before submitting.
