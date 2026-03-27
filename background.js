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
    console.log("[TicketExt] === NEW TICKET PROCESS STARTED ===");
    console.log("[TicketExt] Payload received from UI:", request.payload);
    
    processTicketFlow(request.payload)
      .then(async (result) => {
        console.log("[TicketExt] ✅ PROCESS SUCCESSFUL. Redmine Issue ID:", result.issue.id);
        const settings = await chrome.storage.sync.get(['redmineUrl']);
        const ticketUrl = `${settings.redmineUrl}/issues/${result.issue.id}`;
        
        showSystemNotification(result.issue.id, "Ticket Created", `Success! Ticket #${result.issue.id} has been created.`);
        
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "ticketCreated",
            ticketId: result.issue.id,
            ticketUrl: ticketUrl
          }).catch(err => console.warn("[TicketExt] Could not send success message to tab:", err));
        }
      })
      .catch(error => {
        console.error("[TicketExt] ❌ PROCESS FAILED:", error.message);
        console.error("[TicketExt] Full Error Object:", error);
        showSystemNotification(null, "Ticket Creation Failed", error.message);
        
        if (sender.tab && sender.tab.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "ticketError",
            errorMessage: error.message
          }).catch(err => console.warn("[TicketExt] Could not send error message to tab:", err));
        }
      });
    
    sendResponse({ status: "processing" });
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
async function executeWithRetry(operation, maxRetries = 3, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`AI API failed after ${maxRetries} attempts. Last error: ${error.message}`);
      }
      console.warn(`[TicketExt] Attempt ${attempt} failed: ${error.message}. Retrying in ${delayMs}ms...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms`);
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------------
// CORE TICKET FLOW
// ---------------------------------------------------------------------------------
async function processTicketFlow(payload) {
  const { messagesText, projectId, assigneeId, priorityId } = payload;
  console.log("[TicketExt] Loading settings from storage...");
  const settings = await chrome.storage.sync.get(null);

  if (!settings.redmineUrl || !settings.redmineKey) {
    throw new Error("Missing Redmine API keys or settings.");
  }

  console.log(`[TicketExt] Initiating AI call via Provider: ${settings.aiProvider || 'openrouter'}`);
  
  const aiResponse = await executeWithRetry(
    async () => {
      console.log("[TicketExt] Sending prompt to AI. Text length:", messagesText.length);
      const res = await callSelectedAiProvider(messagesText, settings);
      console.log("[TicketExt] Raw AI Response received:", res);
      return res;
    },
    3, 
    2000 
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
  
  // Pass priorityId to the issue creation function
  const redmineResult = await createRedmineIssue(ticketData, projectId, assigneeId, priorityId, settings);
  console.log("[TicketExt] Redmine API Response:", redmineResult);
  
  return redmineResult;
}

// ---------------------------------------------------------------------------------
// ROUTER FUNCTION
// ---------------------------------------------------------------------------------
async function callSelectedAiProvider(text, settings) {
  const provider = settings.aiProvider || 'openrouter';
  
  const langInstruction = settings.outputLanguage === 'en' 
    ? "Write the 'subject' and the prose parts of the 'description' entirely in English." 
    : "Write the 'subject' and the prose parts of the 'description' entirely in Czech language.";

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
      return await callOpenAiCompatible("https://openrouter.ai/api/v1/chat/completions", settings.openRouterKey, settings.openRouterModel, systemPrompt, text);
    case 'openai': 
      return await callOpenAiCompatible("https://api.openai.com/v1/chat/completions", settings.openAiKey, settings.openAiModel, systemPrompt, text);
    case 'anthropic': 
      return await callAnthropic(settings.anthropicKey, settings.anthropicModel, systemPrompt, text);
    case 'aistudio': 
      return await callGeminiApi(`https://generativelanguage.googleapis.com/v1beta/models/${settings.aiStudioModel}:generateContent?key=${settings.aiStudioKey}`, systemPrompt, text);
    case 'vertex': 
      return await callVertexAi(settings.vertexJson, settings.vertexRegion, settings.vertexModel, systemPrompt, text);
    case 'custom':
      if (!settings.customUrl) throw new Error("Custom Endpoint URL is missing.");
      const safeKey = settings.customKey || "sk-no-key-required";
      const safeModel = settings.customModel || "local-model";
      return await callOpenAiCompatible(settings.customUrl, safeKey, safeModel, systemPrompt, text);
    default: 
      throw new Error("Unknown AI provider selected.");
  }
}

// ---------------------------------------------------------------------------------
// PROVIDER SPECIFIC IMPLEMENTATIONS
// ---------------------------------------------------------------------------------

async function callOpenAiCompatible(url, apiKey, model, systemPrompt, text) {
  if (!apiKey) throw new Error("API Key is missing for selected provider.");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: model,
      response_format: { type: "json_object" }, 
      messages: [{ role: "system", content: systemPrompt }, { role: "user", content: text }]
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`API error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callAnthropic(apiKey, model, systemPrompt, text) {
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
  });
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`Anthropic error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return "{" + data.content[0].text; 
}

async function callGeminiApi(endpointUrl, systemPrompt, text) {
  const response = await fetchWithTimeout(endpointUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: { text: systemPrompt } },
      contents: [{ role: "user", parts: [{ text: text }] }],
      generationConfig: { responseMimeType: "application/json" }
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') ? `HTTP ${response.status}` : errorText;
    throw new Error(`Gemini error: ${response.status} ${cleanError}`);
  }
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callVertexAi(jsonStr, region, model, systemPrompt, text) {
  if (!jsonStr) throw new Error("Vertex AI Service Account JSON is missing.");
  let saData;
  try { saData = JSON.parse(jsonStr); } catch (e) { throw new Error("Invalid Service Account JSON"); }
  
  const accessToken = await getGoogleOAuthToken(saData);
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
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    const cleanError = errorText.includes('<html') 
      ? `HTTP ${response.status} (Endpoint routing failed.)` 
      : errorText;
    throw new Error(`Vertex error: ${response.status} ${cleanError}`);
  }
  
  const data = await response.json();
  
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
async function getGoogleOAuthToken(saData) {
  const toBase64Url = (str) => btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const str2ab = (str) => {
    const buf = new ArrayBuffer(str.length);
    const bufView = new Uint8Array(buf);
    for (let i = 0, strLen = str.length; i < strLen; i++) bufView[i] = str.charCodeAt(i);
    return buf;
  };
  
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
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

  const pem = saData.private_key.replace(/-----BEGIN PRIVATE KEY-----/, '').replace(/-----END PRIVATE KEY-----/, '').replace(/\s/g, '');
  const binaryDerString = atob(pem);
  const binaryDer = str2ab(binaryDerString);

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

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

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
  });
  
  if (!tokenRes.ok) throw new Error("Failed to generate Google OAuth Token");
  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ---------------------------------------------------------------------------------
// REDMINE LOGIC
// ---------------------------------------------------------------------------------
async function createRedmineIssue(ticketData, projectId, assigneeId, priorityId, settings) {
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
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Redmine API error: ${response.status}`);
  return await response.json();
}

async function fetchRedmineMetadata() {
  const settings = await chrome.storage.sync.get(['redmineUrl', 'redmineKey']);
  if (!settings.redmineUrl || !settings.redmineKey) return null;

  // Added fetch for issue_priorities.json
  const [projectsRes, usersRes, prioritiesRes] = await Promise.all([
    fetch(`${settings.redmineUrl}/projects.json?limit=100`, { headers: { "X-Redmine-API-Key": settings.redmineKey } }),
    fetch(`${settings.redmineUrl}/users.json?limit=100`, { headers: { "X-Redmine-API-Key": settings.redmineKey } }),
    fetch(`${settings.redmineUrl}/enumerations/issue_priorities.json`, { headers: { "X-Redmine-API-Key": settings.redmineKey } })
  ]);
  
  const projectsData = projectsRes.ok ? await projectsRes.json() : { projects: [] };
  const usersData = usersRes.ok ? await usersRes.json() : { users: [] };
  const prioritiesData = prioritiesRes.ok ? await prioritiesRes.json() : { issue_priorities: [] };
  
  return { 
    projects: projectsData.projects, 
    users: usersData.users,
    priorities: prioritiesData.issue_priorities 
  };
}