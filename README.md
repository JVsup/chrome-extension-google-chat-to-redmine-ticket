# Chat to Redmine Ticket

Chrome extension for quickly creating a Redmine ticket from selected text in Google Chat.

## What It Does

You select text in Google Chat, the extension sends it to the AI model you configured, takes the JSON response with `subject` and `description`, and creates a new ticket in Redmine.

Features:

- trigger from the extension icon
- trigger from the right-click context menu on selected text
- trigger with `Ctrl+Shift+Y` / `Cmd+Shift+Y`
- choose project, assignee, and priority before creating the ticket
- save a default project and default assignee
- fetch model lists from OpenRouter / OpenAI / NanoGPT / Anthropic / Google AI Studio / custom OpenAI-compatible endpoint
- fetch projects, users, and priorities from Redmine
- show progress, timeout, retry count, and task duration
- queue multiple requests, including cancelling running or queued requests

Supported AI backends:

- OpenRouter
- OpenAI
- NanoGPT
- Anthropic
- Google AI Studio
- Google Vertex AI
- custom OpenAI-compatible endpoint

## How It Works

1. Select text with your mouse in Google Chat and right-click the highlighted selection.
2. The extension opens a small dialog where you can change the project, assignee, and priority from their default values.
3. The selected text is sent to the AI provider you configured.
4. The prompt tells the model to return JSON with exactly two fields:
   `subject` and `description`
5. `description` is expected to be structured Markdown for Redmine, while preserving technical details such as URLs, IPs, logs, paths, payloads, and config snippets.
6. The extension sends the result to the Redmine API and creates a new issue.

Important:

- The extension does not "understand" the text on its own. Output quality depends directly on the model you use.
- The full selected text is sent to the AI service you configured.
- The ticket is created only after the AI responds. If the model returns bad JSON or bad content, the result will be bad or the ticket will fail.

## Installation

1. Open `chrome://extensions/`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select this project folder

## Configuration

Open the extension settings by right-clicking the extension icon and choosing `Options`.

Fill in:

- `Redmine Server URL`
- `Redmine API Key`
- AI provider
- API key / endpoint / model based on the selected provider

Recommended setup flow:

1. Enter the Redmine URL and API key.
2. Click `Test Redmine Connection & Fetch IDs`.
3. Pick the default project and default assignee from the fetched list.
4. Select the AI provider.
5. Enter the API key.
6. Click `Test AI Connection & Fetch Models`.
7. Pick a model from the fetched list.
8. Click `Save All Settings`.

## Quick Test With OpenRouter Free Models

The easiest first test is OpenRouter with a free model.

1. Create an account at `https://openrouter.ai/`
2. Generate an API key in the dashboard
3. In the extension, set:
   `AI Provider = OpenRouter`
4. Paste the API key
5. Click `Test AI Connection & Fetch Models`
6. Pick a model with the `:free` suffix
   Example: `meta-llama/llama-3.3-70b-instruct:free`
7. Save the settings

OpenRouter notes:

- Free models are marked with `:free` in the model name.
- Free model availability, rate limits, and rules may change over time.
- Check OpenRouter's FAQ and free model limitations here:
  `https://openrouter.ai/docs/faq#are-there-free-models`
- Browse available models here:
  `https://openrouter.ai/models`

## How To Enable Redmine API And Get An API Key

In most Redmine setups:

1. Sign in to Redmine
2. Open `My account`
3. Find the `API access key` section
4. View or generate the key

If the API test fails:

- make sure REST API is enabled in Redmine
- make sure the URL points to the Redmine root, not to a specific issue page
- `404` usually means a wrong URL or disabled API
- `401` usually means an invalid API key

## How To Try The Extension

1. Open Google Chat
2. Select part of a conversation
3. Trigger the extension
4. Choose project, assignee, and priority
5. Click `Generate & Send`
6. Wait for the request to finish
7. On success, you will see the new ticket number and a link to the created Redmine issue

## Important Warnings

### Data Safety

All selected text is sent to the AI service you configured. This is the most important thing to understand.

Do not send anything to the model that must not leave your environment unless you fully trust the provider and its policies. That includes:

- internal or confidential information
- credentials
- personal data
- customer data
- sensitive logs, config, or incident details

The extension does not anonymize, mask, or filter the selected text. It forwards it as-is.

### Processing Time And Output Quality

Ticket generation can take time, especially with:

- free models
- local models
- slow or overloaded endpoints
- long inputs

The final ticket quality depends heavily on the model you use.

From practical testing:

- models below `70B` often give weaker results
- models below `20B` are usually very poor for this use case
- smaller models may have trouble translating into languages other than English, or whatever language they were primarily trained on

That is not a hard rule. If you have a smaller model that is specifically tuned for analysis and ticket creation, it may still work well.

### Context Window Limits

If you send a huge amount of text to the LLM, you may hit the model's maximum context limit.

This mainly affects smaller models with smaller context windows.

The extension does not measure prompt size and does not know the real context limit of the selected model. If the input is too large:

- the request may fail
- the model may ignore part of the input
- the model may return a worse or incomplete ticket

## Where Data Is Stored

The extension stores settings in `chrome.storage.sync`.

This typically includes:

- Redmine URL
- Redmine API key
- AI API key
- selected model
- default project
- default assignee
- progress indicator display settings

## Limitations

- works only in Google Chat (`chat.google.com` and `mail.google.com/chat`)
- requires manually selected text
- output quality depends on the model
- Vertex AI model list fetching is not supported in the options page, so the model must be entered manually
- the extension does not protect sensitive data or validate prompt size

## License & Disclaimer

This project is licensed under the [MIT License](LICENSE).

In plain English: whether this extension supercharges your productivity or accidentally teaches your cat how to delete all your hard work, it is provided strictly "as-is", with no warranty, so use it entirely at your own risk!

## Privacy

- See [PRIVACY](https://jvsup.github.io/chrome-extension-google-chat-to-redmine-ticket/privacy.html).
