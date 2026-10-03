/**
 * AutoFill AI - PDF Text Extraction Module
 * Extracts text page-by-page using locally bundled pdf.js (MV3 compliant).
 */

/**
 * Extract clean textual content from an ArrayBuffer or Blob of a PDF file.
 * Expects window.pdfjsLib to be loaded from /lib/pdf.min.js in options/popup context.
 */
export async function extractTextFromPDF(arrayBufferOrBlob) {
  let arrayBuffer;
  if (arrayBufferOrBlob instanceof Blob) {
    arrayBuffer = await arrayBufferOrBlob.arrayBuffer();
  } else {
    arrayBuffer = arrayBufferOrBlob;
  }

  // Check if pdfjsLib is available
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    return extractWithPdfJs(arrayBuffer, window.pdfjsLib);
  }

  // Attempt dynamic import of bundled lib if available
  try {
    const pdfjs = await import('./lib/pdf.min.js');
    if (pdfjs && (pdfjs.getDocument || pdfjs.default?.getDocument)) {
      const lib = pdfjs.getDocument ? pdfjs : pdfjs.default;
      return extractWithPdfJs(arrayBuffer, lib);
    }
  } catch (_) {
    // Continue to fallback
  }

  // Fallback: Simple ASCII stream / string extraction for basic PDFs if pdf.js is not yet downloaded
  console.warn('[AutoFill AI] pdf.js library not detected in window.pdfjsLib. Using raw stream extractor fallback.');
  const fallbackText = extractRawTextFromBuffer(arrayBuffer);
  if (fallbackText && fallbackText.trim().length > 100) {
    return fallbackText;
  }

  throw new Error(
    'PDF text extraction requires pdf.js. Please place "pdf.min.js" and "pdf.worker.min.js" into the /lib folder as explained in the extension documentation.'
  );
}

/**
 * Extract text using official PDF.js API
 */
async function extractWithPdfJs(arrayBuffer, pdfjsLib) {
  try {
    // Configure worker if web accessible
    if (pdfjsLib.GlobalWorkerOptions && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('lib/pdf.worker.min.js');
      }
    }

    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(arrayBuffer) });
    const pdf = await loadingTask.promise;
    const numPages = pdf.numPages;
    const textPieces = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();

      let lastY = null;
      let pageText = '';

      for (const item of textContent.items) {
        if (!item.str) continue;

        // Add line breaks when vertical offset shifts significantly
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 8) {
          pageText += '\n';
        } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
          pageText += ' ';
        }

        pageText += item.str;
        lastY = item.transform[5];
      }

      textPieces.push(`--- Page ${pageNum} ---\n` + pageText.trim());
    }

    const fullText = textPieces.join('\n\n').trim();
    if (!fullText || fullText.replace(/--- Page \d+ ---/g, '').trim().length < 20) {
      throw new Error('This PDF appears to be a scanned image with no selectable text. Please use an OCR tool or export a text-based PDF.');
    }

    return fullText;
  } catch (err) {
    console.error('[AutoFill AI] PDF.js extraction error:', err);
    throw err;
  }
}

/**
 * Basic raw stream text extractor (Emergency fallback for uncompressed / text PDF streams)
 */
function extractRawTextFromBuffer(arrayBuffer) {
  try {
    const bytes = new Uint8Array(arrayBuffer);
    let str = '';
    // Process first 1MB max
    const len = Math.min(bytes.length, 1024 * 1024);
    for (let i = 0; i < len; i++) {
      const c = bytes[i];
      if ((c >= 32 && c <= 126) || c === 10 || c === 13 || c === 9) {
        str += String.fromCharCode(c);
      } else {
        str += ' ';
      }
    }

    // Extract text between parentheses in BT...ET blocks
    const matches = str.match(/\(([^()]{2,100})\)/g);
    if (matches && matches.length > 20) {
      return matches.map(m => m.slice(1, -1)).join(' ');
    }
  } catch (_) {}
  return '';
}
