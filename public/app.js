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
        throw error;
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
    const [fileHandle] = await window.showOpenFilePicker({
      types: [{
        description: 'Text files',
        accept: { 'text/plain': ['.txt', '.md', '.seq'] }
      }]
    });

    const file = await fileHandle.getFile();
    const content = await file.text();

    FileManager.loadFileContent(content, file.name, fileHandle);
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

    if (supportsFileSystemAccess && appState.fileHandle) {
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
    const filename = appState.fileName || elements.filenameInput.value.trim() || 'diagram.txt';

    const fileHandle = await window.showSaveFilePicker({
      suggestedName: filename,
      types: [{
        description: 'Text files',
        accept: { 'text/plain': ['.txt', '.md', '.seq'] }
      }]
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
    const filename = appState.fileName || elements.filenameInput.value.trim() || 'diagram.txt';

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
          securityLevel: 'loose'
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
    if (!appState.fileName) {
      elements.saveBtn.textContent = '💾 Save';
      elements.saveBtn.style.backgroundColor = '';
      return;
    }

    const status = appState.hasUnsavedChanges ? ' (unsaved changes)' : ' (saved)';
    const locationInfo = appState.fileHandle ? ' to original location' : '';

    elements.saveBtn.textContent = `💾 Save "${appState.fileName}"${status}${locationInfo}`;
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
   * Copy SVG diagram to clipboard as PNG
   * @param {SVGElement} svg - SVG element to copy
   * @returns {Promise<void>}
   */
  static async copyDiagram(svg) {
    if (!ClipboardManager.isSupported()) {
      throw new Error('Clipboard API not supported in this browser');
    }

    const blob = await ClipboardManager.svgToBlob(svg);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  }

  /**
   * Convert SVG to PNG blob
   * @private
   * @param {SVGElement} svg - SVG element to convert
   * @returns {Promise<Blob>} PNG blob
   */
  static svgToBlob(svg) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const svgData = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;

        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob(resolve, 'image/png');
        URL.revokeObjectURL(url);
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to convert SVG to image'));
      };

      img.src = url;
    });
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
   * Generate PNG filename based on current file
   * @returns {string} Generated filename
   */
  static generateFilename() {
    if (appState.fileName) {
      const baseName = appState.fileName.replace(/\.[^/.]+$/, '');
      return `${baseName}.png`;
    }
    return elements.imageFilename.value.trim() || 'diagram.png';
  }

  /**
   * Save PNG with file picker
   * @param {Blob} blob - PNG blob to save
   * @returns {Promise<void>}
   */
  static async saveWithFilePicker(blob) {
    const suggestedName = PngExporter.generateFilename();

    let startIn;
    if (appState.fileHandle) {
      try {
        startIn = await appState.fileHandle.getParent?.();
      } catch {
        startIn = appState.lastPngDirectory;
      }
    } else {
      startIn = appState.lastPngDirectory;
    }

    const fileHandle = await window.showSaveFilePicker({
      suggestedName,
      startIn,
      types: [{
        description: 'PNG images',
        accept: { 'image/png': ['.png'] }
      }]
    });

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
