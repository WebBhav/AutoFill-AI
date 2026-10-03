/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import {
  Download,
  Sparkles,
  FileText,
  Settings,
  HelpCircle,
  Copy,
  Check,
  RotateCcw,
  Eye,
  CheckCircle2,
  AlertCircle,
  Folder,
  FileCode,
  ShieldCheck,
  Cpu,
  Layers,
  Zap,
  Play,
  Trash2,
  Upload,
  ArrowRight,
  ExternalLink
} from 'lucide-react';
import { EXTENSION_FILES } from './extension-source.ts';

const SAMPLE_PROFILE_DEFAULT = `# PERSONAL PROFILE

## 1. Personal & Contact Information
- Full Name: Alex Rivera
- First Name: Alex
- Middle Name: Morgan
- Last Name: Rivera
- Preferred / Nickname: Alex
- Email: alex.rivera@devmail.io
- Phone (Primary): +1 (415) 890-1234
- Phone (Mobile): +1 (415) 890-1234
- Street Address: 450 Mission Street
- Apartment / Suite: Suite 1200
- City: San Francisco
- State / Province: CA
- Postal Code: 94105
- Country: United States

## 2. Web & Social Links
- LinkedIn: https://linkedin.com/in/alex-rivera-dev
- GitHub: https://github.com/alexrivera-cloud
- Personal Portfolio / Website: https://alexrivera.dev
- Twitter / X: https://x.com/alexrivera_ai
- Other Links: https://bsky.app/profile/alexrivera.dev

## 3. Work Authorization & Logistics
- Legally Authorized to Work in Country of Residence: Yes
- Will now or in the future require visa sponsorship: No
- Current Work Authorization / Visa Type: US Citizen
- Willing to Relocate: Yes
- Notice Period / Available Start Date: 2 weeks
- Desired Salary / Rate: $165,000 / year
- Current Location: San Francisco, CA

## 4. Professional Summary & Headlines
- Professional Title / Headline: Senior Full-Stack & Systems Engineer
- Short Summary: Full-stack engineer with 7+ years building high-concurrency cloud applications and intuitive web interfaces with TypeScript, React, and Go.
- Years of Professional Experience: 7

## 5. Work Experience
- **Staff Software Engineer** | CloudStream Technologies (2022 - Present) | San Francisco, CA
  - Designed distributed event pipeline handling 100k requests/sec using Kafka & Go.
  - Led the frontend platform migration to React 19 with 40% reduction in TTI.
- **Senior Software Engineer** | Horizon Labs (2019 - 2022) | Seattle, WA
  - Built core collaborative features used by 250,000 active enterprise users.
  - Reduced API p99 latency from 320ms to 45ms.

## 6. Education
- **B.S. in Computer Science** | University of Washington (2015 - 2019) | GPA: 3.85

## 7. Skills & Competencies
- Programming Languages: TypeScript, JavaScript, Python, Go, SQL
- Frameworks & Libraries: React, Node.js, Express, Next.js, Tailwind CSS
- Cloud & Infrastructure: AWS, Docker, Kubernetes, PostgreSQL, Redis
- Soft Skills: Technical Architecture, Mentorship, Cross-functional Leadership

## 8. Certifications & Licenses
- AWS Certified Solutions Architect - Professional (2023)

## 9. Languages
- English (Native / Bilingual)
- Spanish (Professional Working)

## 10. Common Job Application Q&A
- Why are you interested in this role?: Excited by your mission to streamline complex developer workflows. My background scaling high-concurrency systems directly aligns with the roadmap.
- Greatest professional accomplishment: Led zero-downtime database migration for 10M accounts while cutting infrastructure costs by 30%.
- Preferred work arrangement: Hybrid or Remote
- Has driver's license: Yes
- Veteran status: Not a veteran
- Disability status: No disability
`;

export default function App() {
  const [activeTab, setActiveTab] = useState<'simulator' | 'profile' | 'code' | 'guide'>('simulator');
  const [selectedFile, setSelectedFile] = useState<string>('manifest.json');
  const [copiedFile, setCopiedFile] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  // Profile Studio State
  const [profileText, setProfileText] = useState(SAMPLE_PROFILE_DEFAULT);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'openai' | 'anthropic'>('gemini');
  const [geminiModel, setGeminiModel] = useState<string>('gemini-3.8-flash');
  const [customGeminiModel, setCustomGeminiModel] = useState<string>('');
  const [learnedAnswers, setLearnedAnswers] = useState<Record<string, { answer: string; reason: string }>>({
    'willingtorelocate': { answer: 'Yes', reason: 'User confirmed preference for relocation' },
    'noticeperiod': { answer: '2 weeks', reason: 'Standard current notice period' },
  });

  // Simulator Form State (React controlled)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    address: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    linkedIn: '',
    github: '',
    portfolio: '',
    yearsExp: '',
    workAuth: '',
    sponsorship: '',
    relocate: '',
    startDate: '',
    desiredSalary: '',
    roleInterest: 'Full Stack',
    whyJoin: '',
    agreeCheck: false,
    resumeName: '',
  });

  // Simulator Autofill State
  const [fieldHighlights, setFieldHighlights] = useState<Record<string, 'high' | 'medium' | 'unfilled'>>({});
  const [scannedDescriptors, setScannedDescriptors] = useState<any[] | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [floatingBadge, setFloatingBadge] = useState<{ filled: number; total: number } | null>(null);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewFields, setReviewFields] = useState<Array<{ id: string; label: string; value: string; confidence: number; reason: string }>>([]);
  const [undoSnapshot, setUndoSnapshot] = useState<typeof formData | null>(null);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'success' | 'info' | 'warn' } | null>(null);

  const formContainerRef = useRef<HTMLDivElement>(null);

  const showToast = (text: string, type: 'success' | 'info' | 'warn' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3500);
  };

  // Download entire Extension as ZIP
  const handleDownloadZip = async () => {
    setIsZipping(true);
    try {
      const zip = new JSZip();
      const extFolder = zip.folder('autofill-ai-extension') || zip;

      Object.entries(EXTENSION_FILES).forEach(([relativePath, fileObj]) => {
        if (fileObj.isBinary) {
          extFolder.file(relativePath, fileObj.content, { base64: true });
        } else {
          extFolder.file(relativePath, fileObj.content);
        }
      });

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'autofill-ai-extension.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Extension downloaded! Extract and load in chrome://extensions', 'success');
    } catch (err: any) {
      showToast(`Failed to build zip: ${err.message}`, 'warn');
    } finally {
      setIsZipping(false);
    }
  };

  // Scan the Simulator DOM fields using descriptor logic
  const handleScanFields = () => {
    setIsScanning(true);
    const container = formContainerRef.current;
    if (!container) return;

    const elements = container.querySelectorAll('input, select, textarea, [role="combobox"]');
    const descriptors: any[] = [];

    elements.forEach((el: any, idx) => {
      const id = el.id || el.name || `field_${idx + 1}`;
      let label = el.getAttribute('aria-label') || el.placeholder || el.name;
      if (el.id) {
        const lbl = container.querySelector(`label[for="${el.id}"]`);
        if (lbl) label = (lbl as HTMLElement).innerText.replace(/[*:]/g, '').trim();
      }
      if (!label && el.closest('.form-control-wrap')) {
        const lbl = el.closest('.form-control-wrap').querySelector('label');
        if (lbl) label = lbl.innerText.replace(/[*:]/g, '').trim();
      }

      const desc: any = {
        id,
        name: el.name || el.id,
        type: el.type || el.tagName.toLowerCase(),
        label: label || 'Field',
        placeholder: el.placeholder || '',
        required: el.required || false,
        currentValue: el.type === 'checkbox' ? el.checked : el.value,
      };

      if (el.tagName.toLowerCase() === 'select') {
        desc.options = Array.from((el as HTMLSelectElement).options).map(o => ({ value: o.value, text: o.text }));
      }

      descriptors.push(desc);
    });

    setScannedDescriptors(descriptors);
    setIsScanning(false);
    showToast(`Scanned ${descriptors.length} form field descriptors!`, 'info');
  };

  // Run AutoFill Engine on the Simulator
  const handleRunAutofill = async () => {
    setIsAutofilling(true);
    // Take snapshot for Undo
    setUndoSnapshot({ ...formData });

    // Simulate smart matching against PROFILE.md
    setTimeout(() => {
      const highlights: Record<string, 'high' | 'medium' | 'unfilled'> = {};
      const newForm = { ...formData };
      const reviews: Array<{ id: string; label: string; value: string; confidence: number; reason: string }> = [];

      // Step 1 matching
      if (currentStep === 1) {
        newForm.firstName = 'Alex';
        highlights['firstName'] = 'high';
        reviews.push({ id: 'firstName', label: 'First Name', value: 'Alex', confidence: 1.0, reason: 'Exact match from Profile' });

        newForm.lastName = 'Rivera';
        highlights['lastName'] = 'high';
        reviews.push({ id: 'lastName', label: 'Last Name', value: 'Rivera', confidence: 1.0, reason: 'Exact match from Profile' });

        newForm.email = 'alex.rivera@devmail.io';
        highlights['email'] = 'high';
        reviews.push({ id: 'email', label: 'Email Address', value: 'alex.rivera@devmail.io', confidence: 1.0, reason: 'Exact match from Profile' });

        newForm.phone = '+1 (415) 890-1234';
        highlights['phone'] = 'high';
        reviews.push({ id: 'phone', label: 'Phone Number', value: '+1 (415) 890-1234', confidence: 1.0, reason: 'Exact match from Profile' });

        newForm.address = '450 Mission Street, Suite 1200';
        highlights['address'] = 'high';
        reviews.push({ id: 'address', label: 'Street Address', value: '450 Mission Street, Suite 1200', confidence: 0.95, reason: 'Profile Street + Suite' });

        newForm.city = 'San Francisco';
        highlights['city'] = 'high';
        reviews.push({ id: 'city', label: 'City', value: 'San Francisco', confidence: 1.0, reason: 'Exact match' });

        newForm.state = 'CA';
        highlights['state'] = 'high';
        reviews.push({ id: 'state', label: 'State / Province', value: 'CA', confidence: 1.0, reason: 'Exact match' });

        newForm.zip = '94105';
        highlights['zip'] = 'high';
        reviews.push({ id: 'zip', label: 'Postal Code', value: '94105', confidence: 1.0, reason: 'Exact match' });

        newForm.linkedIn = 'https://linkedin.com/in/alex-rivera-dev';
        highlights['linkedIn'] = 'high';
        reviews.push({ id: 'linkedIn', label: 'LinkedIn URL', value: 'https://linkedin.com/in/alex-rivera-dev', confidence: 1.0, reason: 'Online Profiles link' });

        newForm.github = 'https://github.com/alexrivera-cloud';
        highlights['github'] = 'high';
        reviews.push({ id: 'github', label: 'GitHub URL', value: 'https://github.com/alexrivera-cloud', confidence: 1.0, reason: 'Online Profiles link' });

        newForm.portfolio = 'https://alexrivera.dev';
        highlights['portfolio'] = 'high';
        reviews.push({ id: 'portfolio', label: 'Portfolio URL', value: 'https://alexrivera.dev', confidence: 1.0, reason: 'Online Profiles link' });
      }

      // Step 2 matching
      if (currentStep === 2) {
        newForm.yearsExp = '7+ years';
        highlights['yearsExp'] = 'high';
        reviews.push({ id: 'yearsExp', label: 'Years of Experience', value: '7+ years', confidence: 0.95, reason: 'From Section 4: 7 years' });

        newForm.workAuth = 'citizen';
        highlights['workAuth'] = 'high';
        reviews.push({ id: 'workAuth', label: 'Work Authorization', value: 'citizen', confidence: 1.0, reason: 'US Citizen from Work Auth section' });

        newForm.sponsorship = 'no';
        highlights['sponsorship'] = 'high';
        reviews.push({ id: 'sponsorship', label: 'Requires Sponsorship', value: 'no', confidence: 1.0, reason: 'Profile states No sponsorship needed' });

        newForm.relocate = 'yes';
        highlights['relocate'] = 'high';
        reviews.push({ id: 'relocate', label: 'Willing to Relocate', value: 'yes', confidence: 1.0, reason: 'Matched learned answer cache' });

        newForm.startDate = '2026-10-17';
        highlights['startDate'] = 'high';
        reviews.push({ id: 'startDate', label: 'Available Start Date', value: '2026-10-17', confidence: 0.9, reason: '2 weeks notice period from profile' });

        newForm.desiredSalary = '$165,000';
        highlights['desiredSalary'] = 'high';
        reviews.push({ id: 'desiredSalary', label: 'Expected Salary', value: '$165,000', confidence: 0.95, reason: 'Profile Section 3: $165,000 / year' });
      }

      // Step 3 matching
      if (currentStep === 3) {
        newForm.roleInterest = 'Full Stack';
        highlights['roleInterest'] = 'high';
        reviews.push({ id: 'roleInterest', label: 'Primary Role Track', value: 'Full Stack', confidence: 0.95, reason: 'Senior Full-Stack Engineer headline' });

        newForm.whyJoin = 'I am drawn to your focus on high-impact developer workflows and infrastructure performance. With 7+ years architecting distributed systems and reactive web platforms, I look forward to contributing directly to your platform reliability and customer experience.';
        highlights['whyJoin'] = 'medium';
        reviews.push({ id: 'whyJoin', label: 'Why do you want to join?', value: newForm.whyJoin, confidence: 0.85, reason: 'Tailored answer synthesized from candidate skills and engineering context' });

        newForm.agreeCheck = true;
        highlights['agreeCheck'] = 'high';
        reviews.push({ id: 'agreeCheck', label: 'Consent & Verification', value: 'Checked', confidence: 1.0, reason: 'Standard job application consent' });

        newForm.resumeName = 'Alex_Rivera_Resume_2026.pdf';
        highlights['resumeName'] = 'high';
        reviews.push({ id: 'resumeName', label: 'Resume Upload', value: 'Alex_Rivera_Resume_2026.pdf', confidence: 1.0, reason: 'Auto-attached stored PDF via DataTransfer' });
      }

      setFormData(newForm);
      setFieldHighlights(highlights);
      setReviewFields(reviews);
      setFloatingBadge({ filled: reviews.length, total: reviews.length });
      setIsAutofilling(false);
      showToast(`AutoFill AI filled ${reviews.length} fields on Step ${currentStep}!`, 'success');
    }, 400);
  };

  const handleUndo = () => {
    if (undoSnapshot) {
      setFormData(undoSnapshot);
      setFieldHighlights({});
      setFloatingBadge(null);
      showToast('Undone previous autofill values.', 'info');
    }
  };

  const handleSaveCorrection = (fieldId: string, newVal: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: newVal }));
    setLearnedAnswers(prev => ({
      ...prev,
      [fieldId.toLowerCase()]: {
        answer: newVal,
        reason: `Manually corrected via Review Panel for "${fieldId}"`,
      },
    }));
    showToast(`Saved and memorized answer for "${fieldId}"!`, 'success');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-500 flex items-center justify-center font-black text-white text-base shadow-lg shadow-blue-500/25">
            AI
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-base tracking-tight text-white">AutoFill AI</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                Manifest V3
              </span>
              <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <ShieldCheck className="w-3 h-3" /> Ready to Load
              </span>
            </div>
            <p className="text-xs text-slate-400">PDF-Grounded Smart Form Filling Chrome Extension</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800">
          <button
            onClick={() => setActiveTab('simulator')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'simulator'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Play className="w-3.5 h-3.5" /> Form Simulator
          </button>
          <button
            onClick={() => setActiveTab('profile')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'profile'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <FileText className="w-3.5 h-3.5" /> Profile & Resume Studio
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'code'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" /> Extension Source ({Object.keys(EXTENSION_FILES).length} Files)
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${
              activeTab === 'guide'
                ? 'bg-blue-600 text-white shadow'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" /> Install & Debug Guide
          </button>
        </div>

        {/* 1-Click ZIP Downloader */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownloadZip}
            disabled={isZipping}
            className="flex items-center gap-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white text-xs font-bold px-4 py-2 rounded-xl shadow-lg shadow-blue-500/25 transition active:scale-95 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            {isZipping ? 'Packaging ZIP...' : 'Download Extension (.zip)'}
          </button>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-6 max-w-7xl mx-auto w-full">
        {/* Toast */}
        {toastMsg && (
          <div
            className={`fixed top-16 right-8 z-50 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold flex items-center gap-2.5 transition animate-in fade-in slide-in-from-top-3 ${
              toastMsg.type === 'success'
                ? 'bg-emerald-600 text-white'
                : toastMsg.type === 'warn'
                ? 'bg-amber-600 text-white'
                : 'bg-blue-600 text-white'
            }`}
          >
            {toastMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            {toastMsg.text}
          </div>
        )}

        {/* TAB 1: INTERACTIVE FORM SIMULATOR */}
        {activeTab === 'simulator' && (
          <div className="space-y-6">
            {/* Simulator Control Bar */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <h2 className="font-bold text-white text-sm">Workday / Greenhouse Job Application Simulator</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Test the extension's DOM scanner, React synthetic event triggering, and visual highlighting live.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleScanFields}
                  disabled={isScanning}
                  className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition"
                >
                  <Eye className="w-3.5 h-3.5" /> Scan Fields ({scannedDescriptors?.length ?? '?'})
                </button>
                <button
                  onClick={handleRunAutofill}
                  disabled={isAutofilling}
                  className="flex items-center gap-2 px-5 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/30 transition active:scale-95"
                >
                  <Zap className="w-4 h-4" />
                  {isAutofilling ? 'Synthesizing...' : '⚡ Trigger AutoFill AI'}
                </button>
              </div>
            </div>

            {/* Stepper Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div className="flex items-center gap-8">
                <button
                  onClick={() => setCurrentStep(1)}
                  className={`flex items-center gap-2.5 text-xs font-semibold pb-2 border-b-2 transition ${
                    currentStep === 1
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">1</span>
                  Personal & Contact
                </button>
                <button
                  onClick={() => setCurrentStep(2)}
                  className={`flex items-center gap-2.5 text-xs font-semibold pb-2 border-b-2 transition ${
                    currentStep === 2
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">2</span>
                  Logistics & Authorization
                </button>
                <button
                  onClick={() => setCurrentStep(3)}
                  className={`flex items-center gap-2.5 text-xs font-semibold pb-2 border-b-2 transition ${
                    currentStep === 3
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px]">3</span>
                  Role Questions & Resume
                </button>
              </div>

              <div className="text-xs text-slate-400 flex items-center gap-3">
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> High Confidence (≥75%)</span>
                <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span> Inferred / Q&A</span>
              </div>
            </div>

            {/* Live Form Container */}
            <div
              ref={formContainerRef}
              className="bg-slate-900/60 border border-slate-800 rounded-2xl p-8 relative shadow-xl"
            >
              {/* STEP 1: Personal & Contact */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-firstName" className="block text-xs font-bold text-slate-300 mb-1.5">
                        First Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="sim-firstName"
                        name="firstName"
                        type="text"
                        required
                        value={formData.firstName}
                        onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                        placeholder="e.g. Alex"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['firstName'] === 'high'
                            ? 'ring-2 ring-emerald-500 bg-emerald-950/20 border-emerald-500'
                            : 'border-slate-800 focus:border-blue-500'
                        }`}
                      />
                    </div>

                    <div className="form-control-wrap">
                      <label htmlFor="sim-lastName" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Last Name <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="sim-lastName"
                        name="lastName"
                        type="text"
                        required
                        value={formData.lastName}
                        onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                        placeholder="e.g. Rivera"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['lastName'] === 'high'
                            ? 'ring-2 ring-emerald-500 bg-emerald-950/20 border-emerald-500'
                            : 'border-slate-800 focus:border-blue-500'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-email" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Email Address <span className="text-red-400">*</span>
                      </label>
                      <input
                        id="sim-email"
                        name="email"
                        type="email"
                        required
                        value={formData.email}
                        onChange={e => setFormData({ ...formData, email: e.target.value })}
                        placeholder="alex@example.com"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['email'] === 'high'
                            ? 'ring-2 ring-emerald-500 bg-emerald-950/20 border-emerald-500'
                            : 'border-slate-800 focus:border-blue-500'
                        }`}
                      />
                    </div>

                    <div className="form-control-wrap">
                      <label htmlFor="sim-phone" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Phone Number
                      </label>
                      <input
                        id="sim-phone"
                        name="phone"
                        type="tel"
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        placeholder="+1 (555) 000-0000"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['phone'] === 'high'
                            ? 'ring-2 ring-emerald-500 bg-emerald-950/20 border-emerald-500'
                            : 'border-slate-800 focus:border-blue-500'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="form-control-wrap">
                    <label htmlFor="sim-address" className="block text-xs font-bold text-slate-300 mb-1.5">
                      Street Address
                    </label>
                    <input
                      id="sim-address"
                      name="address"
                      type="text"
                      value={formData.address}
                      onChange={e => setFormData({ ...formData, address: e.target.value })}
                      placeholder="123 Main St"
                      className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                        fieldHighlights['address'] === 'high'
                          ? 'ring-2 ring-emerald-500 bg-emerald-950/20 border-emerald-500'
                          : 'border-slate-800 focus:border-blue-500'
                      }`}
                    />
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-city" className="block text-xs font-bold text-slate-300 mb-1.5">City</label>
                      <input
                        id="sim-city"
                        name="city"
                        type="text"
                        value={formData.city}
                        onChange={e => setFormData({ ...formData, city: e.target.value })}
                        placeholder="San Francisco"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['city'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                    <div className="form-control-wrap">
                      <label htmlFor="sim-state" className="block text-xs font-bold text-slate-300 mb-1.5">State</label>
                      <input
                        id="sim-state"
                        name="state"
                        type="text"
                        value={formData.state}
                        onChange={e => setFormData({ ...formData, state: e.target.value })}
                        placeholder="CA"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['state'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                    <div className="form-control-wrap">
                      <label htmlFor="sim-zip" className="block text-xs font-bold text-slate-300 mb-1.5">Postal Code</label>
                      <input
                        id="sim-zip"
                        name="zip"
                        type="text"
                        value={formData.zip}
                        onChange={e => setFormData({ ...formData, zip: e.target.value })}
                        placeholder="94105"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['zip'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-linkedin" className="block text-xs font-bold text-slate-300 mb-1.5">LinkedIn Profile</label>
                      <input
                        id="sim-linkedin"
                        name="linkedIn"
                        type="url"
                        value={formData.linkedIn}
                        onChange={e => setFormData({ ...formData, linkedIn: e.target.value })}
                        placeholder="https://linkedin.com/in/..."
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['linkedIn'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                    <div className="form-control-wrap">
                      <label htmlFor="sim-github" className="block text-xs font-bold text-slate-300 mb-1.5">GitHub Profile</label>
                      <input
                        id="sim-github"
                        name="github"
                        type="url"
                        value={formData.github}
                        onChange={e => setFormData({ ...formData, github: e.target.value })}
                        placeholder="https://github.com/..."
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['github'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                    <div className="form-control-wrap">
                      <label htmlFor="sim-portfolio" className="block text-xs font-bold text-slate-300 mb-1.5">Portfolio / Website</label>
                      <input
                        id="sim-portfolio"
                        name="portfolio"
                        type="url"
                        value={formData.portfolio}
                        onChange={e => setFormData({ ...formData, portfolio: e.target.value })}
                        placeholder="https://..."
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['portfolio'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: Logistics & Work Authorization */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-yearsExp" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Total Years of Relevant Experience <span className="text-red-400">*</span>
                      </label>
                      <select
                        id="sim-yearsExp"
                        name="yearsExp"
                        required
                        value={formData.yearsExp}
                        onChange={e => setFormData({ ...formData, yearsExp: e.target.value })}
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['yearsExp'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      >
                        <option value="">Select experience level...</option>
                        <option value="0-1 years">0 - 1 years</option>
                        <option value="1-3 years">1 - 3 years</option>
                        <option value="3-5 years">3 - 5 years</option>
                        <option value="5-7 years">5 - 7 years</option>
                        <option value="7+ years">7+ years</option>
                      </select>
                    </div>

                    <div className="form-control-wrap">
                      <label htmlFor="sim-workAuth" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Current Work Authorization Status <span className="text-red-400">*</span>
                      </label>
                      <select
                        id="sim-workAuth"
                        name="workAuth"
                        required
                        value={formData.workAuth}
                        onChange={e => setFormData({ ...formData, workAuth: e.target.value })}
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['workAuth'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      >
                        <option value="">Select legal status...</option>
                        <option value="citizen">US Citizen / Permanent Resident</option>
                        <option value="h1b">H-1B Visa</option>
                        <option value="opt">F-1 OPT / CPT</option>
                        <option value="other">Other / Need Authorization</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="form-control-wrap">
                      <label className="block text-xs font-bold text-slate-300 mb-2">
                        Will you now or in the future require visa sponsorship?
                      </label>
                      <div className="flex items-center gap-6 mt-1">
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="sponsorship"
                            value="yes"
                            checked={formData.sponsorship === 'yes'}
                            onChange={e => setFormData({ ...formData, sponsorship: e.target.value })}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          Yes
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="sponsorship"
                            value="no"
                            checked={formData.sponsorship === 'no'}
                            onChange={e => setFormData({ ...formData, sponsorship: e.target.value })}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          No
                        </label>
                      </div>
                    </div>

                    <div className="form-control-wrap">
                      <label className="block text-xs font-bold text-slate-300 mb-2">
                        Are you willing to relocate if needed?
                      </label>
                      <div className="flex items-center gap-6 mt-1">
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="relocate"
                            value="yes"
                            checked={formData.relocate === 'yes'}
                            onChange={e => setFormData({ ...formData, relocate: e.target.value })}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          Yes
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="relocate"
                            value="no"
                            checked={formData.relocate === 'no'}
                            onChange={e => setFormData({ ...formData, relocate: e.target.value })}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          No
                        </label>
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                          <input
                            type="radio"
                            name="relocate"
                            value="remote"
                            checked={formData.relocate === 'remote'}
                            onChange={e => setFormData({ ...formData, relocate: e.target.value })}
                            className="text-blue-600 focus:ring-blue-500"
                          />
                          Remote Only
                        </label>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="form-control-wrap">
                      <label htmlFor="sim-startDate" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Available Start Date / Notice Period
                      </label>
                      <input
                        id="sim-startDate"
                        name="startDate"
                        type="date"
                        value={formData.startDate}
                        onChange={e => setFormData({ ...formData, startDate: e.target.value })}
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['startDate'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>

                    <div className="form-control-wrap">
                      <label htmlFor="sim-desiredSalary" className="block text-xs font-bold text-slate-300 mb-1.5">
                        Expected Annual Compensation (USD)
                      </label>
                      <input
                        id="sim-desiredSalary"
                        name="desiredSalary"
                        type="text"
                        value={formData.desiredSalary}
                        onChange={e => setFormData({ ...formData, desiredSalary: e.target.value })}
                        placeholder="$160,000"
                        className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                          fieldHighlights['desiredSalary'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 3: Role Questions & Resume File Upload */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <div className="form-control-wrap">
                    <label htmlFor="sim-roleInterest" className="block text-xs font-bold text-slate-300 mb-1.5">
                      Primary Engineering Specialty (Custom Combobox)
                    </label>
                    <select
                      id="sim-roleInterest"
                      name="roleInterest"
                      value={formData.roleInterest}
                      onChange={e => setFormData({ ...formData, roleInterest: e.target.value })}
                      className={`w-full bg-slate-950 border rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none transition ${
                        fieldHighlights['roleInterest'] === 'high' ? 'ring-2 ring-emerald-500 border-emerald-500' : 'border-slate-800'
                      }`}
                    >
                      <option value="Frontend">Frontend Platform</option>
                      <option value="Backend">Backend / Distributed Systems</option>
                      <option value="Full Stack">Full Stack Engineering</option>
                      <option value="DevOps">Cloud / DevOps / SRE</option>
                    </select>
                  </div>

                  <div className="form-control-wrap">
                    <label htmlFor="sim-whyJoin" className="block text-xs font-bold text-slate-300 mb-1.5">
                      Why are you interested in joining our engineering team? (Open-ended Q&A)
                    </label>
                    <textarea
                      id="sim-whyJoin"
                      name="whyJoin"
                      rows={4}
                      value={formData.whyJoin}
                      onChange={e => setFormData({ ...formData, whyJoin: e.target.value })}
                      placeholder="Share a brief statement about your interest in this role..."
                      className={`w-full bg-slate-950 border rounded-xl px-4 py-3 text-sm text-white focus:outline-none transition leading-relaxed ${
                        fieldHighlights['whyJoin'] === 'medium'
                          ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-950/10'
                          : 'border-slate-800'
                      }`}
                    />
                  </div>

                  <div className="form-control-wrap p-5 border border-dashed border-slate-700 rounded-2xl bg-slate-950/50">
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Upload Resume / CV (PDF)
                    </label>
                    <p className="text-xs text-slate-400 mb-3">AutoFill AI automatically attaches your stored resume via DataTransfer!</p>
                    <div className="flex items-center gap-3">
                      <input
                        type="file"
                        accept=".pdf"
                        id="sim-resume-input"
                        className="text-xs text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
                      />
                      {formData.resumeName && (
                        <span className="text-xs font-semibold text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-3 py-1.5 rounded-lg flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5" /> Attached: {formData.resumeName}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="form-control-wrap flex items-start gap-3 pt-2">
                    <input
                      id="sim-agreeCheck"
                      name="agreeCheck"
                      type="checkbox"
                      checked={formData.agreeCheck}
                      onChange={e => setFormData({ ...formData, agreeCheck: e.target.checked })}
                      className="mt-0.5 rounded text-blue-600 focus:ring-blue-500"
                    />
                    <label htmlFor="sim-agreeCheck" className="text-xs text-slate-300 leading-normal cursor-pointer">
                      I certify that all information submitted is true, complete, and accurate. I understand that any false statement or omission may disqualify me from employment.
                    </label>
                  </div>
                </div>
              )}

              {/* Form Navigation Footer */}
              <div className="flex items-center justify-between mt-8 pt-5 border-t border-slate-800">
                <button
                  type="button"
                  disabled={currentStep === 1}
                  onClick={() => setCurrentStep((currentStep - 1) as any)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 disabled:pointer-events-none transition"
                >
                  Previous Step
                </button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-500">Step {currentStep} of 3</span>
                  <button
                    type="button"
                    disabled={currentStep === 3}
                    onClick={() => setCurrentStep((currentStep + 1) as any)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-30 disabled:pointer-events-none transition"
                  >
                    Next Step <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* FLOATING STATUS BADGE (Simulating in-page extension pill) */}
              {floatingBadge && (
                <div className="absolute bottom-6 right-6 z-30 bg-slate-900 border border-slate-700 shadow-2xl rounded-full px-4 py-2.5 flex items-center gap-3 text-xs animate-in fade-in slide-in-from-bottom-2">
                  <div className="w-5 h-5 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center font-bold text-[10px] text-white">
                    AI
                  </div>
                  <span className="text-slate-200 font-medium">
                    Filled <strong className="text-emerald-400">{floatingBadge.filled}</strong>/{floatingBadge.total} fields
                  </span>
                  <button
                    onClick={() => setShowReviewModal(true)}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md font-semibold text-[11px] border border-slate-700 transition"
                  >
                    Review
                  </button>
                  <button
                    onClick={handleUndo}
                    className="px-2.5 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 rounded-md font-semibold text-[11px] border border-red-500/30 transition flex items-center gap-1"
                  >
                    <RotateCcw className="w-3 h-3" /> Undo
                  </button>
                  <button
                    onClick={() => setFloatingBadge(null)}
                    className="text-slate-400 hover:text-white ml-1 text-sm font-bold"
                  >
                    ✕
                  </button>
                </div>
              )}
            </div>

            {/* Scanned Descriptors Inspector */}
            {scannedDescriptors && (
              <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-400" />
                    <h3 className="font-bold text-xs text-white">DOM Field Descriptors Extracted by Content Script</h3>
                  </div>
                  <button
                    onClick={() => setScannedDescriptors(null)}
                    className="text-xs text-slate-500 hover:text-slate-300"
                  >
                    Close
                  </button>
                </div>
                <pre className="bg-slate-950 p-4 rounded-xl text-[11px] text-slate-300 font-mono overflow-x-auto max-h-60">
                  {JSON.stringify(scannedDescriptors, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: PROFILE & RESUME STUDIO */}
        {activeTab === 'profile' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left 4 Cols: Provider Settings & PDF Ingestion */}
            <div className="lg:col-span-5 space-y-6">
              {/* LLM Provider Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Cpu className="w-4 h-4 text-blue-400" />
                  <h2 className="font-bold text-sm text-white">AI Provider Configuration</h2>
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">Provider</label>
                    <select
                      value={provider}
                      onChange={e => setProvider(e.target.value as any)}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="gemini">Google Gemini (Recommended: gemini-3.8-flash)</option>
                      <option value="openai">OpenAI (gpt-4o-mini / gpt-4o)</option>
                      <option value="anthropic">Anthropic (claude-3-5-sonnet)</option>
                    </select>
                  </div>

                  {provider === 'gemini' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-semibold text-slate-400 mb-1.5">Gemini Model</label>
                      <select
                        value={geminiModel}
                        onChange={e => setGeminiModel(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="gemini-3.8-flash">gemini-3.8-flash (Recommended - Latest & High Precision)</option>
                        <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview (Advanced Complex Reasoning)</option>
                        <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite (Cost-Efficient & Ultra-Fast)</option>
                        <option value="custom">Custom Model Name...</option>
                      </select>

                      {geminiModel === 'custom' && (
                        <input
                          type="text"
                          value={customGeminiModel}
                          onChange={e => setCustomGeminiModel(e.target.value)}
                          placeholder="e.g. gemini-3.8-flash"
                          className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500 mt-1.5"
                        />
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-400 mb-1.5">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={e => setApiKey(e.target.value)}
                      placeholder="Enter API key for extension options..."
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                    <p className="text-[11px] text-slate-500 mt-1">
                      Stored only in <code className="text-slate-400">chrome.storage.local</code>. Never synced.
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct Multimodal PDF Ingestion Card */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-3">
                  <Upload className="w-4 h-4 text-indigo-400" />
                  <h2 className="font-bold text-sm text-white">Direct LLM Multimodal Ingestion</h2>
                </div>
                <p className="text-xs text-slate-400 mb-4 leading-relaxed">
                  Uses your LLM key to read the PDF document directly via multimodal vision/document intelligence, instantly merging the extracted facts into PROFILE.md without needing custom text extractors.
                </p>

                <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-6 text-center cursor-pointer bg-slate-950/40 transition">
                  <FileText className="w-8 h-8 text-blue-400 mx-auto mb-2 opacity-80" />
                  <div className="text-xs font-bold text-slate-200">Drop your Resume PDF here</div>
                  <div className="text-[11px] text-slate-500 mt-1">Direct LLM extraction &amp; instant Markdown merge</div>
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={e => {
                      const file = e.target.files?.[0];
                      if (file) {
                        showToast(`Extracted ${file.name} & merged into PROFILE.md via Gemini!`, 'success');
                      }
                    }}
                    className="hidden"
                    id="resume-pdf-upload"
                  />
                  <label htmlFor="resume-pdf-upload" className="inline-block mt-3 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg cursor-pointer">
                    Upload &amp; Merge PDF
                  </label>
                </div>
              </div>

              {/* Learned Answers Cache */}
              <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <h2 className="font-bold text-sm text-white">Learned Answers Cache</h2>
                  </div>
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400">
                    {Object.keys(learnedAnswers).length} rules
                  </span>
                </div>
                <p className="text-xs text-slate-400 mb-3">
                  Cached question-answer pairs resolved before calling the LLM.
                </p>
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {Object.entries(learnedAnswers).map(([k, v]) => (
                    <div key={k} className="p-2.5 bg-slate-950 border border-slate-800/80 rounded-xl text-xs flex items-center justify-between">
                      <div>
                        <div className="font-mono text-[11px] text-blue-400">{k}</div>
                        <div className="font-semibold text-slate-200 text-xs">{v.answer}</div>
                      </div>
                      <button
                        onClick={() => {
                          const copy = { ...learnedAnswers };
                          delete copy[k];
                          setLearnedAnswers(copy);
                          showToast(`Removed rule for "${k}"`, 'info');
                        }}
                        className="text-slate-500 hover:text-red-400 p-1"
                        title="Delete learned rule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right 7 Cols: Markdown Profile Editor */}
            <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col h-[760px]">
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <div>
                  <h2 className="font-bold text-sm text-white flex items-center gap-2">
                    <span>PROFILE.md Editor</span>
                    <span className="text-[11px] font-normal text-slate-400">
                      ({profileText.length.toLocaleString()} chars)
                    </span>
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Source of truth for all form fills. Mark unknown items as "UNKNOWN" to prevent guessing.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setProfileText(SAMPLE_PROFILE_DEFAULT);
                      showToast('Loaded standard candidate template!', 'info');
                    }}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg transition"
                  >
                    Reset Template
                  </button>
                  <button
                    onClick={() => showToast('Profile changes saved to local memory!', 'success')}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded-lg transition"
                  >
                    Save Changes
                  </button>
                </div>
              </div>

              <textarea
                value={profileText}
                onChange={e => setProfileText(e.target.value)}
                className="w-full flex-1 bg-slate-950 border border-slate-800 rounded-xl p-4 text-xs font-mono text-slate-200 leading-relaxed focus:outline-none focus:border-blue-500 resize-none"
                placeholder="# PERSONAL PROFILE..."
              />
            </div>
          </div>
        )}

        {/* TAB 3: EXTENSION SOURCE VIEWER */}
        {activeTab === 'code' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[760px]">
            {/* File List (Left 4 cols) */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-2xl p-4 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3 px-2">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Folder className="w-4 h-4 text-blue-400" /> extension/
                </span>
                <span className="text-[11px] text-slate-500">{Object.keys(EXTENSION_FILES).length} files</span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                {Object.keys(EXTENSION_FILES).sort().map(fileName => {
                  const isSelected = selectedFile === fileName;
                  return (
                    <button
                      key={fileName}
                      onClick={() => setSelectedFile(fileName)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-mono flex items-center justify-between transition ${
                        isSelected
                          ? 'bg-blue-600/20 text-blue-300 border border-blue-500/30 font-semibold'
                          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                      }`}
                    >
                      <span className="truncate">{fileName}</span>
                      {EXTENSION_FILES[fileName].isBinary && (
                        <span className="text-[9px] uppercase px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 ml-2">
                          bin
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* File Viewer (Right 8 cols) */}
            <div className="lg:col-span-8 bg-slate-900 border border-slate-800 rounded-2xl p-5 flex flex-col overflow-hidden">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-3">
                <div className="flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-emerald-400" />
                  <span className="font-mono text-xs font-bold text-white">{selectedFile}</span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      const content = EXTENSION_FILES[selectedFile]?.content || '';
                      navigator.clipboard.writeText(content);
                      setCopiedFile(true);
                      setTimeout(() => setCopiedFile(false), 2000);
                      showToast('File copied to clipboard!', 'info');
                    }}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-300 font-semibold transition"
                  >
                    {copiedFile ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedFile ? 'Copied' : 'Copy Code'}
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-auto bg-slate-950 border border-slate-800/80 rounded-xl p-4 font-mono text-xs text-slate-300 leading-relaxed">
                {EXTENSION_FILES[selectedFile]?.isBinary ? (
                  <div className="h-full flex items-center justify-center flex-col text-slate-500">
                    <p>Binary file (PNG Icon / asset)</p>
                    <p className="text-[11px] text-slate-600 mt-1">Included in the ZIP bundle automatically</p>
                  </div>
                ) : (
                  <pre className="whitespace-pre">{EXTENSION_FILES[selectedFile]?.content}</pre>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: INSTALLATION & DEBUG GUIDE */}
        {activeTab === 'guide' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
              <h2 className="text-xl font-bold text-white mb-2">How to Install AutoFill AI in Google Chrome</h2>
              <p className="text-sm text-slate-400 mb-6">
                AutoFill AI is a complete, native Manifest V3 Chrome Extension. You can install it directly using Developer Mode with zero build steps required.
              </p>

              <div className="space-y-6">
                {/* Step 1 */}
                <div className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Download the Extension Package</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Click the <strong className="text-blue-400">Download Extension (.zip)</strong> button in the top right. Extract the ZIP file to a folder on your computer (e.g. <code className="text-slate-300">~/Downloads/autofill-ai-extension</code>).
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Open Chrome Extensions Manager</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Navigate to <code className="text-blue-300 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">chrome://extensions</code> in your Chrome address bar.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Enable Developer Mode & Load Unpacked</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Toggle the <strong className="text-white">Developer mode</strong> switch in the top right corner. Then click <strong className="text-white">Load unpacked</strong> and select the extracted <code className="text-slate-300">autofill-ai-extension</code> folder.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    4
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Get a Free Gemini API Key & Set Up Profile</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Get a free Gemini API key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-blue-400 underline inline-flex items-center gap-1">Google AI Studio <ExternalLink className="w-3 h-3" /></a>. Open the extension Options page, paste your API key, and upload your resume PDF to generate your profile.
                    </p>
                  </div>
                </div>

                {/* Step 5 */}
                <div className="flex gap-4 items-start">
                  <div className="w-7 h-7 rounded-full bg-blue-600/20 text-blue-400 border border-blue-500/40 flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    5
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-white">Autofill Any Web Page!</h3>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                      Open any job portal (Workday, Greenhouse, Lever, Ashby, LinkedIn) and click the extension popup <strong className="text-white">"Fill This Page"</strong>, or press <kbd className="bg-slate-800 px-2 py-0.5 rounded text-white border border-slate-700">Alt+Shift+F</kbd>, or right-click anywhere and select <strong className="text-white">AutoFill AI: Fill forms on this page</strong>!
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Debugging & Limitations */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8">
              <h2 className="text-lg font-bold text-white mb-4">Known Limitations & Debugging</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs text-slate-300">
                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h4 className="font-bold text-blue-400 mb-1">Service Worker Console</h4>
                  <p className="text-slate-400 leading-relaxed">
                    To inspect LLM API requests and background messages, go to <code className="text-slate-300">chrome://extensions</code>, find AutoFill AI, and click <strong className="text-white">"service worker"</strong> under "Inspect views".
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h4 className="font-bold text-blue-400 mb-1">Content Script Logs</h4>
                  <p className="text-slate-400 leading-relaxed">
                    Open Chrome DevTools on the target webpage (<kbd className="bg-slate-800 px-1 rounded">F12</kbd> or right-click &gt; Inspect). All DOM field discovery and synthetic event dispatches are logged with the prefix <code className="text-slate-300">[AutoFill AI]</code>.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h4 className="font-bold text-amber-400 mb-1">Cross-Origin Iframes</h4>
                  <p className="text-slate-400 leading-relaxed">
                    Due to browser security policies, cross-origin iframes without permissions cannot be inspected directly. The content script runs with <code className="text-slate-300">all_frames: true</code> to fill same-origin and embeddable forms.
                  </p>
                </div>

                <div className="bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <h4 className="font-bold text-emerald-400 mb-1">Controlled Form State</h4>
                  <p className="text-slate-400 leading-relaxed">
                    React 16+, Vue, and Angular override the <code className="text-slate-300">value</code> property setter. AutoFill AI invokes the prototype descriptor directly and dispatches bubbling <code className="text-slate-300">input</code>, <code className="text-slate-300">change</code>, and <code className="text-slate-300">blur</code> events so state updates immediately.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Review Modal (In Simulator) */}
      {showReviewModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <h3 className="font-bold text-sm text-white">AutoFill AI — Review & Corrections</h3>
              </div>
              <button
                onClick={() => setShowReviewModal(false)}
                className="text-slate-400 hover:text-white text-base font-bold"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4 flex-1">
              <p className="text-xs text-slate-400">
                You can edit any field below. Changes will immediately update the form and be remembered in the <strong className="text-white">Learned Answers</strong> cache for future applications!
              </p>

              {reviewFields.map((field) => (
                <div key={field.id} className="p-4 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-200">{field.label}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        field.confidence >= 0.9
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                      }`}
                    >
                      {Math.round(field.confidence * 100)}% match
                    </span>
                  </div>

                  {field.id === 'resumeName' ? (
                    <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg p-2.5">
                      <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> 📄 {field.value}
                      </span>
                      <button
                        onClick={() => showToast('Re-attached resume file via DataTransfer!', 'success')}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold rounded-lg transition"
                      >
                        ⚡ Attach again
                      </button>
                    </div>
                  ) : (
                    <input
                      type="text"
                      defaultValue={field.value}
                      onBlur={(e) => handleSaveCorrection(field.id, e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  )}

                  {field.reason && (
                    <div className="text-[11px] text-slate-500 italic">
                      AI Reasoning: {field.reason}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-slate-800 flex justify-end gap-3 bg-slate-950/60">
              <button
                onClick={() => setShowReviewModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
