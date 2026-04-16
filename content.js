// Global state for Redmine metadata
let redmineData = { projects: [], users: [], priorities: [] };
const DEFAULT_AI_TIMEOUT_MS = 180000;
const DEFAULT_MAX_QUEUE_SIZE = 5;
const INLINE_NOTICE_TIMEOUT_MS = 5000;
const LOADING_STALE_GRACE_MS = 5000;
let loadingCountdownInterval = null;
let loadingCountdownDeadline = null;
let loadingAttemptText = "";
let currentLoadingRequestId = null;
let loadingStaleTimeoutId = null;
let loadingStaleRequestId = null;
let loadingQueueState = {
  activeRequest: null,
  pendingRequests: [],
  maxQueueSize: DEFAULT_MAX_QUEUE_SIZE
};
let loadingDisplaySettings = {
  showRemainingTime: true,
  showAttemptCount: true,
  showTaskDuration: true
};
const requestTimings = new Map();
let loadingInlineNotice = null;
let loadingInlineNoticeTimeoutId = null;

// Initialize extension
initExtension();

function initExtension() {
  loadLoadingDisplaySettings();
  preloadRedmineData();
  setupMessageListener();
}

function loadLoadingDisplaySettings() {
  chrome.storage.sync.get(['showRemainingTime', 'showAttemptCount', 'showTaskDuration'], (items) => {
    loadingDisplaySettings = {
      showRemainingTime: items.showRemainingTime !== false,
      showAttemptCount: items.showAttemptCount !== false,
      showTaskDuration: items.showTaskDuration !== false
    };
    renderLoadingMeta();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;

    if (changes.showRemainingTime) {
      loadingDisplaySettings.showRemainingTime = changes.showRemainingTime.newValue !== false;
    }

    if (changes.showAttemptCount) {
      loadingDisplaySettings.showAttemptCount = changes.showAttemptCount.newValue !== false;
    }

    if (changes.showTaskDuration) {
      loadingDisplaySettings.showTaskDuration = changes.showTaskDuration.newValue !== false;
    }

    renderLoadingMeta();
  });
}

// Fetch projects, users, and priorities from background script
function preloadRedmineData() {
  chrome.runtime.sendMessage({ action: "fetchRedmineData" }, (response) => {
    if (response && response.success) {
      redmineData = response.data;
    }
  });
}

// Listen for commands and status updates from the background script
function setupMessageListener() {
  chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "triggerTicketModal") {
      handleCreateTicketClick();
    } else if (request.action === "queueStateUpdated") {
      applyQueueState(request);
    } else if (request.action === "ticketCreated") {
      clearLoadingCountdown();
      clearLoadingStaleTimeout();
      const taskDurationMs = consumeRequestDurationMs(request.requestId);
      showLoadingSuccessNotice(request.ticketId, request.ticketUrl, taskDurationMs);
    } else if (request.action === "ticketError") {
      clearLoadingCountdown();
      clearLoadingStaleTimeout();
      const taskDurationMs = consumeRequestDurationMs(request.requestId);
      showLoadingErrorNotice(request.errorMessage, taskDurationMs);
    } else if (request.action === "ticketCancelled") {
      clearLoadingCountdown();
      clearLoadingStaleTimeout();
      clearTrackedRequest(request.requestId);
    } else if (request.action === "updateAttempt") {
      if (request.requestId !== currentLoadingRequestId) {
        return;
      }
      resetLoadingCountdown(request.timeoutMs || DEFAULT_AI_TIMEOUT_MS);
      updateLoadingAttempt(request.attempt, request.maxRetries);
    }
  });
}

function generateRequestId() {
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rememberRequestStart(requestId) {
  if (!requestId) return;
  requestTimings.set(requestId, Date.now());
}

function clearTrackedRequest(requestId) {
  if (!requestId) return;
  requestTimings.delete(requestId);
}

function consumeRequestDurationMs(requestId) {
  if (!requestId) return null;

  const startedAt = requestTimings.get(requestId);
  requestTimings.delete(requestId);

  if (!startedAt) {
    return null;
  }

  return Math.max(0, Date.now() - startedAt);
}

function hasQueuedWork() {
  return Boolean(currentLoadingRequestId) || loadingQueueState.pendingRequests.length > 0;
}

function clearInlineNoticeTimeout() {
  if (loadingInlineNoticeTimeoutId) {
    clearTimeout(loadingInlineNoticeTimeoutId);
    loadingInlineNoticeTimeoutId = null;
  }
}

function clearLoadingStaleTimeout() {
  if (loadingStaleTimeoutId) {
    clearTimeout(loadingStaleTimeoutId);
    loadingStaleTimeoutId = null;
  }
  loadingStaleRequestId = null;
}

function dismissLoadingNotice() {
  clearInlineNoticeTimeout();
  loadingInlineNotice = null;

  if (!hasQueuedWork()) {
    hideLoadingIndicator();
    return;
  }

  renderLoadingShellState();
  renderLoadingNotice();
}

function showLoadingNotice(notice) {
  loadingInlineNotice = notice;
  clearInlineNoticeTimeout();
  ensureLoadingIndicator();
  renderLoadingShellState();
  renderLoadingNotice();
  loadingInlineNoticeTimeoutId = setTimeout(() => {
    dismissLoadingNotice();
  }, INLINE_NOTICE_TIMEOUT_MS);
}

function shortenInlineNoticeText(text, maxLength = 84) {
  const normalized = (text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

function showLoadingSuccessNotice(ticketId, ticketUrl, taskDurationMs = null) {
  const durationText = loadingDisplaySettings.showTaskDuration && taskDurationMs !== null
    ? `Completed in ${formatTaskDuration(taskDurationMs)}`
    : "";

  showLoadingNotice({
    type: "success",
    icon: "OK",
    prefix: "Created",
    link: {
      href: ticketUrl,
      label: `#${ticketId}`
    },
    durationText
  });
}

function showLoadingErrorNotice(errorMessage, taskDurationMs = null) {
  const durationText = loadingDisplaySettings.showTaskDuration && taskDurationMs !== null
    ? `After ${formatTaskDuration(taskDurationMs)}`
    : "";

  showLoadingNotice({
    type: "error",
    icon: "!",
    prefix: "Failed",
    text: shortenInlineNoticeText(errorMessage),
    durationText
  });
}

function applyQueueState(state) {
  const previousActiveRequestId = currentLoadingRequestId;

  loadingQueueState = {
    activeRequest: state.activeRequest || null,
    pendingRequests: Array.isArray(state.pendingRequests) ? state.pendingRequests : [],
    maxQueueSize: state.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE
  };

  currentLoadingRequestId = loadingQueueState.activeRequest
    ? loadingQueueState.activeRequest.requestId
    : null;

  if (previousActiveRequestId !== currentLoadingRequestId) {
    loadingAttemptText = "";
    clearLoadingCountdown();
    clearLoadingStaleTimeout();

    if (currentLoadingRequestId) {
      resetLoadingCountdown();
    }
  }

  if (!currentLoadingRequestId && loadingQueueState.pendingRequests.length === 0 && !loadingInlineNotice) {
    hideLoadingIndicator();
    return;
  }

  ensureLoadingIndicator();
  updateLoadingText(currentLoadingRequestId ? "Processing ticket via AI..." : "Waiting for queued tickets...");
  renderLoadingMeta();
  renderLoadingQueue();
  renderLoadingShellState();
  renderLoadingNotice();
}

function updateLoadingText(text) {
  const loader = document.getElementById('rm-loading-indicator');
  if (loader) {
    const span = loader.querySelector('.rm-loading-text');
    if (span) span.textContent = text;
  }
}

function updateLoadingAttempt(attempt, maxRetries) {
  loadingAttemptText = `Attempt ${attempt}/${maxRetries}`;
  renderLoadingMeta();
}

function formatRemainingTime(msRemaining) {
  const totalSeconds = Math.max(0, Math.ceil(msRemaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function formatTaskDuration(durationMs) {
  const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${totalSeconds}s`;
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
}

function renderLoadingCountdown() {
  renderLoadingMeta();
}

function renderLoadingMeta() {
  const loader = document.getElementById('rm-loading-indicator');
  if (!loader) return;

  const meta = loader.querySelector('.rm-loading-meta');
  if (!meta) return;

  const metaParts = [];
  if (loadingDisplaySettings.showAttemptCount && loadingAttemptText) {
    metaParts.push(loadingAttemptText);
  }

  if (loadingDisplaySettings.showRemainingTime && loadingCountdownDeadline) {
    const remainingMs = loadingCountdownDeadline - Date.now();
    metaParts.push(`Timeout in ${formatRemainingTime(remainingMs)}`);
  }

  meta.textContent = metaParts.join(" • ");
}

function renderLoadingQueue() {
  const loader = document.getElementById('rm-loading-indicator');
  if (!loader) return;

  const queueRow = loader.querySelector('.rm-loading-queue-row');
  const queueList = loader.querySelector('.rm-loading-queue-list');
  if (!queueRow || !queueList) return;

  const pendingRequests = loadingQueueState.pendingRequests || [];
  queueRow.hidden = pendingRequests.length === 0;
  queueList.innerHTML = "";

  if (pendingRequests.length === 0) {
    return;
  }

  for (let index = 0; index < loadingQueueState.maxQueueSize; index++) {
    const queueItem = pendingRequests[index] || null;

    if (!queueItem) {
      const emptySlot = document.createElement('span');
      emptySlot.className = 'rm-loading-queue-slot rm-loading-queue-slot--empty';
      emptySlot.setAttribute('aria-hidden', 'true');
      queueList.appendChild(emptySlot);
      continue;
    }

    const slot = document.createElement('button');
    slot.type = 'button';
    slot.className = 'rm-loading-queue-slot rm-loading-queue-slot--filled';
    slot.title = queueItem.label;
    slot.setAttribute('aria-label', `Cancel queued item ${queueItem.label}`);
    slot.onclick = (event) => {
      event.stopPropagation();
      cancelQueuedRequest(queueItem.requestId);
    };

    const waiting = document.createElement('span');
    waiting.className = 'rm-loading-queue-slot-waiting';
    waiting.setAttribute('aria-hidden', 'true');

    for (let dotIndex = 0; dotIndex < 3; dotIndex++) {
      const dot = document.createElement('span');
      dot.className = 'rm-loading-queue-slot-dot';
      waiting.appendChild(dot);
    }

    const cancel = document.createElement('span');
    cancel.className = 'rm-loading-queue-slot-cancel';
    cancel.setAttribute('aria-hidden', 'true');

    slot.appendChild(waiting);
    slot.appendChild(cancel);
    queueList.appendChild(slot);
  }
}

function renderLoadingShellState() {
  const loader = document.getElementById('rm-loading-indicator');
  if (!loader) return;

  const noticeOnly = Boolean(loadingInlineNotice) && !hasQueuedWork();
  loader.classList.toggle('rm-loading-container--notice-only', noticeOnly);
}

function renderLoadingNotice() {
  const loader = document.getElementById('rm-loading-indicator');
  if (!loader) return;

  const notice = loader.querySelector('.rm-loading-notice');
  const noticeIcon = loader.querySelector('.rm-loading-notice-icon');
  const noticeContent = loader.querySelector('.rm-loading-notice-content');
  if (!notice || !noticeIcon || !noticeContent) return;

  notice.classList.remove('rm-loading-notice--visible', 'rm-loading-notice--success', 'rm-loading-notice--error');
  noticeContent.innerHTML = "";

  if (!loadingInlineNotice) {
    noticeIcon.textContent = "";
    return;
  }

  notice.classList.add('rm-loading-notice--visible', `rm-loading-notice--${loadingInlineNotice.type}`);
  noticeIcon.textContent = loadingInlineNotice.icon;

  const line = document.createElement('div');
  line.className = 'rm-loading-notice-line';

  const prefix = document.createElement('span');
  prefix.className = 'rm-loading-notice-prefix';
  prefix.textContent = loadingInlineNotice.prefix;
  line.appendChild(prefix);

  if (loadingInlineNotice.link) {
    const link = document.createElement('a');
    link.href = loadingInlineNotice.link.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = loadingInlineNotice.link.label;
    line.appendChild(link);
  } else {
    const text = document.createElement('span');
    text.textContent = loadingInlineNotice.text || "";
    line.appendChild(text);
  }

  noticeContent.appendChild(line);

  if (loadingInlineNotice.durationText) {
    const metaLine = document.createElement('div');
    metaLine.className = 'rm-loading-notice-line rm-loading-notice-line--meta';

    const meta = document.createElement('span');
    meta.className = 'rm-loading-notice-meta';
    meta.textContent = loadingInlineNotice.durationText;
    metaLine.appendChild(meta);
    noticeContent.appendChild(metaLine);
  }
}

function clearLoadingCountdown() {
  if (loadingCountdownInterval) {
    clearInterval(loadingCountdownInterval);
    loadingCountdownInterval = null;
  }
  loadingCountdownDeadline = null;
}

function markLoadingAsStale(requestId) {
  if (!requestId || currentLoadingRequestId !== requestId) {
    return;
  }

  clearTrackedRequest(requestId);
  currentLoadingRequestId = null;
  loadingQueueState.activeRequest = null;
  loadingAttemptText = "";
  clearLoadingStaleTimeout();
  updateLoadingText("Request timed out.");
  showLoadingErrorNotice("Request timed out before ticket creation completed.");
  renderLoadingMeta();
  renderLoadingQueue();
  renderLoadingShellState();
  renderLoadingNotice();
}

function resetLoadingCountdown(timeoutMs = DEFAULT_AI_TIMEOUT_MS) {
  clearLoadingCountdown();
  clearLoadingStaleTimeout();
  loadingCountdownDeadline = Date.now() + timeoutMs;
  renderLoadingCountdown();
  loadingCountdownInterval = setInterval(() => {
    renderLoadingCountdown();
    if (loadingCountdownDeadline && Date.now() >= loadingCountdownDeadline) {
      clearLoadingCountdown();
      if (currentLoadingRequestId) {
        const expiredRequestId = currentLoadingRequestId;
        loadingStaleRequestId = expiredRequestId;
        updateLoadingText("Request timed out. Waiting for cleanup...");
        renderLoadingMeta();
        loadingStaleTimeoutId = setTimeout(() => {
          markLoadingAsStale(expiredRequestId);
        }, LOADING_STALE_GRACE_MS);
      }
    }
  }, 1000);
}

// Get the text currently selected by the user
function getSelectedMessagesText() {
  const selection = window.getSelection().toString().trim();
  console.log("[TicketExt] Extracted text selection. Length:", selection.length);
  return selection;
}

// Handle the creation trigger
async function handleCreateTicketClick() {
  console.log("[TicketExt] Modal trigger initiated.");
  const textPayload = getSelectedMessagesText();
  
  if (!textPayload) {
    console.warn("[TicketExt] No text selected by user.");
    alert("Please highlight/select some text in the chat first.");
    return;
  }

  const settings = await chrome.storage.sync.get(['defaultProject', 'defaultUser']);
  showAssignmentModal(textPayload, settings.defaultProject, settings.defaultUser);
}

// Show the modal to select project, assignee, and priority
function showAssignmentModal(textPayload, defaultProjectId, defaultUserId) {
  if (document.querySelector('.rm-modal-overlay')) return;

  const overlay = document.createElement('div');
  overlay.className = 'rm-modal-overlay';

  let projectsOptions = redmineData.projects.map(p => `<option value="${p.id}">${p.pathLabel || p.name}</option>`).join('');
  let usersOptions = redmineData.users.map(u => `<option value="${u.id}">${[u.lastname || '', u.firstname || ''].filter(Boolean).join(' ')}</option>`).join('');
  
  // Build priority options and pre-select the default one configured in Redmine
  let prioritiesOptions = redmineData.priorities.map(p => {
    const selected = p.is_default ? 'selected' : '';
    return `<option value="${p.id}" ${selected}>${p.name}</option>`;
  }).join('');

  // Fallback if the Redmine API didn't return any priorities for some reason
  if (!prioritiesOptions) {
    prioritiesOptions = `<option value="2">Normal</option>`;
  }

  overlay.innerHTML = `
    <div class="rm-modal-content">
      <h3>Create Ticket Configuration</h3>
      
      <label>Select Project:</label>
      <input list="rm-projects-list" id="rm-project-input" placeholder="Search or type ID..." value="${defaultProjectId || ''}">
      <datalist id="rm-projects-list">${projectsOptions}</datalist>
      
      <label>Select Assignee:</label>
      <input list="rm-users-list" id="rm-user-input" placeholder="Search or type ID..." value="${defaultUserId || ''}">
      <datalist id="rm-users-list">${usersOptions}</datalist>

      <label>Ticket Priority:</label>
      <select id="rm-priority-input" style="width: 100%; padding: 8px; margin-top: 5px; box-sizing: border-box; font-family: inherit;">
        ${prioritiesOptions}
      </select>

      <div class="rm-modal-actions">
        <button class="rm-btn rm-btn-cancel" id="rm-modal-cancel">Cancel</button>
        <button class="rm-btn rm-btn-primary" id="rm-modal-submit">Generate & Send</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('rm-modal-cancel').onclick = () => overlay.remove();
  
  document.getElementById('rm-modal-submit').onclick = async () => {
    const projectId = document.getElementById('rm-project-input').value;
    const assigneeId = document.getElementById('rm-user-input').value;
    const priorityId = document.getElementById('rm-priority-input').value;
    const submitButton = document.getElementById('rm-modal-submit');
    
    if (!projectId) {
      alert("Project ID is required.");
      return;
    }

    console.log(`[TicketExt] Submitting ticket request. Project: ${projectId}, Assignee: ${assigneeId}, Priority: ${priorityId}`);

    const requestId = generateRequestId();
    rememberRequestStart(requestId);

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      const response = await chrome.runtime.sendMessage({
        action: "processTicket",
        requestId,
        payload: { messagesText: textPayload, projectId, assigneeId, priorityId }
      });

      if (!response || !response.success) {
        clearTrackedRequest(requestId);

        if (response && response.code === "QUEUE_FULL") {
          alert(`Queue is full (${response.maxQueueSize} waiting requests). Please wait for a free slot.`);
        } else {
          showLoadingErrorNotice(response && response.error ? response.error : "Failed to start ticket processing.");
        }
        return;
      }

      overlay.remove();
      window.getSelection().removeAllRanges();
    } catch (error) {
      clearTrackedRequest(requestId);
      console.warn("[TicketExt] Could not submit ticket request:", error);
      showLoadingErrorNotice("Failed to start ticket processing.");
    } finally {
      if (submitButton && document.body.contains(overlay)) {
        submitButton.disabled = false;
      }
    }
  };
}

// ---------------------------------------------------------------------------------
// UI INJECTIONS (TOASTS & LOADERS)
// ---------------------------------------------------------------------------------

// Injects a floating loading indicator at the top of the screen
function ensureLoadingIndicator() {
  if (document.getElementById('rm-loading-indicator')) return;

  loadingAttemptText = "";
  const loader = document.createElement('div');
  loader.id = 'rm-loading-indicator';
  loader.className = 'rm-loading-container';
  loader.innerHTML = `
    <div class="rm-loading-main">
      <div class="rm-spinner"></div>
      <div class="rm-loading-copy">
        <span class="rm-loading-text">Processing ticket via AI...</span>
        <span class="rm-loading-meta"></span>
        <div class="rm-loading-queue-row" hidden>
          <div class="rm-loading-queue-list" aria-label="Queued requests"></div>
        </div>
      </div>
      <button class="rm-loading-close" aria-label="Cancel sending">&times;</button>
    </div>
    <div class="rm-loading-notice" aria-live="polite">
      <div class="rm-loading-notice-icon" aria-hidden="true"></div>
      <div class="rm-loading-notice-content"></div>
    </div>
  `;
  document.body.appendChild(loader);
  const closeButton = loader.querySelector('.rm-loading-close');
  if (closeButton) {
    closeButton.onclick = async () => {
      const requestId = currentLoadingRequestId;
      if (!requestId) {
        hideLoadingIndicator();
        return;
      }

      if (loadingStaleRequestId && loadingStaleRequestId === requestId) {
        markLoadingAsStale(requestId);
        return;
      }

      updateLoadingText("Cancelling current request...");
      const response = await chrome.runtime.sendMessage({ action: "cancelProcessing", requestId }).catch(err => {
        console.warn("[TicketExt] Could not send cancel message:", err);
        return null;
      });

      if (!response || !response.success) {
        if (loadingStaleRequestId && loadingStaleRequestId === requestId) {
          markLoadingAsStale(requestId);
          return;
        }
        updateLoadingText("Processing ticket via AI...");
      }
    };
  }
  renderLoadingMeta();
  renderLoadingQueue();
  renderLoadingShellState();
  renderLoadingNotice();
}

// Removes the loading indicator
function hideLoadingIndicator() {
  clearInlineNoticeTimeout();
  clearLoadingCountdown();
  clearLoadingStaleTimeout();
  loadingAttemptText = "";
  currentLoadingRequestId = null;
  loadingInlineNotice = null;
  loadingQueueState = {
    activeRequest: null,
    pendingRequests: [],
    maxQueueSize: DEFAULT_MAX_QUEUE_SIZE
  };
  const loader = document.getElementById('rm-loading-indicator');
  if (loader) {
    loader.remove();
  }
}

async function cancelQueuedRequest(requestId) {
  if (!requestId) return;

  try {
    const response = await chrome.runtime.sendMessage({ action: "cancelProcessing", requestId });
    if (response && response.success) {
      clearTrackedRequest(requestId);
    }
  } catch (error) {
    console.warn("[TicketExt] Could not cancel queued request:", error);
  }
}
