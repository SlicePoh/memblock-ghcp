# MemBlock

MemBlock is a VS Code extension that gives GitHub Copilot persistent memory across chat sessions. Store context from conversations, code, or the clipboard, then retrieve it later with `@memory` or the command palette.

## How It Works

- **Extension** (TypeScript) — adds commands and a `@memory` chat participant to VS Code
- **Storage** — memories are stored locally inside your project's `.copilot-memory/` folder
- **Retrieval** — saved content is ranked with a deterministic embedding-based similarity match

## Prerequisites

- [Node.js](https://nodejs.org/)
- VS Code with GitHub Copilot

## Setup

```bash
cd extension
npm install
npm run compile
```

Then press **F5** in VS Code to launch the Extension Development Host.

## Usage

### `@memory` in Copilot Chat

| Command | What it does |
|---|---|
| `@memory <question>` | Retrieves relevant stored memories and answers using them as context |
| `@memory /save <text>` | Saves text as a memory for future sessions |
| `@memory /recall <query>` | Same as default — recalls memories matching the query |

MemBlock can also save chat content directly with `MemBlock: Save Current Chat`.

### Manual Commands (Command Palette)

**Store Memory** (`MemBlock: Store Memory`)

Choose a source:
- **Clipboard** — copy a chat conversation first, then store it
- **Enter Text** — type or paste any text
- **Active Editor** — store the current file or selection

**Retrieve Memory** (`Copilot Memory: Retrieve Memory`)

Shows a **multi-select picker** with all stored memories. Check the ones you want and they open in a new document.

## Project Structure

```
extension/          VS Code extension
  src/
    extension.ts      Commands, chat participant, and auto-capture
    memoryEngine.ts   Local memory storage and retrieval
    utils.ts          Shared helpers
```

## Storage Format

Memories are stored as `.json` files in `{project}/.copilot-memory/`. Each file contains:

```
source:    where the memory came from
content:   the actual text
embedding: 128-dimensional float vector
```

Add `.copilot-memory/` to your `.gitignore`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `memblock.autoCapture` | `false` | Auto-capture document changes as memories |

## Running Tests

```bash
cd extension
npm test
```

## Future Improvements

- Improve retrieval quality for larger memory sets
- Add better memory organization and filtering
- Expand command and chat workflows
