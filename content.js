// Global state for Redmine metadata
let redmineData = { projects: [], users: [], priorities: [] };

// Initialize extension
initExtension();

function initExtension() {
  preloadRedmineData();
  setupMessageListener();
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
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "triggerTicketModal") {
      handleCreateTicketClick();
    } else if (request.action === "ticketCreated") {
      hideLoadingIndicator();
      injectLocalTicketLink(request.ticketId, request.ticketUrl);
    } else if (request.action === "ticketError") {
      hideLoadingIndicator();
      injectErrorToast(request.errorMessage);
    }
  });
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

  let projectsOptions = redmineData.projects.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
  let usersOptions = redmineData.users.map(u => `<option value="${u.id}">${u.firstname} ${u.lastname}</option>`).join('');
  
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
  
  document.getElementById('rm-modal-submit').onclick = () => {
    const projectId = document.getElementById('rm-project-input').value;
    const assigneeId = document.getElementById('rm-user-input').value;
    const priorityId = document.getElementById('rm-priority-input').value;
    
    if (!projectId) {
      alert("Project ID is required.");
      return;
    }

    console.log(`[TicketExt] Submitting ticket request. Project: ${projectId}, Assignee: ${assigneeId}, Priority: ${priorityId}`);
    
    showLoadingIndicator(); 
    
    chrome.runtime.sendMessage({
      action: "processTicket",
      payload: { messagesText: textPayload, projectId, assigneeId, priorityId }
    });

    overlay.remove();
    window.getSelection().removeAllRanges();
  };
}

// ---------------------------------------------------------------------------------
// UI INJECTIONS (TOASTS & LOADERS)
// ---------------------------------------------------------------------------------

// Injects a floating loading indicator at the top of the screen
function showLoadingIndicator() {
  if (document.getElementById('rm-loading-indicator')) return;
  
  const loader = document.createElement('div');
  loader.id = 'rm-loading-indicator';
  loader.className = 'rm-loading-container';
  loader.innerHTML = `
    <div class="rm-spinner"></div>
    <span>Processing ticket via AI...</span>
  `;
  document.body.appendChild(loader);
}

// Removes the loading indicator
function hideLoadingIndicator() {
  const loader = document.getElementById('rm-loading-indicator');
  if (loader) {
    loader.remove();
  }
}

// Injects a private, local-only notification toast directly into the Google Chat DOM
function injectLocalTicketLink(ticketId, ticketUrl) {
  const toast = document.createElement('div');
  toast.className = 'rm-local-toast';
  
  toast.innerHTML = `
    <span class="rm-toast-icon">✅</span>
    <div class="rm-toast-content">
      <strong>Ticket Created Successfully</strong><br>
      <a href="${ticketUrl}" target="_blank">View Ticket #${ticketId} in Redmine</a>
    </div>
    <button class="rm-toast-close" aria-label="Close">&times;</button>
  `;

  document.body.appendChild(toast);
  toast.querySelector('.rm-toast-close').onclick = () => toast.remove();

  setTimeout(() => {
    if (document.body.contains(toast)) toast.remove();
  }, 15000);
}

// Injects a private, local-only error toast
function injectErrorToast(errorMessage) {
  const toast = document.createElement('div');
  toast.className = 'rm-local-toast rm-error-toast';
  
  toast.innerHTML = `
    <span class="rm-toast-icon">❌</span>
    <div class="rm-toast-content">
      <strong>Ticket Creation Failed</strong><br>
      <span style="font-size: 12px; color: inherit;">${errorMessage}</span>
    </div>
    <button class="rm-toast-close" aria-label="Close">&times;</button>
  `;

  document.body.appendChild(toast);
  toast.querySelector('.rm-toast-close').onclick = () => toast.remove();

  setTimeout(() => {
    if (document.body.contains(toast)) toast.remove();
  }, 15000);
}