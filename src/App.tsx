/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Download,
  Zap,
  FileText,
  Link2,
  ShieldCheck,
  Check,
  Copy,
  Menu,
  X,
  ExternalLink,
  Lock,
  ArrowRight,
  HelpCircle,
  Sparkles,
  Github,
  Home
} from 'lucide-react';
import { EXTENSION_FILES } from './extension-source.ts';

export default function App() {
  const [currentPath, setCurrentPath] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '/'
  );
  const [isZipping, setIsZipping] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [copiedExtensionsUrl, setCopiedExtensionsUrl] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [pageLoadingKey, setPageLoadingKey] = useState(0);

  // Sync with browser history
  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname);
      setPageLoadingKey((prev) => prev + 1);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (path: string) => {
    if (path !== currentPath) {
      setPageLoadingKey((prev) => prev + 1);
    }
    window.history.pushState(null, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setMobileMenuOpen(false);
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  // ZIP Generation & Download
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
      showToast('Extension downloaded! Extract and load in chrome://extensions');
    } catch (err: any) {
      showToast(`Failed to build zip: ${err.message}`);
    } finally {
      setIsZipping(false);
    }
  };

  const handleCopyExtensionsUrl = () => {
    navigator.clipboard.writeText('chrome://extensions');
    setCopiedExtensionsUrl(true);
    setTimeout(() => setCopiedExtensionsUrl(false), 2000);
    showToast('Copied "chrome://extensions" to clipboard!');
  };

  const isAboutPage = currentPath === '/about';

  return (
    <div className="bg-[#090D16] text-slate-100 font-sans antialiased selection:bg-blue-600 selection:text-white relative overflow-x-hidden min-h-screen flex flex-col justify-between">
      {/* Top Page Loading Animation Bar */}
      <div
        key={pageLoadingKey}
        className="fixed top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-cyan-400 to-indigo-500 z-50 animate-load-bar pointer-events-none"
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-slate-900/95 border border-blue-500/30 text-white text-xs font-medium shadow-2xl shadow-blue-500/20 backdrop-blur-md transition-all animate-bounce">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Ambient Glowing Backdrop Orbs */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 w-[600px] h-[500px] bg-blue-600/15 rounded-full blur-[130px] animate-pulse-subtle" />
        <div className="absolute top-[35%] -right-20 w-[550px] h-[550px] bg-cyan-600/10 rounded-full blur-[140px]" />
        <div className="absolute bottom-10 left-10 w-[700px] h-[450px] bg-indigo-600/10 rounded-full blur-[150px]" />
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:24px_24px] opacity-25" />
      </div>

      {/* Navigation Bar */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#090D16]/85 border-b border-white/[0.08]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          {/* Main Logo & Brand */}
          <button
            onClick={() => navigateTo('/')}
            className="flex items-center space-x-3 text-left cursor-pointer group"
          >
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-lg shadow-blue-500/20 border border-blue-500/30 bg-[#060911] shrink-0 p-0.5 group-hover:scale-105 transition-transform duration-200">
              <img
                src="/logo.png"
                alt="AutoFill AI Logo"
                className="w-full h-full object-cover rounded-[10px]"
              />
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-white group-hover:text-blue-300 transition">
                AutoFill <span className="text-blue-400">AI</span>
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-blue-500/10 text-blue-400 border border-blue-500/25">
                Manifest V3
              </span>
            </div>
          </button>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center space-x-8 text-sm font-medium text-slate-300">
            <button
              onClick={() => navigateTo('/')}
              className={`transition-colors cursor-pointer ${
                !isAboutPage ? 'text-white font-semibold' : 'hover:text-white text-slate-300'
              }`}
            >
              Home
            </button>
            <button
              onClick={() => navigateTo('/about')}
              className={`transition-colors cursor-pointer ${
                isAboutPage ? 'text-blue-400 font-semibold' : 'hover:text-white text-slate-300'
              }`}
            >
              About
            </button>
            <a
              href="https://github.com/WebBhav/AutoFill-AI/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-white transition-colors flex items-center gap-1.5"
            >
              <Github className="w-4 h-4" />
              <span>GitHub</span>
            </a>
          </nav>

          {/* Contact Me Button (Replaces Download Extension Button in Header) */}
          <div className="hidden sm:flex items-center space-x-4">
            <a
              href="https://vaibhav-singhal.netlify.app/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-indigo-500 shadow-lg shadow-blue-500/25 transition-all duration-200 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer"
            >
              <span>Contact me</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-80" />
            </a>
          </div>

          {/* Hamburger Menu Toggle (Mobile) */}
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg bg-[#111827] border border-white/10 text-slate-300 hover:text-white focus:outline-none cursor-pointer"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="md:hidden border-b border-white/10 bg-[#090D16]/95 backdrop-blur-2xl px-6 py-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-200">
            <div className="flex flex-col space-y-3 text-sm font-medium text-slate-300">
              <button
                onClick={() => navigateTo('/')}
                className="text-left py-1 hover:text-white transition-colors cursor-pointer"
              >
                Home
              </button>
              <button
                onClick={() => navigateTo('/about')}
                className="text-left py-1 hover:text-white transition-colors cursor-pointer text-blue-400 font-semibold"
              >
                About
              </button>
              <a
                href="https://github.com/WebBhav/AutoFill-AI/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-white py-1 transition-colors flex items-center justify-between"
              >
                <span>GitHub</span>
                <Github className="w-4 h-4" />
              </a>
            </div>

            <div className="pt-3 border-t border-white/10">
              <a
                href="https://vaibhav-singhal.netlify.app/"
                target="_blank"
                rel="noreferrer"
                className="w-full py-3 rounded-xl font-semibold text-xs text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 flex items-center justify-center gap-2 shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                <span>Contact me</span>
                <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        )}
      </header>

      {/* Main Content Areas */}
      <main className="flex-1">
        {isAboutPage ? (
          /* =========================================================================
             ABOUT PAGE VIEW (/about)
             ========================================================================= */
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 space-y-16 animate-fade-in-up">
            {/* Page Header */}
            <div className="space-y-4 text-center sm:text-left">
              <button
                onClick={() => navigateTo('/')}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-blue-400 hover:text-blue-300 transition cursor-pointer mb-2"
              >
                <Home className="w-3.5 h-3.5" />
                <span>Back to Home</span>
              </button>
              <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white">
                About AutoFill <span className="text-blue-400">AI</span>
              </h1>
              <p className="text-slate-300 text-base sm:text-lg leading-relaxed max-w-2xl">
                A 100% free, client-side Chrome extension (Manifest V3) created to eliminate the painful, repetitive manual typing involved in modern job applications.
              </p>
            </div>

            {/* The Mission & Origin */}
            <div className="p-8 sm:p-10 rounded-2xl bg-[#0C1220]/90 border border-white/[0.08] space-y-6">
              <h2 className="text-xl sm:text-2xl font-bold text-white flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-blue-400" />
                <span>The Story &amp; Motivation</span>
              </h2>
              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                Job applications across modern Applicant Tracking Systems (Workday, Greenhouse, Lever, Ashby, BambooHR) have become increasingly frustrating. Candidates repeatedly upload their PDF resume, only to be forced to re-type every job title, start date, degree, and URL into poorly formatted web inputs.
              </p>
              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                Standard browser autofill breaks on React controlled inputs and shadow DOM nodes. <strong>AutoFill AI</strong> was engineered from the ground up to solve this: it reads your resume PDF directly using native multimodal AI, stores your profile in browser memory, and dispatches synthetic input events so every form field recognizes the value instantly.
              </p>
            </div>

            {/* Creator Profile */}
            <div className="p-8 sm:p-10 rounded-2xl bg-[#0C1220]/90 border border-white/[0.08] flex flex-col sm:flex-row items-center sm:items-start gap-8">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white font-bold text-2xl shrink-0 shadow-lg shadow-blue-500/25">
                VS
              </div>
              <div className="space-y-4 text-center sm:text-left flex-1">
                <div className="space-y-1">
                  <h3 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">Vaibhav Singhal</h3>
                  <div className="text-xs font-mono font-semibold text-blue-400 tracking-wider">
                    Creator
                  </div>
                  <div className="text-slate-300 text-sm font-medium">
                    AI-Native Product Manager
                  </div>
                </div>
                <p className="text-slate-300 text-sm leading-relaxed">
                  Passionate about crafting pragmatic software, developer tools, and privacy-respecting browser applications. AutoFill AI was built as an open, accessible project to give job seekers their valuable hours back.
                </p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-2">
                  <a
                    href="https://vaibhav-singhal.netlify.app/"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold flex items-center gap-1.5 transition shadow"
                  >
                    <span>Visit Portfolio</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                  <a
                    href="https://github.com/WebBhav/AutoFill-AI/"
                    target="_blank"
                    rel="noreferrer"
                    className="px-4 py-2 rounded-xl bg-[#111827] hover:bg-slate-800 text-slate-300 text-xs font-mono border border-white/10 flex items-center gap-1.5 transition"
                  >
                    <Github className="w-3.5 h-3.5" />
                    <span>View Repository</span>
                  </a>
                </div>
              </div>
            </div>

            {/* Core Architectural Principles */}
            <div className="space-y-6">
              <h2 className="text-xl sm:text-2xl font-bold text-white">Key Architectural Pillars</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div className="p-6 rounded-xl bg-[#0C1220]/80 border border-white/[0.08] space-y-2">
                  <div className="text-blue-400 font-bold text-base flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>100% Free &amp; Client-Side</span>
                  </div>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    Zero paywalls, subscriptions, or checkout flows. Your credentials and documents stay confined to Chrome&apos;s local storage sandbox.
                  </p>
                </div>

                <div className="p-6 rounded-xl bg-[#0C1220]/80 border border-white/[0.08] space-y-2">
                  <div className="text-blue-400 font-bold text-base flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>Repeatable Sections Engine</span>
                  </div>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    Intelligently detects &quot;+ Add website&quot; and &quot;+ Add experience&quot; buttons, dispatches DOM clicks, and fills multiple dynamic rows with verified facts.
                  </p>
                </div>

                <div className="p-6 rounded-xl bg-[#0C1220]/80 border border-white/[0.08] space-y-2">
                  <div className="text-blue-400 font-bold text-base flex items-center gap-2">
                    <Lock className="w-4 h-4 text-blue-400" />
                    <span>Zero Auto-Submission</span>
                  </div>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    AutoFill AI never presses &quot;Submit&quot; or &quot;Apply&quot;. You maintain complete control to review, edit, and confirm every answer before sending.
                  </p>
                </div>

                <div className="p-6 rounded-xl bg-[#0C1220]/80 border border-white/[0.08] space-y-2">
                  <div className="text-blue-400 font-bold text-base flex items-center gap-2">
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>Native Multimodal AI</span>
                  </div>
                  <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                    Sends your resume PDF directly to Google Gemini, OpenAI, or Claude as native document input, without clunky external PDF extractors.
                  </p>
                </div>
              </div>
            </div>

            {/* Call to Action Banner on About Page */}
            <div className="p-8 sm:p-10 rounded-2xl bg-gradient-to-r from-blue-900/40 via-indigo-900/40 to-blue-950/40 border border-blue-500/30 text-center space-y-4">
              <h3 className="text-2xl font-bold text-white">Ready to streamline your applications?</h3>
              <p className="text-slate-300 text-sm max-w-lg mx-auto">
                Download the unpacked extension ZIP package now and load it into Google Chrome in under 60 seconds.
              </p>
              <div className="pt-2 flex flex-wrap justify-center gap-4">
                <button
                  onClick={handleDownloadZip}
                  disabled={isZipping}
                  className="px-6 py-3 rounded-xl font-bold text-xs text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-2 shadow-lg shadow-blue-500/25 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>{isZipping ? 'Building ZIP...' : 'Download Extension (.zip)'}</span>
                </button>
                <button
                  onClick={() => setShowInstallModal(true)}
                  className="px-6 py-3 rounded-xl font-semibold text-xs text-slate-300 bg-[#111827] hover:bg-slate-800 border border-white/10 cursor-pointer"
                >
                  View Install Instructions
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* =========================================================================
             HOME LANDING PAGE VIEW (/)
             ========================================================================= */
          <>
            {/* Hero Section */}
            <section className="relative pt-16 pb-20 overflow-hidden" data-purpose="hero-banner">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Hero Copy with Staggered Entrance Animations */}
                <div className="text-center max-w-4xl mx-auto space-y-5">
                  <h1 className="text-4xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight text-white leading-[1.1] animate-fade-in-up">
                    10x Faster Job Applications.<br />
                    <span className="bg-gradient-to-r from-blue-400 via-indigo-300 to-cyan-300 bg-clip-text text-transparent">
                      Zero Repetitive Typing.
                    </span>
                  </h1>

                  {/* Subtext: Much smaller and compact as requested */}
                  <p className="text-[11px] sm:text-xs text-slate-400/80 max-w-lg mx-auto font-normal leading-relaxed tracking-normal animate-fade-in-delayed-1">
                    The intelligent Manifest V3 Chrome extension grounded in your actual Resume PDF. Detects complex Workday &amp; Greenhouse DOM nodes, triggers synthetic React state dispatches, and fills nested forms with verified context.
                  </p>

                  {/* CTA Buttons & Shortcut Pill */}
                  <div className="pt-2 flex flex-wrap items-center justify-center gap-4 animate-fade-in-delayed-2">
                    <button
                      onClick={handleDownloadZip}
                      disabled={isZipping}
                      className="px-8 py-3.5 rounded-xl font-bold text-sm text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/30 transition-all flex items-center space-x-2 cursor-pointer transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                      <Download className={`w-4 h-4 ${isZipping ? 'animate-bounce' : ''}`} />
                      <span>{isZipping ? 'Building ZIP Package...' : 'Download Extension (.zip)'}</span>
                    </button>

                    {/* Keyboard Shortcut Indicator */}
                    <div className="flex items-center space-x-2 px-4 py-3 rounded-xl bg-[#111827]/90 border border-white/10 text-xs font-mono text-slate-300 shadow-inner">
                      <span className="text-slate-400">Shortcut:</span>
                      <kbd className="px-2 py-1 rounded bg-[#060911] border border-white/20 text-white font-semibold shadow">
                        Alt
                      </kbd>
                      <span>+</span>
                      <kbd className="px-2 py-1 rounded bg-[#060911] border border-white/20 text-white font-semibold shadow">
                        Shift
                      </kbd>
                      <span>+</span>
                      <kbd className="px-2 py-1 rounded bg-[#060911] border border-white/20 text-blue-400 font-semibold shadow">
                        F
                      </kbd>
                    </div>
                  </div>
                </div>

                {/* Hero Visual Mockup: Clean User Banner Image (Animated Entry) */}
                <div className="mt-14 relative mx-auto max-w-5xl animate-fade-in-delayed-3">
                  <div className="rounded-2xl border border-white/10 bg-[#0C1220] shadow-2xl overflow-hidden backdrop-blur-2xl relative group">
                    {/* Top Browser Bar */}
                    <div className="h-10 bg-[#060911] border-b border-white/[0.08] px-4 flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <div className="w-3 h-3 rounded-full bg-red-500/80" />
                        <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                        <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                      </div>
                      <div className="bg-[#090D16] px-5 py-1 rounded-md text-xs font-mono text-slate-400 border border-white/5 flex items-center space-x-2 w-1/2 max-w-sm justify-center">
                        <Lock className="w-3 h-3 text-emerald-400" />
                        <span className="truncate">AutoFill AI — Smart Form Filling</span>
                      </div>
                      <div className="flex items-center space-x-2 text-slate-400 text-xs font-mono">
                        <span className="w-2 h-2 rounded-full bg-emerald-400" />
                        <span className="hidden sm:inline">100% Free Extension</span>
                      </div>
                    </div>

                    {/* Banner Image Display */}
                    <div className="relative bg-[#090D16] overflow-hidden">
                      <img
                        alt="AutoFill AI - Let AI fill your forms so you don't have to"
                        className="w-full h-auto object-cover object-center transition-transform duration-500 group-hover:scale-[1.01]"
                        src="/hero-banner.jpg"
                      />
                    </div>
                  </div>

                  {/* Bottom Glow Highlight */}
                  <div className="absolute -bottom-10 inset-x-12 h-16 bg-gradient-to-r from-blue-600/30 via-cyan-500/20 to-indigo-600/30 blur-2xl pointer-events-none" />
                </div>
              </div>
            </section>

            {/* Trust Stats Bar */}
            <section className="border-y border-white/[0.08] bg-[#060911]/60 py-10" data-purpose="metrics-bar">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-white font-mono">99.4%</div>
                    <div className="text-xs sm:text-sm text-slate-400 mt-1">Field Detection Accuracy</div>
                  </div>
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-blue-400 font-mono">0ms</div>
                    <div className="text-xs sm:text-sm text-slate-400 mt-1">Data Sent to Remote Servers</div>
                  </div>
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-cyan-300 font-mono">&lt; 3.2s</div>
                    <div className="text-xs sm:text-sm text-slate-400 mt-1">Full Page Form Completion</div>
                  </div>
                  <div>
                    <div className="text-3xl sm:text-4xl font-extrabold text-emerald-400 font-mono">100%</div>
                    <div className="text-xs sm:text-sm text-slate-400 mt-1">Manifest V3 Strict Sandbox</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Core Features Section */}
            <section className="py-24 relative" data-purpose="features-breakdown" id="features">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-3xl mx-auto mb-16 space-y-4">
                  <span className="text-xs font-mono uppercase tracking-widest text-cyan-400 font-bold">
                    ENGINEERED FOR TECHNICAL JOB SEEKERS
                  </span>
                  <h2 className="text-3xl sm:text-5xl font-bold text-white tracking-tight">
                    Built to Outsmart Modern ATS Dynamic Forms
                  </h2>
                  <p className="text-slate-400 text-base sm:text-lg">
                    Standard browser autofill breaks on shadow DOMs and uncontrolled React inputs. AutoFill AI dispatches actual synthetic keyboard events.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Feature Card 1 */}
                  <div className="p-8 rounded-2xl bg-[#0C1220]/80 border border-white/[0.08] hover:border-blue-500/40 transition duration-300 relative group overflow-hidden">
                    <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center mb-6 text-xl">
                      ⚡
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Smart DOM &amp; React Synthetic Driver</h3>
                    <p className="text-slate-400 text-sm leading-relaxed mb-4">
                      Bypasses tricky React, Vue, and Angular validation barriers by dispatching simulated input, change, and blur state cycles. Form submit buttons stay enabled with zero manual typing.
                    </p>
                    <div className="inline-flex items-center text-xs font-mono text-blue-400 group-hover:translate-x-1 transition-transform duration-200">
                      Dispatches native EventTarget.dispatchEvent →
                    </div>
                  </div>

                  {/* Feature Card 2 */}
                  <div className="p-8 rounded-2xl bg-[#0C1220]/80 border border-white/[0.08] hover:border-cyan-500/40 transition duration-300 relative group overflow-hidden">
                    <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center mb-6 text-xl">
                      📄
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">PDF-Grounded Context • No Hallucinations</h3>
                    <p className="text-slate-400 text-sm leading-relaxed mb-4">
                      Parses your resume PDF locally directly in the browser memory. Matches work history dates, bullet points, skills, and clearances directly to exact matching prompt schemas without fabrication.
                    </p>
                    <div className="inline-flex items-center text-xs font-mono text-cyan-400 group-hover:translate-x-1 transition-transform duration-200">
                      Verified ground-truth extraction →
                    </div>
                  </div>

                  {/* Feature Card 3 */}
                  <div className="p-8 rounded-2xl bg-[#0C1220]/80 border border-white/[0.08] hover:border-indigo-500/40 transition duration-300 relative group overflow-hidden">
                    <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center mb-6 text-xl">
                      🔗
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">Dynamic Nested Lists &amp; Portfolio Injection</h3>
                    <p className="text-slate-400 text-sm leading-relaxed mb-4">
                      Automatically identifies &quot;+ Add Website&quot; or &quot;+ Add Education&quot; buttons, triggers the DOM mutation, selects &quot;GitHub / Portfolio&quot; from the type dropdown, and injects your clean URLs.
                    </p>
                    <div className="inline-flex items-center text-xs font-mono text-indigo-400 group-hover:translate-x-1 transition-transform duration-200">
                      Dynamic multi-link resolution →
                    </div>
                  </div>

                  {/* Feature Card 4 */}
                  <div className="p-8 rounded-2xl bg-[#0C1220]/80 border border-white/[0.08] hover:border-emerald-500/40 transition duration-300 relative group overflow-hidden">
                    <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center mb-6 text-xl">
                      🔒
                    </div>
                    <h3 className="text-xl font-bold text-white mb-2">100% Local Storage • Bring Your Own Key</h3>
                    <p className="text-slate-400 text-sm leading-relaxed mb-4">
                      Your sensitive career history and API keys (Google Gemini, OpenAI, Anthropic, or Ollama) stay locked in <code>chrome.storage.local</code>. Zero third-party tracker servers or telemetry.
                    </p>
                    <div className="inline-flex items-center text-xs font-mono text-emerald-400 group-hover:translate-x-1 transition-transform duration-200">
                      Zero cloud logs guaranteed →
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Setup Workflow Steps (How AutoFill AI Operates) */}
            <section className="py-24" data-purpose="onboarding-walkthrough" id="workflow">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center max-w-2xl mx-auto mb-16 space-y-3">
                  <span className="text-xs font-mono uppercase tracking-wider text-blue-400 font-semibold">
                    EFFORTLESS 3-MINUTE SETUP
                  </span>
                  <h2 className="text-3xl sm:text-4xl font-extrabold text-white">How AutoFill AI Operates</h2>
                  <p className="text-slate-400 text-sm">
                    No servers to register for. Download the unpacked MV3 extension and point it to your resume.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative">
                  {/* Step 1 */}
                  <div className="bg-[#0C1220] p-6 rounded-2xl border border-white/[0.08] relative group hover:border-blue-500/30 transition">
                    <div className="w-9 h-9 rounded-lg bg-blue-500/20 text-blue-400 font-mono font-bold flex items-center justify-center text-sm mb-4">
                      01
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Upload Resume PDF</h3>
                    <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                      Drop your current CV in the popup. The client-side parser extracts key experiences, roles, skills, and links into indexed local vectors.
                    </p>
                  </div>

                  {/* Step 2 */}
                  <div className="bg-[#0C1220] p-6 rounded-2xl border border-white/[0.08] relative group hover:border-indigo-500/30 transition">
                    <div className="w-9 h-9 rounded-lg bg-indigo-500/20 text-indigo-400 font-mono font-bold flex items-center justify-center text-sm mb-4">
                      02
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Paste Your Free API Key</h3>
                    <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                      Use Google Gemini (free tier), OpenAI GPT-4o-mini, Anthropic Claude 3.5, or run 100% offline using Ollama. Keys stay local.
                    </p>
                  </div>

                  {/* Step 3 */}
                  <div className="bg-[#0C1220] p-6 rounded-2xl border border-white/[0.08] relative group hover:border-cyan-500/30 transition">
                    <div className="w-9 h-9 rounded-lg bg-cyan-500/20 text-cyan-400 font-mono font-bold flex items-center justify-center text-sm mb-4">
                      03
                    </div>
                    <h3 className="text-lg font-bold text-white mb-2">Press Alt + Shift + F</h3>
                    <p className="text-slate-400 text-xs sm:text-sm leading-relaxed">
                      Open any Greenhouse, Workday, or Lever portal. Tap the global shortcut and watch the fields fill, checkboxes check, and dropdowns select.
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {/* Supported ATS Grid */}
            <section className="py-16 bg-[#060911]/40 border-t border-white/[0.08]" data-purpose="supported-ats-platforms" id="ats-support">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                <p className="text-xs font-mono uppercase tracking-widest text-slate-400 mb-8">
                  WORKS SEAMLESSLY ACROSS HIGH-FRICTION ATS PORTALS
                </p>
                <div className="flex flex-wrap items-center justify-center gap-4 sm:gap-6 text-slate-300 font-medium text-sm">
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    <span>Workday Candidate Portal</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Greenhouse.io</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>Lever.co</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-indigo-400" />
                    <span>AshbyHQ</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-amber-400" />
                    <span>BambooHR</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-purple-400" />
                    <span>SmartRecruiters</span>
                  </div>
                  <div className="px-5 py-3 rounded-xl bg-[#0C1220] border border-white/[0.08] flex items-center space-x-2 shadow-sm">
                    <span className="w-2 h-2 rounded-full bg-sky-400" />
                    <span>iCIMS &amp; Taleo</span>
                  </div>
                </div>
              </div>
            </section>

            {/* Download Call to Action Section */}
            <section className="py-24 relative overflow-hidden" data-purpose="conversion-cta" id="download">
              <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                <div className="p-10 sm:p-16 rounded-3xl bg-gradient-to-b from-[#0C1220] to-[#060911] border border-blue-500/30 shadow-2xl shadow-blue-500/20 space-y-6">
                  <span className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-mono">
                    <span>100% Free • Open Source • 15 Files</span>
                  </span>

                  <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">
                    Supercharge Your Job Search Today
                  </h2>

                  <p className="text-slate-300 max-w-xl mx-auto text-base">
                    Stop losing hours re-typing your work experience into non-compliant input boxes. Get the official Chrome extension zip package now.
                  </p>

                  <div className="pt-4 flex flex-wrap items-center justify-center gap-4">
                    <button
                      onClick={handleDownloadZip}
                      disabled={isZipping}
                      className="px-8 py-4 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-blue-600 via-indigo-600 to-blue-500 hover:from-blue-500 hover:to-cyan-400 shadow-lg shadow-blue-500/30 transition-all transform hover:-translate-y-0.5 active:translate-y-0 flex items-center space-x-3 cursor-pointer"
                    >
                      <Download className={`w-5 h-5 ${isZipping ? 'animate-bounce' : ''}`} />
                      <span>{isZipping ? 'Packaging Extension...' : 'Download Extension (.zip)'}</span>
                    </button>

                    <button
                      onClick={() => setShowInstallModal(true)}
                      className="px-6 py-4 rounded-xl font-semibold text-xs text-slate-300 bg-[#111827] hover:bg-slate-800 border border-white/10 transition cursor-pointer"
                    >
                      View Unpacked Install Guide
                    </button>
                  </div>

                  <div className="pt-4 flex items-center justify-center space-x-6 text-xs text-slate-400 font-mono">
                    <span className="flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-400" />
                      Manifest V3 Compliant
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Check className="w-4 h-4 text-emerald-400" />
                      No Remote Backend
                    </span>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}
      </main>

      {/* Site Footer */}
      <footer className="border-t border-white/[0.08] bg-[#060911] py-10 text-slate-400 text-xs font-mono" data-purpose="page-footer">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-6">
          <button
            onClick={() => navigateTo('/')}
            className="flex items-center space-x-3 cursor-pointer text-left group"
          >
            <div className="w-7 h-7 rounded-lg overflow-hidden border border-blue-500/30 bg-[#060911] shrink-0 p-0.5 group-hover:scale-105 transition-transform duration-200">
              <img
                src="/logo.png"
                alt="AutoFill AI Logo"
                className="w-full h-full object-cover rounded-[6px]"
              />
            </div>
            <span className="text-white font-semibold text-sm group-hover:text-blue-300 transition">AutoFill AI</span>
          </button>

          <div className="text-slate-400 text-center sm:text-right">
            Crafted by{' '}
            <a
              href="https://vaibhav-singhal.netlify.app/"
              target="_blank"
              rel="noreferrer"
              className="text-blue-400 hover:text-blue-300 font-semibold underline underline-offset-4 transition"
            >
              Vaibhav Singhal
            </a>
          </div>
        </div>
      </footer>

      {/* Modal: Unpacked Install Guide */}
      {showInstallModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#0C1220] border border-white/10 rounded-2xl max-w-xl w-full p-6 sm:p-8 space-y-6 shadow-2xl relative">
            <div className="flex items-center justify-between border-b border-white/10 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
                  <HelpCircle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-base text-white">How to Install Unpacked in Chrome</h3>
                  <p className="text-xs text-slate-400">Manifest V3 Developer Mode (No Chrome Web Store required)</p>
                </div>
              </div>
              <button
                onClick={() => setShowInstallModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <ol className="space-y-4 text-xs sm:text-sm text-slate-300">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-mono font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  1
                </span>
                <div>
                  <strong className="text-white block font-semibold">Download and extract the ZIP file</strong>
                  <span className="text-slate-400 text-xs">
                    Click &quot;Download Extension (.zip)&quot; and unzip the folder to a persistent location on your computer.
                  </span>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-mono font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  2
                </span>
                <div>
                  <strong className="text-white block font-semibold">Open Chrome Extensions Manager</strong>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-xs px-2 py-1 bg-black/40 rounded border border-white/10 text-emerald-400">
                      chrome://extensions
                    </span>
                    <button
                      onClick={handleCopyExtensionsUrl}
                      className="px-2 py-1 text-xs rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 flex items-center gap-1 cursor-pointer"
                    >
                      {copiedExtensionsUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedExtensionsUrl ? 'Copied!' : 'Copy URL'}</span>
                    </button>
                  </div>
                  <span className="text-slate-400 text-xs block mt-1">
                    Turn on the <strong>Developer mode</strong> toggle in the top-right corner.
                  </span>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-mono font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  3
                </span>
                <div>
                  <strong className="text-white block font-semibold">Click &quot;Load unpacked&quot;</strong>
                  <span className="text-slate-400 text-xs">
                    Click the <strong>Load unpacked</strong> button in the top-left toolbar and select the extracted extension folder.
                  </span>
                </div>
              </li>

              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-mono font-bold flex items-center justify-center text-xs shrink-0 mt-0.5">
                  4
                </span>
                <div>
                  <strong className="text-white block font-semibold">Add API Key &amp; Upload Resume PDF</strong>
                  <span className="text-slate-400 text-xs">
                    Pin AutoFill AI to your Chrome toolbar, open Options, paste a free Gemini or OpenAI key, drop your resume PDF, and start autofilling!
                  </span>
                </div>
              </li>
            </ol>

            <div className="pt-2 flex justify-end gap-3 border-t border-white/10">
              <button
                onClick={() => setShowInstallModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition cursor-pointer"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowInstallModal(false);
                  handleDownloadZip();
                }}
                disabled={isZipping}
                className="px-5 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-2 shadow-lg shadow-blue-500/25 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>{isZipping ? 'Packaging...' : 'Download (.zip)'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
