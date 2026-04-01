const AI_REQUEST_TIMEOUT_MS = 180000;
const MAX_QUEUED_REQUESTS = 5;
const tabRequestQueues = new Map();
const googleAuthCache = new Map();
const GOOGLE_TOKEN_REFRESH_SKEW_MS = 60 * 1000;

function createCancellationError() {
  const error = new Error("Sending cancelled.");
  error.name = "CancellationError";
  error.isUserCancelled = true;
  return error;
}

function createRequestContext(tabId, requestId = null) {
  return {
    tabId,
    requestId,
    controller: new AbortController(),
    canceled: false,
    cancel() {
      if (this.canceled) return;
      this.canceled = true;
      this.controller.abort();
    },
    throwIfCanceled() {
      if (this.canceled) {
        throw createCancellationError();
      }
    }
  };
}

function getOrCreateTabQueue(tabId) {
  if (!tabId) return null;

  let tabQueue = tabRequestQueues.get(tabId);
  if (!tabQueue) {
    tabQueue = {
      activeRequest: null,
      pendingRequests: []
    };
    tabRequestQueues.set(tabId, tabQueue);
  }

  return tabQueue;
}

function cleanupTabQueue(tabId) {
  const tabQueue = tabRequestQueues.get(tabId);
  if (tabQueue && !tabQueue.activeRequest && tabQueue.pendingRequests.length === 0) {
    tabRequestQueues.delete(tabId);
  }
}

function buildQueueLabel(messagesText = "") {
  const normalized = messagesText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Empty selection";
  }

  return normalized.length > 54 ? `${normalized.slice(0, 51)}...` : normalized;
}

function serializeQueueItem(queueItem) {
  return {
    requestId: queueItem.requestId,
    label: queueItem.label
  };
}

function notifyQueueState(tabId) {
  if (!tabId) return;

  const tabQueue = tabRequestQueues.get(tabId);
  chrome.tabs.sendMessage(tabId, {
    action: "queueStateUpdated",
    activeRequest: tabQueue && tabQueue.activeRequest ? serializeQueueItem(tabQueue.activeRequest) : null,
    pendingRequests: tabQueue ? tabQueue.pendingRequests.map(serializeQueueItem) : [],
    maxQueueSize: MAX_QUEUED_REQUESTS
  }).catch(err => {
    console.warn("[TicketExt] Could not send queue state to tab:", err);
  });
}

function startNextQueuedRequest(tabId) {
  const tabQueue = tabRequestQueues.get(tabId);
  if (!tabQueue || tabQueue.activeRequest || tabQueue.pendingRequests.length === 0) {
    cleanupTabQueue(tabId);
    return null;
  }

  const nextRequest = tabQueue.pendingRequests.shift();
  nextRequest.context = createRequestContext(tabId, nextRequest.requestId);
  tabQueue.activeRequest = nextRequest;
  handleQueuedRequest(nextRequest);
  return nextRequest;
}

function finalizeActiveRequest(tabId, queueItem) {
  const tabQueue = tabRequestQueues.get(tabId);
  if (tabQueue && tabQueue.activeRequest === queueItem) {
    tabQueue.activeRequest = null;
  }

  startNextQueuedRequest(tabId);
  cleanupTabQueue(tabId);
  notifyQueueState(tabId);
}

async function handleQueuedRequest(queueItem) {
  const { tabId, requestId, payload, context } = queueItem;

  console.log("[TicketExt] === QUEUED TICKET PROCESS STARTED ===");
  console.log("[TicketExt] Payload received from UI:", payload);

  try {
    const result = await processTicketFlow(payload, tabId, context);
    if (context && context.canceled) {
      return;
    }

    console.log("[TicketExt] ✅ PROCESS SUCCESSFUL. Redmine Issue ID:", result.issue.id);
    const settings = await chrome.storage.sync.get(['redmineUrl']);
    const ticketUrl = `${settings.redmineUrl}/issues/${result.issue.id}`;

    showSystemNotification(result.issue.id, "Ticket Created", `Success! Ticket #${result.issue.id} has been created.`);

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "ticketCreated",
        requestId,
        ticketId: result.issue.id,
        ticketUrl
      }).catch(err => console.warn("[TicketExt] Could not send success message to tab:", err));
    }
  } catch (error) {
    if (error.isUserCancelled) {
      console.log("[TicketExt] Processing cancelled by user.");
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: "ticketCancelled",
          requestId
        }).catch(err => console.warn("[TicketExt] Could not send cancellation message to tab:", err));
      }
      return;
    }

    console.error("[TicketExt] ❌ PROCESS FAILED:", error.message);
    console.error("[TicketExt] Full Error Object:", error);
    showSystemNotification(null, "Ticket Creation Failed", error.message);

    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        action: "ticketError",
        requestId,
        errorMessage: error.message
      }).catch(err => console.warn("[TicketExt] Could not send error message to tab:", err));
    }
  } finally {
    finalizeActiveRequest(tabId, queueItem);
  }
}

function enqueueTicketRequest(tabId, requestId, payload) {
  const tabQueue = getOrCreateTabQueue(tabId);
  if (!tabQueue) {
    return { success: false, error: "Missing tab context." };
  }

  if (!tabQueue.activeRequest && tabQueue.pendingRequests.length > 0) {
    startNextQueuedRequest(tabId);
  }

  if (tabQueue.pendingRequests.length >= MAX_QUEUED_REQUESTS) {
    return {
      success: false,
      code: "QUEUE_FULL",
      error: `Queue is full. Maximum ${MAX_QUEUED_REQUESTS} waiting requests allowed.`,
      maxQueueSize: MAX_QUEUED_REQUESTS
    };
  }

  tabQueue.pendingRequests.push({
    tabId,
    requestId,
    payload,
    label: buildQueueLabel(payload && payload.messagesText ? payload.messagesText : ""),
    context: null
  });

  const startedRequest = startNextQueuedRequest(tabId);
  notifyQueueState(tabId);

  const isActiveRequest = startedRequest
    ? startedRequest.requestId === requestId
    : Boolean(tabQueue.activeRequest && tabQueue.activeRequest.requestId === requestId);

  return {
    success: true,
    status: isActiveRequest ? "started" : "queued",
    queuePosition: isActiveRequest
      ? 0
      : tabQueue.pendingRequests.findIndex(item => item.requestId === requestId) + 1,
    maxQueueSize: MAX_QUEUED_REQUESTS
  };
}

function cancelQueuedOrActiveRequest(tabId, requestId = null) {
  const tabQueue = tabRequestQueues.get(tabId);
  if (!tabQueue) {
    return { success: false };
  }

  const activeRequest = tabQueue.activeRequest;
  if (activeRequest && (!requestId || activeRequest.requestId === requestId)) {
    activeRequest.context.cancel();
    return { success: true, cancelled: "active" };
  }

  const pendingIndex = requestId
    ? tabQueue.pendingRequests.findIndex(item => item.requestId === requestId)
    : 0;

  if (pendingIndex === -1) {
    return { success: false };
  }

  tabQueue.pendingRequests.splice(pendingIndex, 1);
  startNextQueuedRequest(tabId);
  cleanupTabQueue(tabId);
  notifyQueueState(tabId);
  return { success: true, cancelled: "queued" };
}

// Create the context menu item when the extension is installed or updated
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "create-redmine-ticket",
    title: "Create Redmine Ticket from Selection",
    contexts: ["selection"],
    documentUrlPatterns: [
      "https://mail.google.com/chat/*",
      "https://chat.google.com/*"
    ]
  });
});

// Listen for clicks on the context menu item (right-click)
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "create-redmine-ticket") {
    chrome.tabs.sendMessage(tab.id, { action: "triggerTicketModal" }).catch(err => {
      console.warn("[TicketExt] Content script not loaded or page not refreshed.", err);
    });
  }
});

// Listen for the keyboard shortcut
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "trigger_ticket" && tab.url && (tab.url.includes("chat.google.com") || tab.url.includes("mail.google.com/chat"))) {
    chrome.tabs.sendMessage(tab.id, { action: "triggerTicketModal" }).catch(err => {
      console.warn("[TicketExt] Content script not loaded or page not refreshed.", err);
    });
  }
});

// Listen for clicks on the extension icon in the Chrome toolbar
chrome.action.onClicked.addListener((tab) => {
  if (tab.url && (tab.url.includes("chat.google.com") || tab.url.includes("mail.google.com/chat"))) {
    chrome.tabs.sendMessage(tab.id, { action: "triggerTicketModal" }).catch(err => {
      console.warn("[TicketExt] Content script not loaded or page not refreshed.", err);
    });
  }
});

// Handle incoming messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "processTicket") {
    const tabId = sender.tab ? sender.tab.id : null;
    const requestId = request.requestId || null;

    if (!tabId || !requestId) {
      sendResponse({ success: false, error: "Missing tab or request context." });
      return false;
    }

    sendResponse(enqueueTicketRequest(tabId, requestId, request.payload));
    return false; 
  }

  if (request.action === "cancelProcessing") {
    const tabId = sender.tab ? sender.tab.id : null;
    sendResponse(cancelQueuedOrActiveRequest(tabId, request.requestId || null));
    return false;
  }
  
  if (request.action === "fetchRedmineData") {
    fetchRedmineMetadata()
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; 
  }
});

// ---------------------------------------------------------------------------------
// NOTIFICATION LOGIC
// ---------------------------------------------------------------------------------
function showSystemNotification(ticketId, title, message) {
  const notifId = ticketId ? `ticket-${ticketId}` : `error-${Date.now()}`;
  
  chrome.notifications.create(notifId, {
    type: 'basic',
    iconUrl: 'icon128.png', 
    title: title,
    message: message,
    priority: 2
  }, (createdId) => {
    if (chrome.runtime.lastError) {
      console.error("[TicketExt] NOTIFICATION ERROR:", chrome.runtime.lastError.message);
    }
  });
}

// Listen for clicks on the notification bubble
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('ticket-')) {
    const ticketId = notificationId.replace('ticket-', '');
    const settings = await chrome.storage.sync.get(['redmineUrl']);
    
    if (settings.redmineUrl) {
      chrome.tabs.create({ url: `${settings.redmineUrl}/issues/${ticketId}` });
    }
    
    chrome.notifications.clear(notificationId);
  }
});

// ---------------------------------------------------------------------------------
// NETWORK & RETRY HELPERS
// ---------------------------------------------------------------------------------
async function executeWithRetry(operation, maxRetries = 3, delayMs = 2000, onAttemptCallback = null, requestContext = null) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    if (requestContext) {
      requestContext.throwIfCanceled();
    }

    // Notify the UI about the current attempt
    if (onAttemptCallback) {
      onAttemptCallback(attempt, maxRetries);
    }
    
    try {
      return await operation();
    } catch (error) {
      if (error.isUserCancelled) {
        throw error;
      }

      if (error.nonRetryable) {
        throw error;
      }

      if (requestContext && requestContext.canceled) {
        throw createCancellationError();
      }

      if (attempt === maxRetries) {
        throw new Error(`AI API failed after ${maxRetries} attempts. Last error: ${error.message}`);
      }
      console.warn(`[TicketExt] Attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise((res, rej) => {
        const retryTimeoutId = setTimeout(() => {
          if (requestContext && requestContext.controller.signal) {
            requestContext.controller.signal.removeEventListener('abort', onAbort);
          }
          res();
        }, delayMs);

        const onAbort = () => {
          clearTimeout(retryTimeoutId);
          requestContext.controller.signal.removeEventListener('abort', onAbort);
          rej(createCancellationError());
        };

        if (requestContext && requestContext.controller.signal) {
          requestContext.controller.signal.addEventListener('abort', onAbort, { once: true });
        }
      });
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = AI_REQUEST_TIMEOUT_MS, externalSignal = null) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const signals = [controller.signal];

  if (externalSignal) {
    signals.push(externalSignal);
  }

  const signal = AbortSignal.any(signals);
  
  try {
    const response = await fetch(url, { ...options, signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      if (externalSignal && externalSignal.aborted) {
        throw createCancellationError();
      }
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------
// CORE TICKET FLOW
// ---------------------------------------------------------------------------------
async function processTicketFlow(payload, tabId, requestContext = null) {
  const { messagesText, projectId, assigneeId, priorityId } = payload;
  console.log("[TicketExt] Loading settings from storage...");
  const settings = await chrome.storage.sync.get(null);
  if (requestContext) {
    requestContext.throwIfCanceled();
  }

  if (!settings.redmineUrl || !settings.redmineKey) {
    throw new Error("Missing Redmine API keys or settings.");
  }

  console.log(`[TicketExt] Initiating AI call via Provider: ${settings.aiProvider || 'openrouter'}`);
  
  const aiResponse = await executeWithRetry(
    async () => {
      if (requestContext) {
        requestContext.throwIfCanceled();
      }
      console.log("[TicketExt] Sending prompt to AI. Text length:", messagesText.length);
      const res = await callSelectedAiProvider(messagesText, settings, requestContext);
      console.log("[TicketExt] Raw AI Response received:", res);
      return res;
    },
    3, 
    2000,
    (attempt, maxRetries) => {
      // Send a message to the content script to update the UI
      if (tabId) {
        chrome.tabs.sendMessage(tabId, {
          action: "updateAttempt",
          requestId: requestContext ? requestContext.requestId : null,
          attempt,
          maxRetries,
          timeoutMs: AI_REQUEST_TIMEOUT_MS
        }).catch(err => {
          console.warn("[TicketExt] Could not send attempt update to tab:", err);
        });
      }
    },
    requestContext
  );
  
  console.log("[TicketExt] Attempting to extract JSON from AI response...");
  let ticketData;
  try {
    const jsonMatch = aiResponse.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[TicketExt] Regex failed to find valid JSON structure.");
      throw new Error("No JSON object structure found in AI response.");
    }
    console.log("[TicketExt] Extracted JSON string:", jsonMatch[0]);
    ticketData = JSON.parse(jsonMatch[0]);
    console.log("[TicketExt] Successfully parsed JSON object:", ticketData);
  } catch (e) {
    console.error("[TicketExt] JSON Parsing Exception:", e);
    throw new Error("AI did not return valid JSON format. Raw output: " + aiResponse);
  }

  console.log("[TicketExt] Sending parsed data to Redmine API...");
  console.log(`[TicketExt] Target: Project ID ${projectId}, Assignee ID ${assigneeId}, Priority ID ${priorityId}`);
  if (requestContext) {
    requestContext.throwIfCanceled();
  }
  
  // Pass priorityId to the issue creation function
  const redmineResult = await createRedmineIssue(ticketData, projectId, assigneeId, priorityId, settings, requestContext);
  console.log("[TicketExt] Redmine API Response:", redmineResult);
  
  return redmineResult;
}

// ---------------------------------------------------------------------------------
// ROUTER FUNCTION
// ---------------------------------------------------------------------------------
async function callSelectedAiProvider(text, settings, requestContext = null) {
  const provider = settings.aiProvider || 'openrouter';
  
  // Directly use the stored string (e.g., 'French', 'German') in the prompt
  const targetLang = settings.outputLanguage || 'English';
  const langInstruction = `Write the 'subject' and the prose parts of the 'description' entirely in ${targetLang} language.`;

  // Upgraded prompt optimized for strict IT/Tech ticket generation
  const systemPrompt = `You are an analyst and project manager. Your task is to convert raw, noisy chat logs into a highly structured, actionable bug tracking ticket for Redmine.

CRITICAL INSTRUCTIONS:
1. PRESERVE TECHNICAL ARTIFACTS: You must strictly retain all URLs, API endpoints, passwords, usernames, IP addresses, ports, numerical values, file paths, and environment details exactly as they appear. Never mask, summarize, or alter them.
2. STRUCTURED DESCRIPTION: The 'description' must be formatted in Markdown and logically divided into clear headings. Use headings such as 'Core Issue', 'Technical Details' (for extracted IPs, paths, credentials), and 'Action Items' (if next steps are discussed).
3. CODE & LOGS: Wrap any code snippets, stack traces, JSON payloads, or terminal output in appropriate Markdown code blocks (\`\`\`language). Use bullet points for readability.
4. ACCURACY: Do not hallucinate, guess, or invent details, solutions, or systems not explicitly present in the chat.
5. LANGUAGE: ${langInstruction} Apply this strictly to your prose. Keep technical terms, variable names, and logs in their original language.
6. STRICT OUTPUT FORMAT: You must output ONLY a raw, valid JSON object. Do not wrap it in markdown block quotes (e.g., NO \`\`\`json). No preamble, no epilogue.

The JSON object must contain exactly two keys:
- "subject": A concise, descriptive title of the issue (string, max 100 characters).
- "description": The structured markdown payload (string).`;

  switch (provider) {
    case 'openrouter': 
      return await callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", settings.openRouterKey, settings.openRouterModel, systemPrompt, text, requestContext);
    case 'openai': 
      return await callOpenAiCompatible("https://api.openai.com/v1/chat/completions", settings.openAiKey, settings.openAiModel, systemPrompt, text, requestContext);
    case 'anthropic': 
      return await callAnthropic(settings.anthropicKey, settings.anthropicModel, systemPrompt, text, requestContext);
    case 'aistudio': 
      return await callGeminiApi(`https://generativelanguage.googleapis.com/v1beta/models/${settings.aiStudioModel}:generateContent?key=${settings.aiStudioKey}`, systemPrompt, text, requestContext);
    case 'vertex': 
      return await callVertexAi(settings.vertexJson, settings.vertexRegion, settings.vertexModel, systemPrompt, text, requestContext);
    case 'custom':
      if (!settings.customUrl) throw new Error("Custom Endpoint URL is missing.");
      const safeKey = settings.customKey || "sk-no-key-required";
      const safeModel = settings.customModel || "local-model";
      return await callOpenAiCompatible(settings.customUrl, safeKey, safeModel, systemPrompt, text, requestContext);
    default: 
      throw new Error("Unknown AI provider selected.");
  }
}

// ---------------------------------------------------------------------------------
// PROVIDER SPECIFIC IMPLEMENTATIONS
// ---------------------------------------------------------------------------------

async function callOpenAiCompatible(url, apiKey, model, systemPrompt, text, requestContext = null) {
  if (!apiKey) throw new Error("API Key is missing for selected provider.");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      response_format: { type: "json_object" }, 
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
    })
  }, AI_REQUEST_TIMEOUT_MS, requestContext ? requestContext.controller.signal : null);
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`API error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(apiKey, model, systemPrompt, text, requestContext = null) {
  if (!apiKey) throw new Error("Anthropic API Key is missing.");
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
      "anthropic-dangerously-allow-browser": "true" 
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        { role: "user", content: text },
        { role: "assistant", content: "{" } 
      ]
    })
  }, AI_REQUEST_TIMEOUT_MS, requestContext ? requestContext.controller.signal : null);
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`Anthropic error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return "{" + data.content[0].text; 
}

async function callGeminiApi(endpointUrl, systemPrompt, text, requestContext = null) {
  const response = await fetchWithTimeout(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: { text: systemPrompt } },
      contents: [{ role: "user", parts: [{ text: text }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  }, AI_REQUEST_TIMEOUT_MS, requestContext ? requestContext.controller.signal : null);
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`Gemini error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callVertexAi(jsonStr, region, model, systemPrompt, text, requestContext = null) {
  if (!jsonStr) throw new Error("Vertex AI Service Account JSON is missing.");
  let saData;
  try { saData = JSON.parse(jsonStr); } catch (e) { throw new Error("Invalid Service Account JSON"); }
  if (!saData.project_id || !saData.client_email || !saData.private_key) {
    throw new Error("Service Account JSON is missing required Vertex credentials.");
  }
  
  const startTime = performance.now();
  const accessToken = await getGoogleOAuthToken(saData, requestContext);
  const projectId = saData.project_id;
  
  const baseUrl = region === 'global' 
    ? 'https://aiplatform.googleapis.com' 
    : `https://${region}-aiplatform.googleapis.com`;
    
  const endpoint = `${baseUrl}/v1/projects/${projectId}/locations/${region}/publishers/google/models/${model}:generateContent`;
  
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: text }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  }, AI_REQUEST_TIMEOUT_MS, requestContext ? requestContext.controller.signal : null);
  
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') 
      ? `HTTP ${response.status} (Endpoint routing failed.)` 
      : errorText;
    const error = new Error(`Vertex error: ${response.status} ${cleanError}`);
    error.nonRetryable = response.status >= 400 && response.status < 500 && response.status !== 429;
    throw error;
  }
  
  const data = await response.json();
  console.log(`[TicketExt] Vertex request finished in ${Math.round(performance.now() - startTime)}ms`);
  
  if (!data.candidates || data.candidates.length === 0) {
    throw new Error("Vertex AI returned no data. Possible safety filter block.");
  }
  
  const candidate = data.candidates[0];
  if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
    const reason = candidate.finishReason || "Unknown";
    throw new Error(`Vertex AI blocked text generation. Finish reason: ${reason}`);
  }
  
  return candidate.content.parts[0].text;
}

// ---------------------------------------------------------------------------------
// GOOGLE SERVICE ACCOUNT JWT GENERATOR
// ---------------------------------------------------------------------------------
async function getGoogleOAuthToken(saData, requestContext = null) {
  const toBase64Url = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const str2ab = (str) => {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) bufView[i] = str.charCodeAt(i);
    return buf;
  };
  const cacheKey = `${saData.client_email}::${saData.private_key_id || 'no-key-id'}`;
  const cachedAuth = googleAuthCache.get(cacheKey);
  const nowMs = Date.now();

  if (cachedAuth && cachedAuth.accessToken && cachedAuth.expiresAt > nowMs + GOOGLE_TOKEN_REFRESH_SKEW_MS) {
    return cachedAuth.accessToken;
  }
  
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(nowMs / 1000);
  const claim = {
    iss: saData.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaim = toBase64Url(JSON.stringify(claim));
  const unsignedToken = `${encodedHeader}.${encodedClaim}`;

  let cryptoKey = cachedAuth ? cachedAuth.cryptoKey : null;
  if (!cryptoKey) {
    const pem = saData.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
    const binaryDerString = atob(pem);
    const binaryDer = str2ab(binaryDerString);

    cryptoKey = await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }

  const signatureBuffer = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  
  let binary = '';
  const bytes = new Uint8Array(signatureBuffer);
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  const encodedSignature = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  
  const jwt = `${unsignedToken}.${encodedSignature}`;

  const tokenRes = await fetchWithTimeout("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  }, AI_REQUEST_TIMEOUT_MS, requestContext ? requestContext.controller.signal : null);
  
  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    const error = new Error(`Failed to generate Google OAuth Token: ${tokenRes.status} ${errorText}`);
    error.nonRetryable = tokenRes.status >= 400 && tokenRes.status < 500 && tokenRes.status !== 429;
    throw error;
  }
  const tokenData = await tokenRes.json();
  const expiresInMs = Math.max((tokenData.expires_in || 3600) * 1000, GOOGLE_TOKEN_REFRESH_SKEW_MS * 2);
  googleAuthCache.set(cacheKey, {
    cryptoKey,
    accessToken: tokenData.access_token,
    expiresAt: nowMs + expiresInMs
  });
  return tokenData.access_token;
}

// ---------------------------------------------------------------------------------
// REDMINE LOGIC
// ---------------------------------------------------------------------------------
async function createRedmineIssue(ticketData, projectId, assigneeId, priorityId, settings, requestContext = null) {
  const payload = {
    issue: { 
      project_id: projectId, 
      subject: ticketData.subject, 
      description: ticketData.description, 
      assigned_to_id: assigneeId,
      priority_id: priorityId 
    }
  };
  const response = await fetch(`${settings.redmineUrl}/issues.json`, {
    method: "POST",
    headers: { "X-Redmine-API-Key": settings.redmineKey, "Content-Type": "application/json" },
    signal: requestContext ? requestContext.controller.signal : undefined,
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Redmine API error: ${response.status}`);
  return await response.json();
}

async function fetchRedmineMetadata() {
  const settings = await chrome.storage.sync.get(['redmineUrl', 'redmineKey']);
  if (!settings.redmineUrl || !settings.redmineKey) return null;

  const headers = { "X-Redmine-API-Key": settings.redmineKey };
  const fetchAllRedminePages = async (resourcePath, key) => {
    const pageSize = 100;
    const items = [];
    let offset = 0;
    let totalCount = null;

    do {
      const separator = resourcePath.includes('?') ? '&' : '?';
      const response = await fetch(`${settings.redmineUrl}${resourcePath}${separator}limit=${pageSize}&offset=${offset}`, { headers });
      if (!response.ok) {
        throw new Error(`Redmine API error: ${response.status}`);
      }

      const data = await response.json();
      const pageItems = Array.isArray(data[key]) ? data[key] : [];
      items.push(...pageItems);

      totalCount = typeof data.total_count === 'number' ? data.total_count : items.length;
      offset += pageSize;
    } while (offset < totalCount);

    return items;
  };

  const buildProjectPathMap = (projects) => {
    const projectMap = new Map(projects.map(project => [String(project.id), project]));
    const labelCache = new Map();

    const getProjectPath = (project) => {
      const cacheKey = String(project.id);
      if (labelCache.has(cacheKey)) {
        return labelCache.get(cacheKey);
      }

      let label = project.name;
      if (project.parent && projectMap.has(String(project.parent.id))) {
        label = `${getProjectPath(projectMap.get(String(project.parent.id)))} / ${project.name}`;
      }

      labelCache.set(cacheKey, label);
      return label;
    };

    projects.forEach(getProjectPath);
    return labelCache;
  };

  const [currentUserRes, projects, users, prioritiesRes] = await Promise.all([
    fetch(`${settings.redmineUrl}/users/current.json`, { headers }),
    fetchAllRedminePages('/projects.json', 'projects'),
    fetchAllRedminePages('/users.json', 'users'),
    fetch(`${settings.redmineUrl}/enumerations/issue_priorities.json`, { headers })
  ]);

  const currentUserData = currentUserRes.ok ? await currentUserRes.json() : { user: null };
  const prioritiesData = prioritiesRes.ok ? await prioritiesRes.json() : { issue_priorities: [] };
  const projectPathMap = buildProjectPathMap(projects);
  const usersById = new Map(users.map(user => [String(user.id), user]));

  if (currentUserData.user && currentUserData.user.id != null && !usersById.has(String(currentUserData.user.id))) {
    usersById.set(String(currentUserData.user.id), currentUserData.user);
  }
  
  return { 
    projects: projects
      .map(project => ({ ...project, pathLabel: projectPathMap.get(String(project.id)) || project.name }))
      .sort((a, b) => (a.pathLabel || a.name).localeCompare(b.pathLabel || b.name)),
    users: [...usersById.values()].sort((a, b) => {
      const lastNameCompare = (a.lastname || '').localeCompare(b.lastname || '');
      if (lastNameCompare !== 0) return lastNameCompare;

      const firstNameCompare = (a.firstname || '').localeCompare(b.firstname || '');
      if (firstNameCompare !== 0) return firstNameCompare;

      return String(a.id).localeCompare(String(b.id));
    }),
    priorities: prioritiesData.issue_priorities 
  };
}
