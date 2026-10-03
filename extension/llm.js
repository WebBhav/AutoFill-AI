/**
 * AutoFill AI - LLM Integration Module
 * Supports Google Gemini (native multimodal PDF), Anthropic Claude (document blocks),
 * and OpenAI (file input or clear compatibility messaging).
 */

export const DEFAULT_CONFIG = {
  provider: 'gemini',
  geminiModel: 'gemini-3.8-flash',
  openaiModel: 'gpt-4o-mini',
  anthropicModel: 'claude-3-5-sonnet-20241022',
};

/**
 * Clean and defensively parse JSON from an LLM response.
 * Strips markdown code blocks and handles common formatting quirks.
 */
export function parseDefensiveJSON(text) {
  if (!text || typeof text !== 'string') return null;

  let cleaned = text.trim();

  // Strip Markdown code fences: ```json ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:json)?\s*[\r\n]+/i, '');
  cleaned = cleaned.replace(/[\r\n]+\s*```\s*$/i, '');
  cleaned = cleaned.trim();

  // Find first '[' or '{' and last ']' or '}'
  const firstBrace = cleaned.search(/[{}\[\]]/);
  if (firstBrace === -1) {
    throw new Error('No JSON structure found in LLM response.');
  }

  const isArray = cleaned[firstBrace] === '[';
  const startChar = isArray ? '[' : '{';
  const endChar = isArray ? ']' : '}';

  const startIndex = cleaned.indexOf(startChar);
  const lastIndex = cleaned.lastIndexOf(endChar);

  if (startIndex === -1 || lastIndex === -1 || lastIndex <= startIndex) {
    throw new Error('Malformed JSON brackets in LLM response.');
  }

  const jsonSubstring = cleaned.substring(startIndex, lastIndex + 1);

  try {
    return JSON.parse(jsonSubstring);
  } catch (err) {
    // Attempt minor fixes: remove trailing commas before closing braces
    const fixedTrailing = jsonSubstring.replace(/,\s*([}\]])/g, '$1');
    return JSON.parse(fixedTrailing);
  }
}

/**
 * Dispatch an LLM request to the selected provider.
 * Accepts attachments: Array of { mimeType, base64 } or { mime_type, data }.
 */
export async function callLLM({
  provider = 'gemini',
  model,
  apiKey,
  systemInstruction,
  userPrompt,
  attachments = [],
  inlineFiles = [],
  jsonMode = false,
}) {
  if (!apiKey) {
    throw new Error(`Missing API Key for provider: ${provider}. Please enter your key in AutoFill AI Settings.`);
  }

  // Normalize attachments (support both attachments and legacy inlineFiles)
  const normalizedAttachments = [...(attachments || []), ...(inlineFiles || [])].map(att => ({
    name: att.name || 'document.pdf',
    mimeType: att.mimeType || att.mime_type || att.type || 'application/pdf',
    base64: att.base64 || att.data || '',
  }));

  switch (provider) {
    case 'gemini':
      return callGemini({ model, apiKey, systemInstruction, userPrompt, attachments: normalizedAttachments, jsonMode });
    case 'anthropic':
      return callAnthropic({ model, apiKey, systemInstruction, userPrompt, attachments: normalizedAttachments });
    case 'openai':
      return callOpenAI({ model, apiKey, systemInstruction, userPrompt, attachments: normalizedAttachments, jsonMode });
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

/**
 * Google Gemini API Call (Supports Native Multimodal PDF via inline_data)
 */
async function callGemini({ model, apiKey, systemInstruction, userPrompt, attachments = [], jsonMode }) {
  const modelName = model || 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parts = [];

  // Add native document attachments: inline_data with mime_type "application/pdf"
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att.base64) {
        parts.push({
          inline_data: {
            mime_type: att.mimeType || 'application/pdf',
            data: att.base64,
          },
        });
      }
    }
  }

  parts.push({ text: userPrompt });

  const body = {
    contents: [
      {
        role: 'user',
        parts,
      },
    ],
    generationConfig: {
      temperature: 0.1,
    },
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  if (jsonMode) {
    body.generationConfig.responseMimeType = 'application/json';
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(`Gemini network connection failed: ${netErr.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMsg = `Gemini API error (Status ${response.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson.error?.message) {
        parsedMsg = errJson.error.message;
      }
    } catch (_) {}

    if (response.status === 429) {
      throw new Error('Rate limit reached on Gemini API. Please wait a moment or check your API quota.');
    }
    if (response.status === 404) {
      throw new Error(`Gemini model "${modelName}" is not available or unsupported for your API key.`);
    }
    if (response.status === 400) {
      throw new Error(`Gemini document reading error: ${parsedMsg}. The PDF may be corrupt or unreadable.`);
    }
    throw new Error(`Gemini error: ${parsedMsg}`);
  }

  const data = await response.json();
  const textOutput = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOutput) {
    throw new Error('Gemini returned an empty response. Check if content was flagged or if the document contains readable text.');
  }

  return textOutput;
}

/**
 * Anthropic Claude API Call (Supports Native Document Content Block with base64 source)
 */
async function callAnthropic({ model, apiKey, systemInstruction, userPrompt, attachments = [] }) {
  const modelName = model || 'claude-3-5-sonnet-20241022';
  const url = 'https://api.anthropic.com/v1/messages';

  const userContent = [];

  // Claude Native Document Input: content block of type "document" with a base64 source and media_type "application/pdf"
  if (attachments && Array.isArray(attachments)) {
    for (const att of attachments) {
      if (att.base64) {
        userContent.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: att.mimeType || 'application/pdf',
            data: att.base64,
          },
        });
      }
    }
  }

  userContent.push({ type: 'text', text: userPrompt });

  const body = {
    model: modelName,
    max_tokens: 4096,
    temperature: 0.1,
    messages: [{ role: 'user', content: userContent }],
  };

  if (systemInstruction) {
    body.system = systemInstruction;
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-browser': 'true',
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(`Anthropic network connection failed: ${netErr.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMsg = `Anthropic API error (${response.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson.error?.message) parsedMsg = errJson.error.message;
    } catch (_) {}

    if (response.status === 429) {
      throw new Error('Rate limit reached on Anthropic API. Please wait a moment or check your account limits.');
    }
    if (response.status === 404) {
      throw new Error(`Anthropic model "${modelName}" not found or unsupported.`);
    }
    if (response.status === 400) {
      throw new Error(`Anthropic document reading error: ${parsedMsg}`);
    }
    throw new Error(`Anthropic error: ${parsedMsg}`);
  }

  const data = await response.json();
  return data?.content?.[0]?.text || '';
}

/**
 * OpenAI API Call
 * Sends file input part with file_data (base64) for documents, or presents a clear message
 * for custom endpoints that do not support document inputs.
 */
async function callOpenAI({ model, apiKey, systemInstruction, userPrompt, attachments = [], jsonMode }) {
  const modelName = model || 'gpt-4o-mini';
  const url = 'https://api.openai.com/v1/chat/completions';

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }

  const userContent = [];

  if (attachments && Array.isArray(attachments) && attachments.length > 0) {
    for (const att of attachments) {
      if (att.base64) {
        if (att.mimeType?.startsWith('image/')) {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${att.mimeType};base64,${att.base64}` },
          });
        } else {
          // OpenAI native file input part with file_data
          userContent.push({
            type: 'file',
            file: {
              filename: att.name || 'resume.pdf',
              file_data: att.base64,
            },
          });
        }
      }
    }
  }

  userContent.push({ type: 'text', text: userPrompt });
  messages.push({ role: 'user', content: userContent.length === 1 ? userPrompt : userContent });

  const body = {
    model: modelName,
    messages,
    temperature: 0.1,
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(`OpenAI network connection failed: ${netErr.message}`);
  }

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMsg = `OpenAI API error (${response.status})`;
    try {
      const errJson = JSON.parse(errorBody);
      if (errJson.error?.message) parsedMsg = errJson.error.message;
    } catch (_) {}

    // Check for custom OpenAI-compatible provider that cannot read PDFs
    if (
      parsedMsg.toLowerCase().includes('unsupported') ||
      parsedMsg.toLowerCase().includes('file') ||
      parsedMsg.toLowerCase().includes('document') ||
      parsedMsg.toLowerCase().includes('invalid type')
    ) {
      throw new Error(
        'This OpenAI-compatible model/endpoint does not support direct PDF document input. Please use Gemini or Claude, or enter your profile details manually in PROFILE.md.'
      );
    }

    if (response.status === 429) {
      throw new Error('Rate limit reached on OpenAI API. Please wait a moment or check your quota.');
    }
    if (response.status === 404) {
      throw new Error(`OpenAI model "${modelName}" not found or unsupported.`);
    }
    throw new Error(`OpenAI error: ${parsedMsg}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

/**
 * Extract data directly from uploaded PDF document(s) using the LLM's native multimodal capabilities
 * and merge faithfully into PROFILE.md in a single step without custom text extractors.
 */
export async function extractAndMergeProfileFromPDF({ files, existingProfile = '', apiKey, provider = 'gemini', model }) {
  const fileList = Array.isArray(files) ? files : [files];
  const isMerge = Boolean(existingProfile && existingProfile.trim().length > 30);

  // Validate file sizes and warn if >20MB
  const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
  for (const f of fileList) {
    if (f.size && f.size > MAX_FILE_SIZE) {
      throw new Error(`File "${f.name || 'Document'}" is larger than 20 MB. Please upload a smaller document.`);
    }
  }

  const attachments = fileList.map(f => ({
    name: f.name || 'Document.pdf',
    mimeType: f.mimeType || f.type || 'application/pdf',
    base64: f.base64 || f.data,
  }));

  const systemInstruction = `You are an expert resume and credentials parser for an autofill browser extension.
Your task is to analyze the attached PDF document(s) directly using your native document intelligence, and extract EVERYTHING completely and faithfully into a structured Markdown profile named PROFILE.md.

CRITICAL EXTRACTION RULES:
1. EXTRACT EVERYTHING completely and faithfully: all work history, jobs, dates, bullet points, projects, skills, links, certifications, and contact details. Do NOT summarize or omit achievements.
2. NEVER invent facts or hallucinate. Only extract what is genuinely present in the document(s).
3. For missing common fields not stated in the source (e.g., notice period, work authorization, expected salary, driver's license), mark them explicitly as UNKNOWN.
4. Keep the output strictly in standard Markdown format matching the template below.
5. If an existing profile is provided, MERGE new information into it without deleting existing accurate facts. Resolve conflicts by keeping the most recent or detailed version.
6. Format dates clearly (e.g. YYYY-MM or Month YYYY).`;

  const userPrompt = `
${isMerge ? `EXISTING PROFILE.md TO MERGE WITH:\n\`\`\`markdown\n${existingProfile}\n\`\`\`\n\n` : ''}
Please analyze the attached PDF document(s) directly (${fileList.map(f => f.name || 'Document').join(', ')}), extract all candidate data completely without omitting details, and produce an updated, comprehensive PROFILE.md following this exact Markdown structure:

# PERSONAL PROFILE

## 1. Personal & Contact Information
- Full Name:
- First Name:
- Middle Name:
- Last Name:
- Preferred / Nickname:
- Email:
- Phone (Primary):
- Phone (Mobile):
- Street Address:
- Apartment / Suite:
- City:
- State / Province:
- Postal Code:
- Country:

## 2. Web & Social Links
- LinkedIn:
- GitHub:
- Personal Portfolio / Website:
- Twitter / X:
- Other Links:

## 3. Work Authorization & Logistics
- Legally Authorized to Work in Country of Residence: (Yes/No/UNKNOWN)
- Will now or in the future require visa sponsorship: (Yes/No/UNKNOWN)
- Current Work Authorization / Visa Type: (e.g. US Citizen, Permanent Resident, H1-B, OPT, UK Indefinite Leave, UNKNOWN)
- Willing to Relocate: (Yes/No/Remote Only/UNKNOWN)
- Notice Period / Available Start Date: (e.g. Immediately, 2 weeks, UNKNOWN)
- Desired Salary / Rate: (e.g. $140,000/year, or UNKNOWN)
- Current Location:

## 4. Professional Summary & Headlines
- Professional Title / Headline:
- Short Summary (2-3 sentences):
- Years of Professional Experience:

## 5. Work Experience
(List in reverse chronological order: Title, Company, Location, Start Date, End Date, Highlights/Achievements)

## 6. Education
(Degree, Major/Field of Study, School/University, Location, Graduation Date, GPA if available)

## 7. Skills & Competencies
- Programming Languages:
- Frameworks & Libraries:
- Databases & Cloud:
- Tools & Software:
- Soft Skills:

## 8. Certifications & Licenses
- (Name, Issuing Org, Date, Credential ID)

## 9. Languages
- (Language & Proficiency: Native, Fluent, Intermediate, Basic)

## 10. Common Job Application Q&A
- Why are you interested in this role?: (UNKNOWN or motivation keywords)
- Greatest professional accomplishment:
- Preferred work arrangement: (Remote / Hybrid / On-site)
- Has driver's license: (Yes/No/UNKNOWN)
- Veteran status: (UNKNOWN)
- Disability status: (Decline to state / UNKNOWN)

Output ONLY the markdown content. Do not include conversational introductory text.`;

  const output = await callLLM({
    provider,
    model,
    apiKey,
    systemInstruction,
    userPrompt,
    attachments,
    jsonMode: false,
  });

  return output.trim();
}

/**
 * Generate or merge a user profile into structured PROFILE.md from text.
 */
export async function generateProfileFromText({ text, existingProfile = '', apiKey, provider = 'gemini', model }) {
  const isMerge = Boolean(existingProfile && existingProfile.trim().length > 50);

  const systemInstruction = `You are an expert resume parsing and identity data engineer for a browser autofill extension.
Your task is to take raw text from documents (resume, CV, cover letter, ID) and generate a pristine, structured Markdown profile named PROFILE.md.

CRITICAL RULES:
1. Extract all facts completely and faithfully. Do NOT summarize or omit details.
2. NEVER invent facts or hallucinate. Only extract what is present in the text.
3. For items not mentioned in the source (notice period, work authorization, expected salary), write UNKNOWN.
4. Keep the output in standard Markdown format matching the template below.
5. If an existing profile is provided, MERGE the new information without deleting accurate existing facts.
6. Format dates clearly (e.g. YYYY-MM or Month YYYY).`;

  const userPrompt = `
${isMerge ? `EXISTING PROFILE.md TO MERGE WITH:\n\`\`\`markdown\n${existingProfile}\n\`\`\`\n\n` : ''}
RAW DOCUMENT TEXT:
"""
${text}
"""

Please produce a comprehensive PROFILE.md following this exact Markdown structure:

# PERSONAL PROFILE

## 1. Personal & Contact Information
- Full Name:
- First Name:
- Middle Name:
- Last Name:
- Preferred / Nickname:
- Email:
- Phone (Primary):
- Phone (Mobile):
- Street Address:
- Apartment / Suite:
- City:
- State / Province:
- Postal Code:
- Country:

## 2. Web & Social Links
- LinkedIn:
- GitHub:
- Personal Portfolio / Website:
- Twitter / X:
- Other Links:

## 3. Work Authorization & Logistics
- Legally Authorized to Work in Country of Residence: (Yes/No/UNKNOWN)
- Will now or in the future require visa sponsorship: (Yes/No/UNKNOWN)
- Current Work Authorization / Visa Type: (e.g. US Citizen, Permanent Resident, H1-B, OPT, UK Indefinite Leave, UNKNOWN)
- Willing to Relocate: (Yes/No/Remote Only/UNKNOWN)
- Notice Period / Available Start Date: (e.g. Immediately, 2 weeks, UNKNOWN)
- Desired Salary / Rate: (e.g. $140,000/year, or UNKNOWN)
- Current Location:

## 4. Professional Summary & Headlines
- Professional Title / Headline:
- Short Summary (2-3 sentences):
- Years of Professional Experience:

## 5. Work Experience
(List in reverse chronological order: Title, Company, Location, Start Date, End Date, Highlights/Achievements)

## 6. Education
(Degree, Major/Field of Study, School/University, Location, Graduation Date, GPA if available)

## 7. Skills & Competencies
- Programming Languages:
- Frameworks & Libraries:
- Databases & Cloud:
- Tools & Software:
- Soft Skills:

## 8. Certifications & Licenses
- (Name, Issuing Org, Date, Credential ID)

## 9. Languages
- (Language & Proficiency: Native, Fluent, Intermediate, Basic)

## 10. Common Job Application Q&A
- Why are you interested in this role?: (UNKNOWN or key motivation keywords)
- Greatest professional accomplishment:
- Preferred work arrangement: (Remote / Hybrid / On-site)
- Has driver's license: (Yes/No/UNKNOWN)
- Veteran status: (UNKNOWN)
- Disability status: (Decline to state / UNKNOWN)

Output ONLY the markdown content. Do not include introductory commentary.`;

  const output = await callLLM({
    provider,
    model,
    apiKey,
    systemInstruction,
    userPrompt,
    jsonMode: false,
  });

  return output.trim();
}

/**
 * Match form fields with PROFILE.md in batched requests.
 */
export async function matchFieldsWithProfile({ fields, profile, learnedAnswers = {}, pageContext = {}, apiKey, provider = 'gemini', model }) {
  if (!fields || fields.length === 0) return [];
  if (!profile || profile.trim().length === 0) {
    throw new Error('User profile is empty. Please set up your profile in AutoFill AI options first.');
  }

  const BATCH_SIZE = 45;
  const batches = [];
  for (let i = 0; i < fields.length; i += BATCH_SIZE) {
    batches.push(fields.slice(i, i + BATCH_SIZE));
  }

  const allResults = [];

  for (let bIndex = 0; bIndex < batches.length; bIndex++) {
    const batch = batches[bIndex];
    const batchResults = await matchSingleBatch({
      batch,
      profile,
      learnedAnswers,
      pageContext,
      apiKey,
      provider,
      model,
    });
    allResults.push(...batchResults);
  }

  return allResults;
}

/**
 * Single batch field matching
 */
async function matchSingleBatch({ batch, profile, learnedAnswers, pageContext, apiKey, provider, model }) {
  const systemInstruction = `You are an ultra-precise web form autofill engine.
You will receive:
1. A candidate's Markdown profile (PROFILE.md)
2. Learned question-answer corrections
3. Page context (page title, domain, URL)
4. A list of form field descriptors (id, type, label, name, placeholder, section, options, required)

YOUR GOAL:
Return a JSON array of autofill actions matching each field id.

STRICT RULES:
1. Return ONLY a valid JSON array of objects:
   [
     {
       "id": "field_unique_id",
       "value": "string or boolean or array or null",
       "confidence": 0.0 to 1.0,
       "reason": "Brief reason for choice"
     }
   ]
2. NEVER guess or invent facts. If the information is NOT present in PROFILE.md, return "value": null and "confidence": 0.0.
3. For "select" or "radio" fields with an "options" list:
   - "value" MUST be either the EXACT string of one of the provided options, or matching its value attribute. Do NOT invent new options.
   - If no option fits, return null.
4. For "checkbox" fields: return true or false.
5. For date fields: format as YYYY-MM-DD or MM/DD/YYYY based on the field placeholder or descriptor hint.
6. For open-ended questions (e.g. "Why do you want to join our company?", "Tell us about yourself"):
   - Write a concise, polite, tailored answer (2-4 sentences max) utilizing the candidate's actual skills and background from the profile, subtly referencing the company/page context if known.
   - Confidence should be 0.85.
7. Confidence scoring guidelines:
   - 0.95 - 1.0: Exact match from profile (e.g. email, phone, name, LinkedIn, github).
   - 0.75 - 0.9: Close inferred match or tailored answer.
   - 0.5 - 0.7: Partial match or educated choice among constrained options.
   - 0.0: Unknown / null.
8. NEVER fill passwords, credit cards, CVVs, or OTP verification codes. (Return null).
9. For file upload fields (type: 'file'):
   - Classify the target document request based on label, name, and nearby context into:
     - "resume" (Resume, CV, Curriculum Vitae, Work History)
     - "cover_letter" (Cover Letter, Motivation Letter, Statement of Purpose)
     - "other_document" (Portfolio, Transcripts, Certifications, Writing Sample)
     - "photo" (Profile Picture, Headshot, Avatar, Photograph)
   - Default ambiguous upload fields to "resume".
   - Return "value": "resume" | "cover_letter" | "other_document" | "photo" (or null).`;

  const userPrompt = `
PAGE CONTEXT:
- Title: ${pageContext.title || 'N/A'}
- URL: ${pageContext.url || 'N/A'}
- Headings/Context: ${pageContext.heading || 'N/A'}

CANDIDATE PROFILE (PROFILE.md):
"""
${profile}
"""

PREVIOUSLY LEARNED ANSWERS:
${JSON.stringify(learnedAnswers || {}, null, 2)}

FORM FIELDS TO FILL (${batch.length} fields):
${JSON.stringify(batch, null, 2)}

Produce a JSON array of autofill decisions for all ${batch.length} field IDs.`;

  const rawResponse = await callLLM({
    provider,
    model,
    apiKey,
    systemInstruction,
    userPrompt,
    jsonMode: provider === 'gemini' || provider === 'openai',
  });

  const parsed = parseDefensiveJSON(rawResponse);
  if (!Array.isArray(parsed)) {
    if (parsed && Array.isArray(parsed.fields)) return parsed.fields;
    if (parsed && Array.isArray(parsed.answers)) return parsed.answers;
    throw new Error('LLM did not return a JSON array for field autofill.');
  }

  return parsed;
}

/**
 * Plan repeatable sections (e.g. "+ Add website", "+ Add experience", "+ Add skill")
 * Determines how many items to add based on profile data minus what's already on the page.
 */
export async function planRepeatableSections({ sections, profile, apiKey, provider = 'gemini', model }) {
  if (!sections || sections.length === 0) return [];
  if (!apiKey || !profile) return [];

  const systemInstruction = `You are a web form autofill planner specializing in repeatable sections (sections with "+ Add" buttons, such as "+ Add website", "+ Add link", "+ Add experience", "+ Add education", "+ Add skill", "+ Add language", "+ Add certification").

YOUR GOAL:
Given the candidate's PROFILE.md and a list of detected repeatable sections on the webpage, calculate how many entries need to be added for each section (itemsToAdd) and provide the exact data items to fill for each entry.

STRICT RULES:
1. Return ONLY a valid JSON array of objects with this exact structure:
[
  {
    "sectionId": "exact sectionId from input",
    "sectionLabel": "exact sectionLabel from input",
    "itemsToAdd": N, // integer >= 0, capped at 10 max
    "items": [
      {
        // Field key-value pairs to fill for this item.
        // For websites/links: {"type": "Portfolio"|"LinkedIn"|"GitHub"|"Website", "url": "https://..."}
        // For skills: {"skill": "TypeScript"}
        // For education: {"school": "...", "degree": "...", "field": "...", "gradYear": "..."}
        // For experience: {"company": "...", "title": "...", "startDate": "...", "endDate": "...", "description": "..."}
        // For language: {"language": "English", "proficiency": "Native"}
        // For certifications: {"certification": "AWS Certified", "issuer": "Amazon"}
      }
    ],
    "reason": "Brief explanation of how many items exist in profile vs already on page"
  }
]

2. IDEMPOTENCE & COUNTING:
   - "existingCount" indicates how many input groups already exist in this section on the page.
   - "existingValues" contains values or substrings already present on the page in this section.
   - DO NOT re-add entries that are already in "existingValues".
   - If the candidate profile has 3 websites (Portfolio, LinkedIn, GitHub) and 0 website inputs are on the page, itemsToAdd = 3.
   - If the candidate profile has 3 websites and 1 website is already present with the candidate's LinkedIn URL, itemsToAdd = 2 (only for Portfolio and GitHub).
   - If an empty row is already present on the page, include all missing items in the "items" list (the executor will fill the existing empty row first before clicking Add).
   - NEVER add more entries than the candidate's profile actually has.
   - Cap itemsToAdd at 10 per section to prevent infinite loops.
   - If a section is irrelevant or has no matching data in the profile, set itemsToAdd: 0 and items: [].`;

  const userPrompt = `
CANDIDATE PROFILE (PROFILE.md):
"""
${profile}
"""

DETECTED REPEATABLE SECTIONS:
${JSON.stringify(sections, null, 2)}

Produce a JSON array of plans for these sections.`;

  const rawResponse = await callLLM({
    provider,
    model,
    apiKey,
    systemInstruction,
    userPrompt,
    jsonMode: provider === 'gemini' || provider === 'openai',
  });

  const parsed = parseDefensiveJSON(rawResponse);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.sections)) return parsed.sections;
  if (parsed && Array.isArray(parsed.plans)) return parsed.plans;
  return [];
}
