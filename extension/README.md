# MemBlock

MemBlock adds persistent memory to GitHub Copilot Chat in VS Code.

It lets you save useful context from chat, the clipboard, or the active editor and retrieve it later inside the same workspace.

This extension stores memories locally in the workspace and ranks relevant matches using a lightweight deterministic embedding.

## Features

- Save copied chat content with `MemBlock: Save Current Chat`
- Store arbitrary text, clipboard content, or the active editor with `MemBlock: Store Memory`
- Browse saved memories with `MemBlock: Retrieve Memory`
- Use the `@memory` chat participant to recall or save context directly in chat
- Optionally auto-capture document changes with the `memblock.autoCapture` setting

## Commands

- `MemBlock: Save Current Chat`
- `MemBlock: Store Memory`
- `MemBlock: Retrieve Memory`

## How it works

- `MemBlock: Save Current Chat` copies the active chat transcript and stores it as a memory
- `MemBlock: Store Memory` saves clipboard text, manual input, or the active editor content
- `MemBlock: Retrieve Memory` lets you pick from stored memories and opens them in a new document
- `@memory` retrieves the most relevant stored memories for the current prompt

## Chat participant

Use `@memory` in Copilot Chat.

- `@memory your question` — recalls relevant memories
- `@memory /save optional text` — saves the supplied text, or the current chat history when no text is supplied
- `@memory /recall your question` — explicitly recalls memories

## Storage

Memories are stored locally in a `.copilot-memory` folder inside the current project.

Each memory contains:

- the source
- the stored content
- a deterministic embedding used for similarity matching

Memories are stored as JSON files, so no external service or separate backend is required.

## Configuration

### `memblock.autoCapture`

- Type: `boolean`
- Default: `false`

When enabled, MemBlock stores the current document content after edits using a short debounce.

## Development

```bash
npm install
npm run compile
```

To run the extension in development, press **F5** in VS Code to open an Extension Development Host window.
