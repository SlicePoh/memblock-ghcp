# Copilot Memory

A VS Code extension that gives GitHub Copilot persistent memory across chat sessions. Store context from conversations, code, or clipboard — then retrieve it automatically in future chats using `@memory`.

## How It Works

- **Extension** (TypeScript) — adds commands and a `@memory` chat participant to VS Code
- **Memory Engine** (Rust) — local HTTP server that stores and retrieves memories using semantic embeddings
- **Storage** — memories saved as MessagePack files (`.mpk`) inside your project's `.copilot-memory/` folder

## Prerequisites

- [Rust](https://rustup.rs/) (for the backend)
- [Node.js](https://nodejs.org/) (for the extension)
- VS Code with GitHub Copilot

## Setup

### 1. Start the backend

```bash
cd memory-engine
cargo run
```

The server starts on `http://127.0.0.1:3210`.

### 2. Run the extension

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

Every `@memory` exchange is **auto-saved** — context accumulates automatically across sessions.

### Manual Commands (Command Palette)

**Store Memory** (`Copilot Memory: Store Memory`)

Choose a source:
- **Clipboard** — copy a chat conversation first, then store it
- **Enter Text** — type or paste any text
- **Active Editor** — store the current file or selection

**Retrieve Memory** (`Copilot Memory: Retrieve Memory`)

Shows a **multi-select picker** with all stored memories. Check the ones you want and they open in a new document.

## Project Structure

```
extension/          VS Code extension (TypeScript)
  src/
    extension.ts      Commands, chat participant, auto-capture
    memoryClient.ts   HTTP client for the backend

memory-engine/      Rust backend server
  src/
    main.rs           Server entry point (tracing, CORS, body limits)
    routes.rs         HTTP handlers (/store, /retrieve, /list, /health)
    storage.rs        MessagePack filesystem storage
    embedding.rs      Deterministic 128-dim embedding (placeholder)
    retrieval.rs      Cosine similarity scoring
    chunking.rs       Text chunking utility
```

## Storage Format

Memories are stored as `.mpk` (MessagePack) files in `{project}/.copilot-memory/`. Each file contains:

```
source:    where the memory came from
content:   the actual text
embedding: 128-dimensional float vector
```

MessagePack is ~30-40% smaller than equivalent JSON.

Add `.copilot-memory/` to your `.gitignore`.

## Configuration

| Setting | Default | Description |
|---|---|---|
| `copilotMemory.serverUrl` | `http://127.0.0.1:3210` | Backend server URL |
| `copilotMemory.autoCapture` | `false` | Auto-capture document changes as memories |

## Running Tests

```bash
cd memory-engine
cargo test
```

## Future Improvements

- Replace placeholder embedding with a real model
- Add chunking before storing large content
- Add recency weighting to retrieval
- Publish to VS Code Marketplace
