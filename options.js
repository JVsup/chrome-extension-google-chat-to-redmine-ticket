// Toggle provider settings visibility based on dropdown selection
const statusResetTimers = new WeakMap();

const setStatusMessage = (element, message, color, clearAfterMs = null) => {
  if (!element) return;

  const existingTimer = statusResetTimers.get(element);
  if (existingTimer) {
    clearTimeout(existingTimer);
    statusResetTimers.delete(element);
  }

  element.textContent = message;
  element.style.color = color;

  if (clearAfterMs) {
    const timeoutId = setTimeout(() => {
      element.textContent = '';
      statusResetTimers.delete(element);
    }, clearAfterMs);

    statusResetTimers.set(element, timeoutId);
  }
};

const updateProviderUI = () => {
  const selectedProvider = document.getElementById('aiProvider').value;
  document.querySelectorAll('.provider-settings').forEach(el => el.classList.remove('active'));
  document.getElementById(`settings-${selectedProvider}`).classList.add('active');

  // Handle visibility of the AI Test button vs Vertex warning box
  const testAiBtn = document.getElementById('testAiBtn');
  const vertexWarning = document.getElementById('vertexWarning');
  const aiStatus = document.getElementById('aiStatus');

  if (aiStatus) aiStatus.textContent = ''; // Clear status message on provider switch

  if (selectedProvider === 'vertex') {
    testAiBtn.classList.add('hidden');
    vertexWarning.classList.remove('hidden');
  } else {
    testAiBtn.classList.remove('hidden');
    vertexWarning.classList.add('hidden');
  }
};

document.getElementById('aiProvider').addEventListener('change', updateProviderUI);

const searchableFieldStates = new Map();
const AI_MODEL_FIELD_IDS = ['openRouterModel', 'openAiModel', 'anthropicModel', 'aiStudioModel', 'customModel'];
const AI_MODEL_LABEL_FIELD_IDS = {
  openRouterModel: 'openRouterModelSearch',
  openAiModel: 'openAiModelSearch',
  anthropicModel: 'anthropicModelSearch',
  aiStudioModel: 'aiStudioModelSearch',
  customModel: 'customModelSearch'
};

const initSelectField = (id, defaultValue, label = defaultValue) => {
  const select = document.getElementById(id);
  const safeValue = defaultValue || '';
  const safeLabel = label || defaultValue || '';
  select.innerHTML = `<option value="${safeValue}">${safeLabel}</option>`;
  select.value = safeValue;
};

const formatUserLabel = (user) => `${[user.lastname || '', user.firstname || ''].filter(Boolean).join(' ')} (#${user.id})`;

const closeSearchableField = (fieldId) => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  state.listbox.hidden = true;
  state.input.setAttribute('aria-expanded', 'false');
  state.activeIndex = -1;
};

const renderSearchableFieldOptions = (fieldId, filterText = '') => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  const normalizedFilter = filterText.trim().toLocaleLowerCase();
  state.filteredOptions = normalizedFilter
    ? state.options.filter(option => option.label.toLocaleLowerCase().includes(normalizedFilter))
    : [...state.options];

  state.listbox.innerHTML = '';
  state.activeIndex = state.filteredOptions.length > 0 ? 0 : -1;

  if (state.filteredOptions.length === 0) {
    const emptyItem = document.createElement('li');
    emptyItem.className = 'combo-empty';
    emptyItem.textContent = 'No matches found';
    state.listbox.appendChild(emptyItem);
    return;
  }

  state.filteredOptions.forEach((optionData, index) => {
    const option = document.createElement('li');
    option.className = `combo-option${index === state.activeIndex ? ' active' : ''}`;
    option.textContent = optionData.label;
    option.setAttribute('role', 'option');
    option.dataset.value = optionData.value;
    option.dataset.label = optionData.label;
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      selectSearchableFieldOption(fieldId, optionData);
    });
    state.listbox.appendChild(option);
  });
};

const updateSearchableFieldActiveOption = (fieldId) => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  Array.from(state.listbox.querySelectorAll('.combo-option')).forEach((optionEl, index) => {
    optionEl.classList.toggle('active', index === state.activeIndex);
  });
};

const openSearchableField = (fieldId, filterText = '') => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  renderSearchableFieldOptions(fieldId, filterText);
  state.listbox.hidden = false;
  state.input.setAttribute('aria-expanded', 'true');
};

const selectSearchableFieldOption = (fieldId, optionData) => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  state.hiddenInput.value = optionData.value;
  state.input.value = optionData.label;
  state.selectedLabel = optionData.label;
  closeSearchableField(fieldId);
};

const initializeSearchableField = (fieldId, inputId, listboxId, toggleId) => {
  const hiddenInput = document.getElementById(fieldId);
  const input = document.getElementById(inputId);
  const listbox = document.getElementById(listboxId);
  const toggle = document.getElementById(toggleId);

  searchableFieldStates.set(fieldId, {
    hiddenInput,
    input,
    listbox,
    toggle,
    options: [],
    filteredOptions: [],
    selectedLabel: '',
    activeIndex: -1
  });

  input.addEventListener('focus', () => {
    openSearchableField(fieldId, input.value);
  });

  input.addEventListener('input', () => {
    const state = searchableFieldStates.get(fieldId);
    state.hiddenInput.value = '';
    openSearchableField(fieldId, input.value);
  });

  input.addEventListener('keydown', (event) => {
    const state = searchableFieldStates.get(fieldId);

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (state.listbox.hidden) {
        openSearchableField(fieldId, input.value);
        return;
      }
      if (state.filteredOptions.length > 0) {
        state.activeIndex = Math.min(state.activeIndex + 1, state.filteredOptions.length - 1);
        updateSearchableFieldActiveOption(fieldId);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!state.listbox.hidden && state.filteredOptions.length > 0) {
        state.activeIndex = Math.max(state.activeIndex - 1, 0);
        updateSearchableFieldActiveOption(fieldId);
      }
      return;
    }

    if (event.key === 'Enter') {
      if (!state.listbox.hidden && state.activeIndex >= 0 && state.filteredOptions[state.activeIndex]) {
        event.preventDefault();
        selectSearchableFieldOption(fieldId, state.filteredOptions[state.activeIndex]);
      }
      return;
    }

    if (event.key === 'Escape') {
      closeSearchableField(fieldId);
    }
  });

  input.addEventListener('blur', () => {
    window.setTimeout(() => {
      const state = searchableFieldStates.get(fieldId);
      if (!state.hiddenInput.value) {
        state.input.value = state.selectedLabel || '';
      }
      closeSearchableField(fieldId);
    }, 120);
  });

  toggle.addEventListener('click', () => {
    const state = searchableFieldStates.get(fieldId);
    if (state.listbox.hidden) {
      openSearchableField(fieldId, state.input.value);
      state.input.focus();
    } else {
      closeSearchableField(fieldId);
    }
  });
};

const setSearchableFieldValue = (fieldId, value = '', label = '', options = null) => {
  const state = searchableFieldStates.get(fieldId);
  if (!state) return;

  if (options) {
    state.options = options.map(option => ({
      value: String(option.value),
      label: option.label
    }));
  }

  state.hiddenInput.value = value ? String(value) : '';
  state.input.value = label || '';
  state.selectedLabel = label || '';
  closeSearchableField(fieldId);
};

const populateSearchableField = (fieldId, items, getValue, getLabel, previousValue = '') => {
  const options = items.map(item => ({
    value: String(getValue(item)),
    label: getLabel(item)
  }));

  const selectedOption = (previousValue && options.find(option => option.value === String(previousValue))) || options[0] || null;
  setSearchableFieldValue(
    fieldId,
    selectedOption ? selectedOption.value : '',
    selectedOption ? selectedOption.label : '',
    options
  );
};

const formatModelOptions = (models) => {
  return [...models]
    .sort((a, b) => a.localeCompare(b))
    .map(id => {
      if (!id.includes('/')) {
        return { id, label: id };
      }

      const slashIndex = id.indexOf('/');
      const author = id.substring(0, slashIndex);
      const modelName = id.substring(slashIndex + 1);
      return { id, label: `${author} / ${modelName}` };
    });
};

const fetchAllRedminePages = async (baseUrl, resourcePath, headers, key) => {
  const pageSize = 100;
  const items = [];
  let offset = 0;
  let totalCount = null;

  do {
    const separator = resourcePath.includes('?') ? '&' : '?';
    const response = await fetch(`${baseUrl}${resourcePath}${separator}limit=${pageSize}&offset=${offset}`, {
      method: "GET",
      headers
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
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

const formatProjectOptions = (projects) => {
  const projectPathMap = buildProjectPathMap(projects);

  return [...projects]
    .sort((a, b) => {
      const labelA = projectPathMap.get(String(a.id)) || a.name;
      const labelB = projectPathMap.get(String(b.id)) || b.name;
      return labelA.localeCompare(labelB);
    })
    .map(project => ({
      ...project,
      pathLabel: projectPathMap.get(String(project.id)) || project.name
    }));
};

const formatUserOptions = (users, currentUser = null) => {
  const usersById = new Map();

  users.forEach(user => {
    usersById.set(String(user.id), user);
  });

  if (currentUser && currentUser.id != null && !usersById.has(String(currentUser.id))) {
    usersById.set(String(currentUser.id), currentUser);
  }

  return [...usersById.values()].sort((a, b) => {
    const lastNameCompare = (a.lastname || '').localeCompare(b.lastname || '');
    if (lastNameCompare !== 0) return lastNameCompare;

    const firstNameCompare = (a.firstname || '').localeCompare(b.firstname || '');
    if (firstNameCompare !== 0) return firstNameCompare;

    return String(a.id).localeCompare(String(b.id));
  });
};

// Saves options to chrome.storage and requests necessary host permissions dynamically
const saveOptions = () => {
  const redmineUrlInput = document.getElementById('redmineUrl').value.replace(/\/$/, '');
  const aiProvider = document.getElementById('aiProvider').value;
  const customUrlInput = document.getElementById('customUrl').value;
  const defaultProject = document.getElementById('defaultProject').value;
  const defaultUser = document.getElementById('defaultUser').value;
  const defaultProjectSearch = document.getElementById('defaultProjectSearch').value.trim();
  const defaultUserSearch = document.getElementById('defaultUserSearch').value.trim();
  
  if (!redmineUrlInput) {
    alert("Please enter a valid Redmine URL.");
    return;
  }

  if (defaultProjectSearch && !defaultProject) {
    alert("Please choose a project from the suggestion list.");
    return;
  }

  if (defaultUserSearch && !defaultUser) {
    alert("Please choose a user from the suggestion list.");
    return;
  }

  for (const fieldId of AI_MODEL_FIELD_IDS) {
    const hiddenValue = document.getElementById(fieldId).value;
    const searchValue = document.getElementById(AI_MODEL_LABEL_FIELD_IDS[fieldId]).value.trim();
    if (searchValue && !hiddenValue) {
      alert("Please choose a valid AI model from the suggestion list.");
      return;
    }
  }

  const originsToRequest = [];

  try {
    const redmineOrigin = new URL(redmineUrlInput).origin + "/*";
    originsToRequest.push(redmineOrigin);
  } catch (e) {
    alert("Invalid Redmine URL format.");
    return;
  }

  if (aiProvider === 'custom') {
    if (!customUrlInput) {
      alert("Please enter a Custom Endpoint URL.");
      return;
    }
    try {
      const customOrigin = new URL(customUrlInput).origin + "/*";
      if (!originsToRequest.includes(customOrigin)) {
        originsToRequest.push(customOrigin);
      }
    } catch (e) {
      alert("Invalid Custom Endpoint URL format.");
      return;
    }
  }

  chrome.permissions.request({
    origins: originsToRequest
  }, (granted) => {
    if (granted) {
      const settings = {
        outputLanguage: document.getElementById('outputLanguage').value,
        showRemainingTime: document.getElementById('showRemainingTime').checked,
        showAttemptCount: document.getElementById('showAttemptCount').checked,
        showTaskDuration: document.getElementById('showTaskDuration').checked,
        aiProvider: aiProvider,
        openRouterKey: document.getElementById('openRouterKey').value,
        openRouterModel: document.getElementById('openRouterModel').value,
        openRouterModelLabel: document.getElementById('openRouterModelSearch').value.trim(),
        openAiKey: document.getElementById('openAiKey').value,
        openAiModel: document.getElementById('openAiModel').value,
        openAiModelLabel: document.getElementById('openAiModelSearch').value.trim(),
        anthropicKey: document.getElementById('anthropicKey').value,
        anthropicModel: document.getElementById('anthropicModel').value,
        anthropicModelLabel: document.getElementById('anthropicModelSearch').value.trim(),
        aiStudioKey: document.getElementById('aiStudioKey').value,
        aiStudioModel: document.getElementById('aiStudioModel').value,
        aiStudioModelLabel: document.getElementById('aiStudioModelSearch').value.trim(),
        vertexJson: document.getElementById('vertexJson').value,
        vertexRegion: document.getElementById('vertexRegion').value,
        vertexModel: document.getElementById('vertexModel').value,
        customUrl: customUrlInput,
        customKey: document.getElementById('customKey').value,
        customModel: document.getElementById('customModel').value,
        customModelLabel: document.getElementById('customModelSearch').value.trim(),
        redmineUrl: redmineUrlInput,
        redmineKey: document.getElementById('redmineKey').value,
        defaultProject: defaultProject,
        defaultProjectLabel: defaultProjectSearch,
        defaultUser: defaultUser,
        defaultUserLabel: defaultUserSearch
      };

      chrome.storage.sync.set(settings, () => {
        const status = document.getElementById('status');
        setStatusMessage(status, 'Options saved and permissions granted.', 'green', 3000);
      });
      
    } else {
      const status = document.getElementById('status');
      setStatusMessage(status, 'Failed to save: Required permissions were denied.', 'red', 4000);
    }
  });
};

// ---------------------------------------------------------------------------------
// UNIVERSAL AI CONNECTION TESTING & MODEL DISCOVERY LOGIC
// ---------------------------------------------------------------------------------
const testAiConnection = async () => {
  const provider = document.getElementById('aiProvider').value;
  const status = document.getElementById('aiStatus');
  
  setStatusMessage(status, 'Testing AI connection & fetching models...', '#007bff');

  if (provider === 'vertex') {
    // This block is technically unreachable now since the button is hidden for Vertex,
    // but kept as a fallback safety measure.
    setStatusMessage(status, 'Vertex AI requires complex cloud routing. Auto-fetching models is not supported.', '#ff9800', 3000);
    return;
  }

  try {
    let url, headers = {}, extractModelsFn;
    
    // Map UI element IDs based on the selected provider
    const idMap = {
      'custom': 'customModel',
      'openai': 'openAiModel',
      'openrouter': 'openRouterModel',
      'aistudio': 'aiStudioModel',
      'anthropic': 'anthropicModel'
    }[provider];

    // Configure request specifics per provider
    if (provider === 'custom') {
      const customUrl = document.getElementById('customUrl').value;
      const apiKey = document.getElementById('customKey').value;
      if (!customUrl) throw new Error("Missing Custom URL");

      const origin = new URL(customUrl).origin + "/*";
      const granted = await new Promise(resolve => chrome.permissions.request({ origins: [origin] }, resolve));
      if (!granted) throw new Error("Browser permission denied by user.");

      url = customUrl.includes('/chat/completions') 
        ? customUrl.replace('/chat/completions', '/models')
        : customUrl.replace(/\/$/, '') + '/models';
      headers = { "Content-Type": "application/json" };
      if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
      extractModelsFn = (data) => data.data.map(m => m.id);

    } else if (provider === 'openai') {
      const key = document.getElementById('openAiKey').value;
      if (!key) throw new Error("Missing OpenAI API Key");
      url = 'https://api.openai.com/v1/models';
      headers = { "Authorization": `Bearer ${key}` };
      extractModelsFn = (data) => data.data.map(m => m.id);

    } else if (provider === 'openrouter') {
      const key = document.getElementById('openRouterKey').value;
      if (!key) throw new Error("Missing OpenRouter API Key");
      url = 'https://openrouter.ai/api/v1/models';
      headers = { "Authorization": `Bearer ${key}` };
      extractModelsFn = (data) => data.data.map(m => m.id);

    } else if (provider === 'aistudio') {
      const key = document.getElementById('aiStudioKey').value;
      if (!key) throw new Error("Missing AI Studio API Key");
      url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
      extractModelsFn = (data) => data.models.map(m => m.name.replace('models/', ''));

    } else if (provider === 'anthropic') {
      const key = document.getElementById('anthropicKey').value;
      if (!key) throw new Error("Missing Anthropic API Key");
      url = 'https://api.anthropic.com/v1/models';
      headers = {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerously-allow-browser": "true" 
      };
      extractModelsFn = (data) => data.data.map(m => m.id);
    }

    // Execute the fetch
    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) throw new Error(`HTTP ${response.status} - Verification failed`);
    const data = await response.json();

    // Parse models safely
    const models = extractModelsFn(data);

    if (models && Array.isArray(models) && models.length > 0) {
      const previousValue = document.getElementById(idMap).value;
      const modelOptions = formatModelOptions(models);

      populateSearchableField(
        idMap,
        modelOptions,
        model => model.id,
        model => model.label,
        previousValue
      );

      setStatusMessage(status, `Success! ${models.length} models loaded.`, 'green', 3000);
    } else {
      throw new Error("Invalid format received from /models endpoint");
    }

  } catch (err) {
    setStatusMessage(status, `Connection failed: ${err.message}`, 'red', 4000);
  }
};

// ---------------------------------------------------------------------------------
// REDMINE CONNECTION TESTING LOGIC
// ---------------------------------------------------------------------------------
const testRedmineConnection = async () => {
  const redmineUrlInput = document.getElementById('redmineUrl').value.replace(/\/$/, '');
  const redmineKey = document.getElementById('redmineKey').value;
  const status = document.getElementById('redmineStatus');

  setStatusMessage(status, 'Testing Redmine connection...', '#007bff');

  if (!redmineUrlInput || !redmineKey) {
    setStatusMessage(status, 'Missing Redmine URL or API Key.', 'red', 4000);
    return;
  }

  try {
    const origin = new URL(redmineUrlInput).origin + "/*";
    const granted = await new Promise(resolve => chrome.permissions.request({ origins: [origin] }, resolve));
    if (!granted) throw new Error("Browser permission denied by user.");

    const previousProject = document.getElementById('defaultProject').value;
    const previousUser = document.getElementById('defaultUser').value;
    const headers = { "X-Redmine-API-Key": redmineKey };

    const [currentUserResponse, projects, users] = await Promise.all([
      fetch(`${redmineUrlInput}/users/current.json`, { method: "GET", headers }),
      fetchAllRedminePages(redmineUrlInput, '/projects.json', headers, 'projects'),
      fetchAllRedminePages(redmineUrlInput, '/users.json', headers, 'users')
    ]);

    if (!currentUserResponse.ok) {
      if (currentUserResponse.status === 401) throw new Error("HTTP 401 - Invalid API Key.");
      if (currentUserResponse.status === 404) throw new Error("HTTP 404 - Redmine API is disabled or wrong URL.");
      throw new Error(`HTTP ${currentUserResponse.status}`);
    }

    const data = await currentUserResponse.json();
    if (!data || !data.user) {
      throw new Error("Invalid response format from Redmine.");
    }

    const projectOptions = formatProjectOptions(projects);
    const userOptions = formatUserOptions(users, data.user);

    if (projectOptions.length > 0) {
      populateSearchableField(
        'defaultProject',
        projectOptions,
        project => project.id,
        project => `${project.pathLabel} (#${project.id})`,
        previousProject
      );
    } else {
      setSearchableFieldValue('defaultProject', previousProject, previousProject || '');
    }

    if (userOptions.length > 0) {
      populateSearchableField(
        'defaultUser',
        userOptions,
        user => user.id,
        user => formatUserLabel(user),
        previousUser
      );
    } else {
      setSearchableFieldValue('defaultUser', previousUser, previousUser || '');
    }

    setStatusMessage(
      status,
      `Success! ${projectOptions.length} projects and ${userOptions.length} users loaded.`,
      'green',
      4000
    );
  } catch (err) {
    setStatusMessage(status, `Connection failed: ${err.message}`, 'red', 4000);
  }
};

// Restores form state
const restoreOptions = () => {
  chrome.storage.sync.get(null, (items) => {
    document.getElementById('outputLanguage').value = items.outputLanguage || 'English';
    document.getElementById('showRemainingTime').checked = items.showRemainingTime !== false;
    document.getElementById('showAttemptCount').checked = items.showAttemptCount !== false;
    document.getElementById('showTaskDuration').checked = items.showTaskDuration !== false;
    document.getElementById('aiProvider').value = items.aiProvider || 'openrouter';
    
    // Initialize searchable model fields
    setSearchableFieldValue(
      'openRouterModel',
      items.openRouterModel || 'meta-llama/llama-3.3-70b-instruct:free',
      items.openRouterModelLabel || items.openRouterModel || 'meta-llama/llama-3.3-70b-instruct:free'
    );
    setSearchableFieldValue(
      'openAiModel',
      items.openAiModel || 'gpt-4o',
      items.openAiModelLabel || items.openAiModel || 'gpt-4o'
    );
    setSearchableFieldValue(
      'anthropicModel',
      items.anthropicModel || 'claude-3-7-sonnet-20250219',
      items.anthropicModelLabel || items.anthropicModel || 'claude-3-7-sonnet-20250219'
    );
    setSearchableFieldValue(
      'aiStudioModel',
      items.aiStudioModel || 'gemini-2.5-pro',
      items.aiStudioModelLabel || items.aiStudioModel || 'gemini-2.5-pro'
    );
    setSearchableFieldValue(
      'customModel',
      items.customModel || 'local-model',
      items.customModelLabel || items.customModel || 'local-model'
    );
    setSearchableFieldValue('defaultProject', items.defaultProject || '', items.defaultProjectLabel || '');
    setSearchableFieldValue('defaultUser', items.defaultUser || '', items.defaultUserLabel || '');
    
    // Vertex model remains a text input
    document.getElementById('vertexModel').value = items.vertexModel || 'gemini-1.5-pro-002';
    
    // Standard inputs
    document.getElementById('openRouterKey').value = items.openRouterKey || '';
    document.getElementById('openAiKey').value = items.openAiKey || '';
    document.getElementById('anthropicKey').value = items.anthropicKey || '';
    document.getElementById('aiStudioKey').value = items.aiStudioKey || '';
    document.getElementById('vertexJson').value = items.vertexJson || '';
    document.getElementById('vertexRegion').value = items.vertexRegion || 'us-central1';
    
    document.getElementById('customUrl').value = items.customUrl || '';
    document.getElementById('customKey').value = items.customKey || '';

    document.getElementById('redmineUrl').value = items.redmineUrl || '';
    document.getElementById('redmineKey').value = items.redmineKey || '';

    updateProviderUI(); 
  });
};

document.addEventListener('click', (event) => {
  searchableFieldStates.forEach((state, fieldId) => {
    const comboRoot = state.input.closest('.combo');
    if (comboRoot && !comboRoot.contains(event.target)) {
      closeSearchableField(fieldId);
    }
  });
});

initializeSearchableField('openRouterModel', 'openRouterModelSearch', 'openRouterModelListbox', 'openRouterModelToggle');
initializeSearchableField('openAiModel', 'openAiModelSearch', 'openAiModelListbox', 'openAiModelToggle');
initializeSearchableField('anthropicModel', 'anthropicModelSearch', 'anthropicModelListbox', 'anthropicModelToggle');
initializeSearchableField('aiStudioModel', 'aiStudioModelSearch', 'aiStudioModelListbox', 'aiStudioModelToggle');
initializeSearchableField('customModel', 'customModelSearch', 'customModelListbox', 'customModelToggle');
initializeSearchableField('defaultProject', 'defaultProjectSearch', 'defaultProjectListbox', 'defaultProjectToggle');
initializeSearchableField('defaultUser', 'defaultUserSearch', 'defaultUserListbox', 'defaultUserToggle');
document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);
document.getElementById('testAiBtn').addEventListener('click', testAiConnection);
document.getElementById('testRedmineBtn').addEventListener('click', testRedmineConnection);
