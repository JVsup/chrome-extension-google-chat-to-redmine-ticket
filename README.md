# Chat to Redmine Ticket

A Google Chrome extension that generates structured Redmine tickets directly from highlighted text in Google Chat. It utilizes AI models to parse conversations, preserve technical details (logs, IPs, credentials, scripts...), and format the output into a structured bug report or task.

Supported AI Providers:

* OpenRouter
* OpenAI
* Anthropic
* Google AI Studio
* Google Vertex AI
* Custom OpenAI compatible api

## Installation (Unpacked)

To install the extension locally in Developer Mode:

1. Save all extension files (`manifest.json`, `.js`, `.css`, `.html`, and `.png` icons) into a single directory on your machine.
2. Open Google Chrome and navigate to the URL: `chrome://extensions/`
3. Enable **Developer mode** using the toggle switch in the top right corner.
4. Click the **Load unpacked** button that appears in the top left.
5. Select the directory containing the extension files.
6. The extension will appear in your list. Pin it to your browser toolbar.

## Configuration

Before first use, you must configure the extension settings:

1. Right-click the extension icon in the toolbar and select **Options**.
2. Set your Redmine Server URL and API Key.
3. Provide the Default Project ID and Assignee ID.
4. Select your preferred AI Provider and input the corresponding API Key or Service Account JSON.
5. Save the settings.

## Usage

1. Highlight the relevant text/conversation in Google Chat.
2. Trigger the extension via:
   * The extension icon in the toolbar.
   * Right-click context menu ("Create Redmine Ticket from Selection").
   * Keyboard shortcut (`Ctrl+Shift+Y` or `Cmd+Shift+Y`).
3. Verify the target project and assignee, then click "Generate & Send".
