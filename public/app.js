/**
 * Sequence Diagram Editor
 * A professional web-based editor for creating and managing sequence diagrams
 * 
 * Features:
 * - Real-time diagram rendering
 * - File System Access API integration
 * - Clipboard functionality
 * - Resizable panels with persistence
 * - Auto-save and unsaved changes detection
 * 
 * @version 1.0.0
 */

'use strict';

// =============================================================================
// CONSTANTS AND CONFIGURATION
// =============================================================================

/** @constant {number} Debounce delay for auto-rendering */
const RENDER_DEBOUNCE_DELAY = 1000;

/** @constant {number} Notification display duration */
const NOTIFICATION_DURATION = 3000;

/** @constant {number} Minimum panel width in pixels */
const MIN_PANEL_WIDTH = 300;

/** @constant {string} LocalStorage key for panel width */
const STORAGE_KEY_PANEL_WIDTH = 'editorPanelWidth';

/** @constant {string} LocalStorage key for diagram type selection */
const STORAGE_KEY_DIAGRAM_TYPE = 'diagramType';

/** @constant {string[]} Valid diagram type option values */
const VALID_DIAGRAM_TYPES = ['mermaid', 'js-sequence-simple', 'js-sequence-hand'];

// =============================================================================
// DOM ELEMENT REFERENCES
// =============================================================================

/** @type {Object<string, HTMLElement>} Cached DOM element references */
const elements = {
  diagramText: document.getElementById('diagramText'),
  diagramContainer: document.getElementById('diagram'),
  fileInput: document.getElementById('fileInput'),
  loadBtn: document.getElementById('loadBtn'),
  saveBtn: document.getElementById('saveBtn'),
  savePngBtn: document.getElementById('savePngBtn'),
  renderBtn: document.getElementById('renderBtn'),
  filenameInput: document.getElementById('filenameInput'),
  imageFilename: document.getElementById('imageFilename'),
  diagramSelect: document.getElementById('diagramSelect'),
  notification: document.getElementById('notification'),
  resizer: document.getElementById('resizer'),
  editorPanel: document.getElementById('editorPanel'),
  diagramPanel: document.getElementById('diagramPanel')
};

// =============================================================================
// APPLICATION STATE
// =============================================================================

/**
 * Application state manager
 * @class
 */
class ApplicationState {
  constructor() {
    /** @private {Object} Current file information */
    this._fileInfo = {
      name: null,
      handle: null,
      hasUnsavedChanges: false
    };

    /** @private {FileSystemDirectoryHandle|null} Last PNG save directory */
    this._lastPngDirectory = null;

    /** @private {number|null} Current render timeout ID */
    this._renderTimeoutId = null;

    /** @private {boolean} Panel resize state */
    this._isResizing = false;
  }

  // File info getters/setters
  get fileName() { return this._fileInfo.name; }
  get fileHandle() { return this._fileInfo.handle; }
  get hasUnsavedChanges() { return this._fileInfo.hasUnsavedChanges; }

  setFileInfo(name, handle = null) {
    this._fileInfo = { name, handle, hasUnsavedChanges: false };
  }

  markAsChanged() {
    if (this._fileInfo.name) {
      this._fileInfo.hasUnsavedChanges = true;
    }
  }

  markAsSaved() {
    this._fileInfo.hasUnsavedChanges = false;
  }

  // PNG directory management
  get lastPngDirectory() { return this._lastPngDirectory; }
  set lastPngDirectory(directory) { this._lastPngDirectory = directory; }

  // Render timeout management
  get renderTimeoutId() { return this._renderTimeoutId; }
  set renderTimeoutId(id) { this._renderTimeoutId = id; }

  // Resize state management
  get isResizing() { return this._isResizing; }
  set isResizing(state) { this._isResizing = state; }
}

/** @type {ApplicationState} Global application state */
const appState = new ApplicationState();

/** @type {boolean} File System Access API support detection */
const supportsFileSystemAccess = (() => {
  const isSupported = 'showSaveFilePicker' in window && 'showOpenFilePicker' in window;
  console.log(`File System Access API: ${isSupported ? 'supported' : 'not supported'}`);
  return isSupported;
})();

// =============================================================================
// UTILITY CLASSES
// =============================================================================

/**
 * Error handling utility
 * @class
 */
class ErrorHandler {
  /**
   * Handle and log errors with user notification
   * @param {Error} error - The error to handle
   * @param {string} userMessage - User-friendly error message
   * @param {string} [context] - Additional context for logging
   */
  static handle(error, userMessage, context = '') {
    console.error(`${context ? `[${context}] ` : ''}${error.message}`, error);
    NotificationManager.show(userMessage, 'error');
  }

  /**
   * Create a safe async wrapper that handles errors
   * @param {Function} asyncFn - Async function to wrap
   * @param {string} errorMessage - Error message for users
   * @param {string} [context] - Context for logging
   * @returns {Function} Wrapped function
   */
  static asyncWrapper(asyncFn, errorMessage, context = '') {
    return async (...args) => {
      try {
        return await asyncFn(...args);
      } catch (error) {
        if (error.name !== 'AbortError') {
          ErrorHandler.handle(error, errorMessage, context);
        }
        return undefined;
      }
    };
  }
}

/**
 * Notification management utility
 * @class
 */
class NotificationManager {
  /**
   * Show a notification to the user
   * @param {string} message - Notification message
   * @param {('success'|'error'|'info')} [type='info'] - Notification type
   */
  static show(message, type = 'info') {
    if (!elements.notification) return;

    elements.notification.textContent = message;
    elements.notification.className = `notification ${type} show`;

    setTimeout(() => {
      elements.notification?.classList.remove('show');
    }, NOTIFICATION_DURATION);
  }
}

/**
 * Local storage utility with error handling
 * @class
 */
class StorageManager {
  /**
   * Safely get item from localStorage
   * @param {string} key - Storage key
   * @returns {string|null} Stored value or null
   */
  static getItem(key) {
    try {
      return localStorage.getItem(key);
    } catch (error) {
      console.warn(`Failed to read from localStorage: ${error.message}`);
      return null;
    }
  }

  /**
   * Safely set item in localStorage
   * @param {string} key - Storage key
   * @param {string} value - Value to store
   */
  static setItem(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (error) {
      console.warn(`Failed to write to localStorage: ${error.message}`);
    }
  }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handle load button click with proper error handling
 */
const handleLoadClick = ErrorHandler.asyncWrapper(async () => {
  if (!ConfirmationManager.confirmUnsavedChanges()) {
    return;
  }

  if (supportsFileSystemAccess) {
    try {
      await FileManager.loadWithFilePicker();
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('File picker failed, falling back to file input:', error.message);
      elements.fileInput.click();
    }
  } else {
    elements.fileInput.click();
  }
}, 'Failed to load file', 'LoadButton');

/**
 * Confirmation dialog utility
 * @class
 */
class ConfirmationManager {
  /**
   * Confirm action when there are unsaved changes
   * @returns {boolean} True if user confirms or no unsaved changes
   */
  static confirmUnsavedChanges() {
    if (!appState.hasUnsavedChanges) return true;

    return confirm(
      `You have unsaved changes to "${appState.fileName}". ` +
      'Loading a new file will discard these changes. Continue?'
    );
  }
}

/**
 * Handle file input change with proper error handling
 */
const handleFileInputChange = ErrorHandler.asyncWrapper(async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const content = await FileManager.readFileContent(file);
    FileManager.loadFileContent(content, file.name);
    NotificationManager.show('File loaded successfully', 'success');
  } catch (error) {
    throw new Error(`Failed to read file: ${error.message}`);
  } finally {
    // Clear the input to allow reloading the same file
    event.target.value = '';
  }
}, 'Failed to load selected file', 'FileInput');

/**
 * File management utility class
 * @class
 */
class FileManager {
  /**
   * Read file content as text
   * @param {File} file - File to read
   * @returns {Promise<string>} File content
   */
  static readFileContent(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Load file content into the editor
   * @param {string} content - File content
   * @param {string} fileName - File name
   * @param {FileSystemFileHandle} [handle] - File handle for File System Access API
   */
  static loadFileContent(content, fileName, handle = null) {
    elements.diagramText.value = content;
    elements.filenameInput.value = fileName;

    DiagramTypeSelector.fromFilename(fileName);

    appState.setFileInfo(fileName, handle);
    UIManager.updatePngFilename();
    UIManager.updateFileStatus();
    DiagramRenderer.render();
  }

  /**
   * Load file using File System Access API
   * @returns {Promise<void>}
   */
  static async loadWithFilePicker() {
    const [fileHandle] = await window.showOpenFilePicker();

    const file = await fileHandle.getFile();
    const content = await file.text();
    let fileName
    if (file.name.toLowerCase().endsWith('.txt') && file.name.indexOf('.') !== file.name.toLowerCase().lastIndexOf('.txt')) {
      fileName = file.name.slice(0, -4);
    } else {
      fileName = file.name;
    }

    FileManager.loadFileContent(content, fileName, fileHandle);
    NotificationManager.show('File loaded from original location', 'success');
  }

  /**
   * Save file content
   * @param {string} content - Content to save
   * @returns {Promise<void>}
   */
  static async save(content) {
    if (!content.trim()) {
      throw new Error('Cannot save empty diagram');
    }

    const inputFilename = elements.filenameInput.value.trim();
    const filenameChanged = appState.fileHandle && inputFilename && inputFilename !== appState.fileName;

    if (supportsFileSystemAccess && appState.fileHandle && !filenameChanged) {
      await FileManager.saveToOriginalLocation(content);
    } else if (supportsFileSystemAccess) {
      await FileManager.saveWithFilePicker(content);
    } else {
      FileManager.saveAsDownload(content);
    }
  }

  /**
   * Save to original file location
   * @param {string} content - Content to save
   * @returns {Promise<void>}
   */
  static async saveToOriginalLocation(content) {
    const writable = await appState.fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    appState.markAsSaved();
    UIManager.updateFileStatus();
    NotificationManager.show(`File saved: ${appState.fileName}`, 'success');
  }

  /**
   * Save with file picker
   * @param {string} content - Content to save
   * @returns {Promise<void>}
   */
  static async saveWithFilePicker(content) {
    const filename = elements.filenameInput.value.trim() || appState.fileName || 'diagram.txt';

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename
    });

    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();

    const file = await fileHandle.getFile();
    appState.setFileInfo(file.name, fileHandle);
    UIManager.updateFileStatus();
    NotificationManager.show(`File saved: ${file.name}`, 'success');
  }

  /**
   * Save as download (fallback)
   * @param {string} content - Content to save
   */
  static saveAsDownload(content) {
    const filename = elements.filenameInput.value.trim() || appState.fileName || 'diagram.txt';

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);

    appState.markAsSaved();
    UIManager.updateFileStatus();

    const message = appState.fileName
      ? `File downloaded: ${filename} (browser limitation)`
      : `File downloaded: ${filename}`;
    NotificationManager.show(message, 'success');
  }
}

/**
 * Handle save button click
 */
const handleSaveClick = ErrorHandler.asyncWrapper(async () => {
  await FileManager.save(elements.diagramText.value);
}, 'Failed to save file', 'SaveButton');

/**
 * Diagram rendering utility class
 * @class
 */
class DiagramRenderer {
  /**
   * Render the current diagram
   */
  static render() {
    const text = elements.diagramText.value.trim();

    if (!text) {
      DiagramRenderer.showEmptyState();
      return;
    }

    const selection = elements.diagramSelect.value;

    try {
      if (selection === 'mermaid') {
        DiagramRenderer.renderMermaid(text);
      } else if (selection === 'js-sequence-simple') {
        DiagramRenderer.renderJsSequence(text, 'simple');
      } else if (selection === 'js-sequence-hand') {
        DiagramRenderer.renderJsSequence(text, 'hand');
      }
    } catch (error) {
      DiagramRenderer.showErrorState(error.message);
      throw new Error(`Diagram rendering failed: ${error.message}`);
    }
  }

  /**
   * Render js-sequence diagram
   * @private
   * @param {string} text - Diagram syntax
   * @param {string} theme - Theme to use (simple or hand)
   */
  static renderJsSequence(text, theme = 'simple') {
    elements.diagramContainer.innerHTML = '';
    const diagram = Diagram.parse(text);
    diagram.drawSVG(elements.diagramContainer, { theme: theme });

    DiagramRenderer.enhanceSVG();
  }

  /**
   * Render Mermaid diagram
   * @private
   * @param {string} text - Diagram syntax
   */
  static async renderMermaid(text) {
    elements.diagramContainer.innerHTML = '';

    // Create a div for mermaid to render into
    const renderDiv = document.createElement('div');
    renderDiv.className = 'mermaid-diagram';
    renderDiv.style.textAlign = 'center';
    elements.diagramContainer.appendChild(renderDiv);

    try {
      // Initialize mermaid if not already done
      if (typeof mermaid !== 'undefined') {
        mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          // Use native SVG text instead of foreignObject labels so PNG export/copy keeps text.
          flowchart: { htmlLabels: false }
        });

        const { svg } = await mermaid.render('mermaid-diagram-' + Date.now(), text);
        renderDiv.innerHTML = svg;

        DiagramRenderer.enhanceSVG();
      } else {
        throw new Error('Mermaid library not loaded');
      }
    } catch (error) {
      throw new Error(`Mermaid rendering failed: ${error.message}`);
    }
  }

  /**
   * Show empty state message
   * @private
   */
  static showEmptyState() {
    elements.diagramContainer.innerHTML =
      '<p style="color: #64748b; text-align: center; margin-top: 2rem; font-style: italic;">' +
      'Enter diagram syntax and click "Draw" to generate your diagram</p>';
  }

  /**
   * Show error state message
   * @private
   * @param {string} errorMessage - Error message to display
   */
  static showErrorState(errorMessage) {
    elements.diagramContainer.innerHTML =
      `<p style="color: #ef4444; padding: 1rem; background: #fee2e2; border-radius: 8px; border-left: 4px solid #ef4444;">` +
      `<strong>Rendering Error:</strong><br/>${errorMessage}</p>`;
  }

  /**
   * Enhance SVG with interactive features
   * @private
   */
  static enhanceSVG() {
    const svg = elements.diagramContainer.querySelector('svg');
    if (svg && ClipboardManager.isSupported()) {
      svg.style.cursor = 'pointer';
      svg.title = 'Click to copy diagram to clipboard';
    }
  }


}

/**
 * UI management utility class
 * @class
 */
class UIManager {
  /**
   * Update file status display
   */
  static updateFileStatus() {
    const displayName = elements.filenameInput.value.trim();

    if (!displayName) {
      elements.saveBtn.textContent = '💾 Save';
      elements.saveBtn.style.backgroundColor = '';
      return;
    }

    const isOriginal = appState.fileHandle && displayName === appState.fileName;
    const status = appState.hasUnsavedChanges ? ' (unsaved changes)' : ' ';

    elements.saveBtn.textContent = `💾 Save "${displayName}"${status}`;
    elements.saveBtn.style.backgroundColor = appState.hasUnsavedChanges ? '#f59e0b' : '#10b981';
  }

  /**
   * Update PNG filename based on current file
   */
  static updatePngFilename() {
    if (!appState.fileName) return;

    const baseName = appState.fileName.replace(/\.[^/.]+$/, '');
    elements.imageFilename.value = `${baseName}.png`;

    // Update PNG button text
    if (supportsFileSystemAccess && appState.fileHandle) {
      elements.savePngBtn.textContent = '📷 Export PNG (same directory)';
    } else if (supportsFileSystemAccess) {
      elements.savePngBtn.textContent = '📷 Export PNG (with picker)';
    } else {
      elements.savePngBtn.textContent = '📷 Export PNG (download)';
    }
  }
}

/**
 * Diagram type auto-selection utility
 * @class
 */
class DiagramTypeSelector {
  /**
   * Update the diagram type selector based on a filename's extension.
   * - .mmd  → always switches to 'mermaid'
   * - .jsq  → switches to 'js-sequence-simple' only when a js-sequence type is NOT already selected
   * - other → no change
   * Persists any change to localStorage.
   * @param {string} fileName - The loaded file name
   */
  static fromFilename(fileName) {
    if (!fileName) return;

    const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase();
    const current = elements.diagramSelect.value;

    let newType = null;

    if (ext === '.mmd') {
      newType = 'mermaid';
    } else if (ext === '.jsq') {
      const isAlreadyJsSequence = current === 'js-sequence-simple' || current === 'js-sequence-hand';
      if (!isAlreadyJsSequence) {
        newType = 'js-sequence-simple';
      }
    }

    if (newType && newType !== current) {
      elements.diagramSelect.value = newType;
      StorageManager.setItem(STORAGE_KEY_DIAGRAM_TYPE, newType);
    }
  }
}

/**
 * Handle render button click
 */
const handleRenderClick = ErrorHandler.asyncWrapper(async () => {
  DiagramRenderer.render();
}, 'Failed to render diagram', 'RenderButton');

/**
 * Clipboard management utility class
 * @class
 */
class ClipboardManager {
  /**
   * Check if clipboard API is supported
   * @returns {boolean} True if supported
   */
  static isSupported() {
    return 'clipboard' in navigator && 'write' in navigator.clipboard;
  }

  /**
   * Copy SVG diagram to clipboard, preferring PNG and falling back to SVG
   * @param {SVGElement} svg - SVG element to copy
   * @returns {Promise<void>}
   */
  static async copyDiagram(svg) {
    if (!ClipboardManager.isSupported()) {
      throw new Error('Clipboard API not supported in this browser');
    }

    let pngError = null;

    try {
      const pngBlob = await ClipboardManager.svgToBlob(svg);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      return;
    } catch (error) {
      pngError = error instanceof Error ? error : new Error(String(error));
    }

    const svgBlob = ClipboardManager.createSvgBlob(svg);
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/svg+xml': svgBlob })]);
    } catch (error) {
      const svgMessage = error instanceof Error ? error.message : String(error);
      const pngMessage = pngError?.message || 'unknown PNG export failure';
      throw new Error(`Failed to copy diagram: PNG export failed (${pngMessage}) and SVG fallback failed (${svgMessage})`);
    }
  }

  /**
   * Create SVG blob from rendered diagram
   * @private
   * @param {SVGElement} svg - SVG element to serialize
   * @param {number} [width] - Optional width override
   * @param {number} [height] - Optional height override
   * @param {boolean} [sanitizeForCanvas=false] - Remove canvas-unsafe external resources
   * @returns {Blob} SVG blob
   */
  static createSvgBlob(svg, width, height, sanitizeForCanvas = false) {
    const renderSize = Number.isFinite(width) && Number.isFinite(height)
      ? { width, height }
      : ClipboardManager.getSvgRenderSize(svg);
    const svgData = ClipboardManager.serializeSvgWithSize(
      svg,
      renderSize.width,
      renderSize.height,
      sanitizeForCanvas
    );
    return new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
  }

  /**
   * Convert SVG to PNG blob
   * @private
   * @param {SVGElement} svg - SVG element to convert
   * @returns {Promise<Blob>} PNG blob
   */
  static async svgToBlob(svg) {
    const preferSanitizedRender = ClipboardManager.containsForeignObject(svg);

    try {
      return await ClipboardManager.renderSvgToPngBlob(svg, preferSanitizedRender);
    } catch (error) {
      if (!ClipboardManager.isCanvasSecurityError(error) && !preferSanitizedRender) {
        throw error;
      }
    }

    try {
      return await ClipboardManager.renderSvgToPngBlob(svg, !preferSanitizedRender);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to export PNG: ${message}`);
    }
  }

  /**
   * Render an SVG to a PNG blob
   * @private
   * @param {SVGElement} svg - SVG element to render
   * @param {boolean} sanitizeForCanvas - Whether to remove canvas-unsafe resources before rendering
   * @returns {Promise<Blob>} PNG blob
   */
  static renderSvgToPngBlob(svg, sanitizeForCanvas) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const { width, height } = ClipboardManager.getSvgRenderSize(svg);
      const svgBlob = ClipboardManager.createSvgBlob(svg, width, height, sanitizeForCanvas);
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        try {
          const safeWidth = Math.max(1, Math.round(width || img.width || 300));
          const safeHeight = Math.max(1, Math.round(height || img.height || 150));
          const scale = window.devicePixelRatio || 1;

          canvas.width = Math.round(safeWidth * scale);
          canvas.height = Math.round(safeHeight * scale);

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            throw new Error('Canvas 2D context is not available');
          }

          ctx.setTransform(scale, 0, 0, scale, 0, 0);
          ctx.fillStyle = 'white';
          ctx.fillRect(0, 0, safeWidth, safeHeight);
          ctx.drawImage(img, 0, 0, safeWidth, safeHeight);

          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('Failed to convert SVG to PNG blob'));
              return;
            }
            resolve(blob);
          }, 'image/png');
        } catch (error) {
          if (ClipboardManager.isCanvasSecurityError(error)) {
            reject(new Error('Canvas export blocked by browser security (tainted canvas)'));
          } else {
            reject(error instanceof Error ? error : new Error('Failed to convert SVG to image'));
          }
        } finally {
          URL.revokeObjectURL(url);
        }
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to convert SVG to image'));
      };

      img.src = url;
    });
  }

  static containsForeignObject(svg) {
    return svg.querySelector('foreignObject') !== null;
  }

  /**
   * Remove external resources that can taint canvas rendering
   * @private
   * @param {SVGElement} svg - Cloned SVG element
   */
  static sanitizeSvgForCanvas(svg) {
    ClipboardManager.replaceForeignObjectWithSvgText(svg);

    const allNodes = svg.querySelectorAll('*');
    allNodes.forEach((node) => {
      const href = node.getAttribute('href') || node.getAttribute('xlink:href');
      if (!href) return;

      if (ClipboardManager.isSafeSvgResourceUrl(href)) return;

      if (node.tagName?.toLowerCase() === 'image') {
        node.remove();
        return;
      }

      node.removeAttribute('href');
      node.removeAttribute('xlink:href');
    });
  }

  /**
   * Replace HTML foreignObject labels with plain SVG text for reliable PNG export
   * @private
   * @param {SVGElement} svg - Cloned SVG element
   */
  static replaceForeignObjectWithSvgText(svg) {
    const foreignObjects = Array.from(svg.querySelectorAll('foreignObject'));

    foreignObjects.forEach((node) => {
      const labelText = ClipboardManager.getForeignObjectText(node);
      if (!labelText) {
        node.remove();
        return;
      }

      const x = ClipboardManager.parseSvgLength(node.getAttribute('x'));
      const y = ClipboardManager.parseSvgLength(node.getAttribute('y'));
      const width = ClipboardManager.parseSvgLength(node.getAttribute('width'));
      const height = ClipboardManager.parseSvgLength(node.getAttribute('height'));
      const centerX = x + (width > 0 ? width / 2 : 0);
      const centerY = y + (height > 0 ? height / 2 : 0);

      const textNode = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      const className = node.getAttribute('class');
      if (className) {
        textNode.setAttribute('class', className);
      }

      textNode.setAttribute('x', `${centerX}`);
      textNode.setAttribute('y', `${centerY}`);
      textNode.setAttribute('text-anchor', 'middle');
      textNode.setAttribute('dominant-baseline', 'middle');
      textNode.setAttribute('fill', '#1f2937');
      textNode.setAttribute('font-family', 'Arial, sans-serif');
      textNode.setAttribute('font-size', '14');
      textNode.setAttribute('pointer-events', 'none');

      const maxCharsPerLine = Math.max(10, Math.floor((width || 140) / 7));
      const lines = ClipboardManager.wrapTextForSvg(labelText, maxCharsPerLine);

      if (lines.length <= 1) {
        textNode.textContent = lines[0];
      } else {
        const lineHeightEm = 1.2;
        const firstDy = ((1 - lines.length) / 2) * lineHeightEm;

        lines.forEach((line, index) => {
          const tspan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
          tspan.setAttribute('x', `${centerX}`);
          tspan.setAttribute('dy', `${index === 0 ? firstDy : lineHeightEm}em`);
          tspan.textContent = line;
          textNode.appendChild(tspan);
        });
      }

      node.replaceWith(textNode);
    });
  }

  /**
   * Extract readable label text from foreignObject content
   * @private
   * @param {Element} foreignObject - foreignObject element
   * @returns {string} Normalized text content
   */
  static getForeignObjectText(foreignObject) {
    return (foreignObject.textContent || '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Wrap text to fit inside SVG node boxes
   * @private
   * @param {string} text - Label text
   * @param {number} maxCharsPerLine - Approximate width cap in characters
   * @returns {string[]} Wrapped lines
   */
  static wrapTextForSvg(text, maxCharsPerLine) {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (!normalized) return [''];
    if (normalized.length <= maxCharsPerLine) return [normalized];

    const words = normalized.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxCharsPerLine || !currentLine) {
        currentLine = candidate;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  /**
   * Check whether an SVG resource URL is safe to keep for canvas rendering
   * @private
   * @param {string} value - URL value from href/xlink:href
   * @returns {boolean} True when URL is local/safe
   */
  static isSafeSvgResourceUrl(value) {
    if (!value) return true;
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
      return true;
    }

    try {
      const url = new URL(trimmed, window.location.href);
      return url.origin === window.location.origin;
    } catch {
      return false;
    }
  }

  /**
   * Check whether an error comes from canvas tainting/CORS restrictions
   * @private
   * @param {unknown} error - Error to inspect
   * @returns {boolean} True when canvas export is blocked by browser security
   */
  static isCanvasSecurityError(error) {
    if (!(error instanceof Error)) return false;
    const message = error.message || '';
    return error.name === 'SecurityError' ||
      /tainted canvases may not be exported/i.test(message) ||
      /canvas export blocked by browser security/i.test(message) ||
      /tainted canvas/i.test(message);
  }

  /**
   * Get the current on-screen size of the SVG
   * @private
   * @param {SVGElement} svg - SVG element to measure
   * @returns {{width: number, height: number}} Render size
   */
  static getSvgRenderSize(svg) {
    const rect = svg.getBoundingClientRect?.();
    const width = rect?.width || ClipboardManager.parseSvgLength(svg.getAttribute('width')) ||
      ClipboardManager.getViewBoxSize(svg).width || 300;
    const height = rect?.height || ClipboardManager.parseSvgLength(svg.getAttribute('height')) ||
      ClipboardManager.getViewBoxSize(svg).height || 150;

    return { width, height };
  }

  /**
   * Serialize SVG while forcing width/height to current render size
   * @private
   * @param {SVGElement} svg - SVG element to serialize
   * @param {number} width - Target width
   * @param {number} height - Target height
   * @param {boolean} [sanitizeForCanvas=false] - Remove canvas-unsafe resources before serialization
   * @returns {string} Serialized SVG
   */
  static serializeSvgWithSize(svg, width, height, sanitizeForCanvas = false) {
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute('xmlns')) {
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    }
    if (!clone.getAttribute('xmlns:xlink')) {
      clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
    }

    if (Number.isFinite(width)) {
      clone.setAttribute('width', `${width}`);
    }
    if (Number.isFinite(height)) {
      clone.setAttribute('height', `${height}`);
    }

    if (sanitizeForCanvas) {
      ClipboardManager.sanitizeSvgForCanvas(clone);
    }

    const viewBox = clone.getAttribute('viewBox');
    if (!viewBox) {
      clone.setAttribute('viewBox', `0 0 ${width} ${height}`);
    }

    return new XMLSerializer().serializeToString(clone);
  }

  /**
   * Parse SVG length attribute to number
   * @private
   * @param {string|null} value - Length value
   * @returns {number} Parsed number or 0
   */
  static parseSvgLength(value) {
    if (!value) return 0;
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  /**
   * Get viewBox size if present
   * @private
   * @param {SVGElement} svg - SVG element
   * @returns {{width: number, height: number}}
   */
  static getViewBoxSize(svg) {
    const viewBox = svg.getAttribute('viewBox');
    if (!viewBox) return { width: 0, height: 0 };
    const parts = viewBox.split(/\s+/).map(Number);
    if (parts.length !== 4 || parts.some((v) => !Number.isFinite(v))) {
      return { width: 0, height: 0 };
    }
    return { width: parts[2], height: parts[3] };
  }
}

/**
 * Panel management utility class
 * @class
 */
class PanelManager {
  /**
   * Load saved panel widths from storage
   */
  static loadPanelWidths() {
    const savedWidth = StorageManager.getItem(STORAGE_KEY_PANEL_WIDTH);
    if (savedWidth && elements.editorPanel) {
      elements.editorPanel.style.width = savedWidth;
    }
  }

  /**
   * Save current panel widths to storage
   */
  static savePanelWidths() {
    if (elements.editorPanel?.style.width) {
      StorageManager.setItem(STORAGE_KEY_PANEL_WIDTH, elements.editorPanel.style.width);
    }
  }

  /**
   * Handle panel resize
   * @param {MouseEvent} event - Mouse event
   */
  static handleResize(event) {
    if (!appState.isResizing) return;

    const containerRect = document.querySelector('.main-content')?.getBoundingClientRect();
    if (!containerRect) return;

    const mouseX = event.clientX - containerRect.left;
    const containerWidth = containerRect.width;
    const resizerWidth = 6;

    const minLeftPercent = (MIN_PANEL_WIDTH / containerWidth) * 100;
    const maxLeftPercent = ((containerWidth - MIN_PANEL_WIDTH - resizerWidth) / containerWidth) * 100;

    let leftPercent = (mouseX / containerWidth) * 100;
    leftPercent = Math.max(minLeftPercent, Math.min(maxLeftPercent, leftPercent));

    elements.editorPanel.style.width = `${leftPercent}%`;
  }
}

/**
 * Handle PNG export button click
 */
const handlePngExportClick = ErrorHandler.asyncWrapper(async () => {
  const svg = elements.diagramContainer.querySelector('svg');
  if (!svg) {
    throw new Error('Please render a diagram first');
  }

  const blob = await ClipboardManager.svgToBlob(svg);
  if (supportsFileSystemAccess) {
    await PngExporter.saveWithFilePicker(blob);
  } else {
    PngExporter.saveAsDownload(blob);
  }
}, 'Failed to export PNG', 'PngExport');

/**
 * PNG export utility class
 * @class
 */
class PngExporter {
  /**
   * Generate base filename without extension
   * @returns {string} Base filename
   */
  static generateBaseFilename() {
    if (appState.fileName) {
      return appState.fileName.replace(/\.[^/.]+$/, '');
    }

    const inputName = elements.imageFilename.value.trim();
    if (!inputName) return 'diagram';
    return inputName.replace(/\.[^/.]+$/, '');
  }

  /**
   * Generate PNG filename based on current file
   * @returns {string} Generated filename
   */
  static generateFilename() {
    return `${PngExporter.generateBaseFilename()}.png`;
  }

  /**
   * Resolve preferred start directory for save picker
   * @returns {Promise<FileSystemDirectoryHandle|undefined>}
   */
  static async resolveStartInDirectory() {
    if (appState.fileHandle) {
      try {
        return (await appState.fileHandle.getParent?.()) || undefined;
      } catch {
        return appState.lastPngDirectory || undefined;
      }
    }
    return appState.lastPngDirectory || undefined;
  }

  /**
   * Build safe save picker options without invalid null startIn values
   * @param {string} suggestedName - Suggested file name
   * @param {Array<{description: string, accept: Object<string, string[]>}>} types - Allowed file types
   * @param {FileSystemDirectoryHandle|undefined} startIn - Optional start directory
   * @returns {Object} Save picker options
   */
  static buildSavePickerOptions(suggestedName, types, startIn) {
    const options = { suggestedName, types };
    if (startIn !== undefined && startIn !== null) {
      options.startIn = startIn;
    }
    return options;
  }

  /**
   * Save PNG with file picker
   * @param {Blob} blob - PNG blob to save
   * @returns {Promise<void>}
   */
  static async saveWithFilePicker(blob) {
    const suggestedName = PngExporter.generateFilename();
    const startIn = await PngExporter.resolveStartInDirectory();
    const types = [{
      description: 'PNG images',
      accept: { 'image/png': ['.png'] }
    }];

    const fileHandle = await window.showSaveFilePicker(
      PngExporter.buildSavePickerOptions(suggestedName, types, startIn)
    );

    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();

    try {
      appState.lastPngDirectory = await fileHandle.getParent?.();
    } catch {
      // getParent might not be available
    }

    const file = await fileHandle.getFile();
    const locationInfo = appState.fileName ? ' (same directory as source)' : '';
    NotificationManager.show(`PNG exported: ${file.name}${locationInfo}`, 'success');
  }

  /**
   * Save PNG as download (fallback)
   * @param {Blob} blob - PNG blob to save
   */
  static saveAsDownload(blob) {
    const filename = PngExporter.generateFilename();
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();

    URL.revokeObjectURL(url);

    const message = appState.fileName
      ? `PNG downloaded: ${filename} (based on source filename)`
      : `PNG downloaded: ${filename}`;
    NotificationManager.show(message, 'success');
  }
}

/**
 * Handle text input changes with debounced auto-render
 */
const handleTextInput = () => {
  appState.markAsChanged();
  UIManager.updateFileStatus();

  clearTimeout(appState.renderTimeoutId);
  appState.renderTimeoutId = setTimeout(() => {
    try {
      DiagramRenderer.render();
    } catch (error) {
      // Error already handled in DiagramRenderer.render()
    }
  }, RENDER_DEBOUNCE_DELAY);
};

/**
 * Handle diagram selection change
 */
const handleDiagramChange = () => {
  // Persist the user's selection
  StorageManager.setItem(STORAGE_KEY_DIAGRAM_TYPE, elements.diagramSelect.value);

  // Re-render diagram with new selection if there's content
  if (elements.diagramText.value.trim()) {
    try {
      DiagramRenderer.render();
    } catch (error) {
      // Error already handled in DiagramRenderer.render()
    }
  }
};

/**
 * Handle diagram container click for clipboard functionality
 */
const handleDiagramClick = ErrorHandler.asyncWrapper(async () => {
  const svg = elements.diagramContainer.querySelector('svg');
  if (!svg) return;

  if (!ClipboardManager.isSupported()) {
    NotificationManager.show('Clipboard API not supported in this browser', 'info');
    return;
  }

  await ClipboardManager.copyDiagram(svg);
  NotificationManager.show('Diagram copied to clipboard! 📋', 'success');
}, 'Failed to copy diagram to clipboard', 'DiagramClick');

/**
 * Handle resizer mouse down
 */
const handleResizerMouseDown = (event) => {
  appState.isResizing = true;
  document.body.classList.add('resizing');
  event.preventDefault();
};

/**
 * Handle document mouse move for resizing
 */
const handleDocumentMouseMove = (event) => {
  PanelManager.handleResize(event);
};

/**
 * Handle document mouse up for resizing
 */
const handleDocumentMouseUp = () => {
  if (appState.isResizing) {
    appState.isResizing = false;
    document.body.classList.remove('resizing');
    PanelManager.savePanelWidths();
  }
};

/**
 * Prevent text selection during resize
 */
const handleSelectStart = (event) => {
  if (appState.isResizing) {
    event.preventDefault();
  }
};

// =============================================================================
// EVENT LISTENER REGISTRATION
// =============================================================================

/**
 * Initialize all event listeners
 */
function initializeEventListeners() {
  // Button event listeners
  elements.loadBtn?.addEventListener('click', handleLoadClick);
  elements.saveBtn?.addEventListener('click', handleSaveClick);
  elements.renderBtn?.addEventListener('click', handleRenderClick);
  elements.savePngBtn?.addEventListener('click', handlePngExportClick);

  // Input event listeners
  elements.fileInput?.addEventListener('change', handleFileInputChange);
  elements.diagramText?.addEventListener('input', handleTextInput);
  elements.diagramSelect?.addEventListener('change', handleDiagramChange);
  elements.filenameInput?.addEventListener('input', () => UIManager.updateFileStatus());

  // Diagram interaction
  elements.diagramContainer?.addEventListener('click', handleDiagramClick);

  // Panel resizing
  elements.resizer?.addEventListener('mousedown', handleResizerMouseDown);
  document.addEventListener('mousemove', handleDocumentMouseMove);
  document.addEventListener('mouseup', handleDocumentMouseUp);
  document.addEventListener('selectstart', handleSelectStart);
}

// =============================================================================
// APPLICATION INITIALIZATION
// =============================================================================

/**
 * Initialize the application
 */
function initializeApplication() {
  try {
    // Load saved preferences
    PanelManager.loadPanelWidths();

    // Restore last selected diagram type
    const savedType = StorageManager.getItem(STORAGE_KEY_DIAGRAM_TYPE);
    if (savedType && VALID_DIAGRAM_TYPES.includes(savedType)) {
      elements.diagramSelect.value = savedType;
    }

    // Initialize event listeners
    initializeEventListeners();

    // Render initial diagram if text exists
    if (elements.diagramText?.value.trim()) {
      DiagramRenderer.render();
    }

    console.log('✅ Sequence Diagram Editor initialized successfully');
  } catch (error) {
    console.error('❌ Failed to initialize application:', error);
    NotificationManager.show('Failed to initialize application', 'error');
  }
}

// =============================================================================
// LEGACY FUNCTION COMPATIBILITY (Deprecated - Use class methods instead)
// =============================================================================

/**
 * @deprecated Use DiagramRenderer.render() instead
 */
const renderDiagram = () => DiagramRenderer.render();

/**
 * @deprecated Use NotificationManager.show() instead
 */
const showNotification = (message, type) => NotificationManager.show(message, type);

/**
 * @deprecated Use UIManager.updateFileStatus() instead
 */
const updateFileStatus = () => UIManager.updateFileStatus();

/**
 * @deprecated Use UIManager.updatePngFilename() instead
 */
const updatePngFilename = () => UIManager.updatePngFilename();

/**
 * @deprecated Use ClipboardManager.copyDiagram() instead
 */
const copyDiagramToClipboard = (svg) => ClipboardManager.copyDiagram(svg);

// =============================================================================
// LEGACY FUNCTION COMPATIBILITY (Deprecated - Use FileManager methods instead)
// =============================================================================

/**
 * @deprecated Use FileManager.loadWithFilePicker() instead
 */
const loadWithFilePicker = () => FileManager.loadWithFilePicker();

/**
 * @deprecated Use FileManager.saveToOriginalLocation() instead
 */
const saveToOriginalLocation = (content) => FileManager.saveToOriginalLocation(content);

/**
 * @deprecated Use FileManager.saveWithFilePicker() instead
 */
const saveWithFilePicker = (content) => FileManager.saveWithFilePicker(content);

/**
 * @deprecated Use FileManager.saveAsDownload() instead
 */
const saveAsDownload = (content) => FileManager.saveAsDownload(content);

/**
 * @deprecated Use PngExporter.generateFilename() instead
 */
const generatePngFilename = () => PngExporter.generateFilename();

/**
 * @deprecated Use PngExporter.saveWithFilePicker() instead
 */
const savePngWithFilePicker = (blob) => PngExporter.saveWithFilePicker(blob);

/**
 * @deprecated Use PngExporter.saveAsDownload() instead
 */
const savePngAsDownload = (blob) => PngExporter.saveAsDownload(blob);

// =============================================================================
// APPLICATION STARTUP
// =============================================================================

// Initialize the application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeApplication);
} else {
  initializeApplication();
}
