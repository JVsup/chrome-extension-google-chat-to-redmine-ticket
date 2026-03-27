// Toggle provider settings visibility based on dropdown selection
const updateProviderUI = () => {
  const selectedProvider = document.getElementById('aiProvider').value;
  document.querySelectorAll('.provider-settings').forEach(el => el.classList.remove('active'));
  document.getElementById(`settings-${selectedProvider}`).classList.add('active');
};

document.getElementById('aiProvider').addEventListener('change', updateProviderUI);

// Saves options to chrome.storage
const saveOptions = () => {
  const settings = {
    outputLanguage: document.getElementById('outputLanguage').value,
    aiProvider: document.getElementById('aiProvider').value,
    
    openRouterKey: document.getElementById('openRouterKey').value,
    openRouterModel: document.getElementById('openRouterModel').value,
    
    openAiKey: document.getElementById('openAiKey').value,
    openAiModel: document.getElementById('openAiModel').value,
    
    anthropicKey: document.getElementById('anthropicKey').value,
    anthropicModel: document.getElementById('anthropicModel').value,
    
    aiStudioKey: document.getElementById('aiStudioKey').value,
    aiStudioModel: document.getElementById('aiStudioModel').value,
    
    vertexJson: document.getElementById('vertexJson').value,
    vertexRegion: document.getElementById('vertexRegion').value,
    vertexModel: document.getElementById('vertexModel').value,

    customUrl: document.getElementById('customUrl').value,
    customKey: document.getElementById('customKey').value,
    customModel: document.getElementById('customModel').value,

    redmineUrl: document.getElementById('redmineUrl').value.replace(/\/$/, ''),
    redmineKey: document.getElementById('redmineKey').value,
    defaultProject: document.getElementById('defaultProject').value,
    defaultUser: document.getElementById('defaultUser').value
  };

  chrome.storage.sync.set(settings, () => {
    const status = document.getElementById('status');
    status.textContent = 'Options saved.';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
};

// Restores form state
const restoreOptions = () => {
  chrome.storage.sync.get(null, (items) => {
    document.getElementById('outputLanguage').value = items.outputLanguage || 'cs';
    document.getElementById('aiProvider').value = items.aiProvider || 'openrouter';
    
    document.getElementById('openRouterKey').value = items.openRouterKey || '';
    document.getElementById('openRouterModel').value = items.openRouterModel || 'meta-llama/llama-3.3-70b-instruct:free';
    
    document.getElementById('openAiKey').value = items.openAiKey || '';
    document.getElementById('openAiModel').value = items.openAiModel || 'gpt-4o';
    
    document.getElementById('anthropicKey').value = items.anthropicKey || '';
    document.getElementById('anthropicModel').value = items.anthropicModel || 'claude-3-7-sonnet-20250219';
    
    document.getElementById('aiStudioKey').value = items.aiStudioKey || '';
    document.getElementById('aiStudioModel').value = items.aiStudioModel || 'gemini-2.5-pro';
    
    document.getElementById('vertexJson').value = items.vertexJson || '';
    document.getElementById('vertexRegion').value = items.vertexRegion || 'us-central1';
    document.getElementById('vertexModel').value = items.vertexModel || 'gemini-1.5-pro-002';

    document.getElementById('customUrl').value = items.customUrl || '';
    document.getElementById('customKey').value = items.customKey || '';
    document.getElementById('customModel').value = items.customModel || '';

    document.getElementById('redmineUrl').value = items.redmineUrl || '';
    document.getElementById('redmineKey').value = items.redmineKey || '';
    document.getElementById('defaultProject').value = items.defaultProject || '';
    document.getElementById('defaultUser').value = items.defaultUser || '';

    updateProviderUI(); // Initialize UI state
  });
};

document.addEventListener('DOMContentLoaded', restoreOptions);
document.getElementById('saveBtn').addEventListener('click', saveOptions);