import * as vscode from "vscode";
import { storeMemory, retrieveMemory } from "./memoryClient";

let autoCaptureDisposable: vscode.Disposable | undefined;

function getProjectRoot(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return "default";
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function activate(context: vscode.ExtensionContext) {
  console.log("copilot-memory extension activated");

  // ── Store Memory command ────────────────────────────────────────────────
  const storeCmd = vscode.commands.registerCommand(
    "copilotMemory.storeMemory",
    async () => {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "$(clippy) Clipboard", description: "Store content from clipboard (e.g. copied chat)", value: "clipboard" },
          { label: "$(edit) Enter Text", description: "Type or paste text manually", value: "input" },
          { label: "$(file) Active Editor", description: "Store the current file or selection", value: "editor" },
        ],
        { placeHolder: "Where should the memory come from?" }
      );

      if (!pick) {
        return;
      }

      let text = "";
      let source = "manual";

      if (pick.value === "clipboard") {
        text = await vscode.env.clipboard.readText();
        source = "clipboard";
      } else if (pick.value === "input") {
        const input = await vscode.window.showInputBox({
          prompt: "Enter the text to store as a memory",
          placeHolder: "Paste chat content or any text here",
        });
        if (!input) { return; }
        text = input;
        source = "manual-input";
      } else {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
          vscode.window.showWarningMessage("No active editor.");
          return;
        }
        const selection = editor.selection;
        text = selection.isEmpty
          ? editor.document.getText()
          : editor.document.getText(selection);
        source = editor.document.uri.fsPath;
      }

      if (!text.trim()) {
        vscode.window.showWarningMessage("Nothing to store — content is empty.");
        return;
      }

      try {
        const project = getProjectRoot();
        await storeMemory(project, source, text);
        vscode.window.showInformationMessage("Memory stored.");
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to store memory: ${err.message}`);
      }
    }
  );

  // ── Retrieve Memory command ─────────────────────────────────────────────
  const retrieveCmd = vscode.commands.registerCommand(
    "copilotMemory.retrieveMemory",
    async () => {
      const prompt = await vscode.window.showInputBox({
        prompt: "Enter a query to retrieve relevant memories",
        placeHolder: "e.g. authentication flow",
      });

      if (!prompt) {
        return;
      }

      try {
        const project = getProjectRoot();
        const memories = await retrieveMemory(project, prompt);

        if (memories.length === 0) {
          vscode.window.showInformationMessage("No memories found.");
          return;
        }

        // Show results in a new untitled document
        const finalPrompt = memories.join("\n---\n") + "\n---\n" + prompt;
        const doc = await vscode.workspace.openTextDocument({
          content: finalPrompt,
          language: "markdown",
        });
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to retrieve memory: ${err.message}`);
      }
    }
  );

  // ── Auto-capture on document change (opt-in via setting) ────────────────
  function registerAutoCapture() {
    const config = vscode.workspace.getConfiguration("copilotMemory");
    const enabled = config.get<boolean>("autoCapture", false);

    if (enabled && !autoCaptureDisposable) {
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;

      autoCaptureDisposable = vscode.workspace.onDidChangeTextDocument(
        (event) => {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }

          debounceTimer = setTimeout(async () => {
            const text = event.document.getText();
            if (text.trim()) {
              try {
                const project = getProjectRoot();
                await storeMemory(project, "auto", text);
              } catch {
                // silently ignore auto-capture failures
              }
            }
          }, 2000); // 2-second debounce
        }
      );
      context.subscriptions.push(autoCaptureDisposable);
    } else if (!enabled && autoCaptureDisposable) {
      autoCaptureDisposable.dispose();
      autoCaptureDisposable = undefined;
    }
  }

  registerAutoCapture();

  // Re-evaluate when configuration changes
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration("copilotMemory.autoCapture")) {
      registerAutoCapture();
    }
  });

  // ── @memory Chat Participant ────────────────────────────────────────────
  const participant = vscode.chat.createChatParticipant(
    "copilot-memory.memory",
    async (
      request: vscode.ChatRequest,
      context: vscode.ChatContext,
      stream: vscode.ChatResponseStream,
      token: vscode.CancellationToken
    ) => {
      const project = getProjectRoot();

      // /save command — store the user's message as a memory
      if (request.command === "save") {
        const text = request.prompt.trim();
        if (!text) {
          stream.markdown("Nothing to save — please include some text after `/save`.");
          return;
        }
        try {
          await storeMemory(project, "chat", text);
          stream.markdown(`**Memory saved.**\n\n> ${text.length > 200 ? text.slice(0, 200) + "…" : text}`);
        } catch (err: any) {
          stream.markdown(`**Failed to save memory:** ${err.message}`);
        }
        return;
      }

      // Default / /recall — retrieve relevant memories and answer with context
      const prompt = request.prompt.trim();
      if (!prompt) {
        stream.markdown("Please ask a question so I can retrieve relevant memories.");
        return;
      }

      // Also store the current prompt+conversation as ongoing context
      const historyContext = context.history
        .map((turn) => {
          if (turn instanceof vscode.ChatRequestTurn) {
            return `User: ${turn.prompt}`;
          } else if (turn instanceof vscode.ChatResponseTurn) {
            const parts = turn.response
              .map((part) => {
                if (part instanceof vscode.ChatResponseMarkdownPart) {
                  return part.value.value;
                }
                return "";
              })
              .join("");
            return `Assistant: ${parts}`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");

      // Retrieve memories relevant to the prompt
      let memories: string[] = [];
      try {
        memories = await retrieveMemory(project, prompt);
      } catch (err: any) {
        stream.markdown(`**Could not reach memory engine:** ${err.message}\n\nMake sure the backend is running.`);
        return;
      }

      // Build context for the LLM
      let memoryBlock = "";
      if (memories.length > 0) {
        memoryBlock = memories
          .map((m, i) => `### Memory ${i + 1}\n${m}`)
          .join("\n\n---\n\n");
      }

      const systemPrompt = [
        "You are a helpful coding assistant with access to the user's stored memories from previous sessions.",
        "Use the retrieved memories below as context to answer the user's question.",
        "If the memories are not relevant, answer based on your general knowledge but mention that no relevant memories were found.",
        memories.length > 0
          ? `\n\n## Retrieved Memories (${memories.length})\n\n${memoryBlock}`
          : "\n\nNo stored memories matched this query.",
        historyContext ? `\n\n## Conversation so far\n${historyContext}` : "",
      ].join("\n");

      // Use the VS Code Language Model API
      const [model] = await vscode.lm.selectChatModels({
        vendor: "copilot",
        family: "gpt-4o",
      });

      if (!model) {
        // Fallback: just show the memories directly
        if (memories.length > 0) {
          stream.markdown(`## Retrieved Memories\n\n${memoryBlock}\n\n---\n\n*No language model available to generate a response. Showing raw memories above.*`);
        } else {
          stream.markdown("No memories found and no language model available.");
        }
        return;
      }

      const messages = [
        vscode.LanguageModelChatMessage.User(systemPrompt),
        vscode.LanguageModelChatMessage.User(prompt),
      ];

      const response = await model.sendRequest(messages, {}, token);

      for await (const chunk of response.text) {
        stream.markdown(chunk);
      }

      // Auto-save this exchange as a new memory for future sessions
      // Use a stable session ID derived from the first prompt in this chat
      const firstPrompt = context.history.find(
        (t) => t instanceof vscode.ChatRequestTurn
      );
      const sessionSeed = firstPrompt instanceof vscode.ChatRequestTurn
        ? firstPrompt.prompt
        : prompt;
      const sessionId = "chat-" + simpleHash(sessionSeed);

      // Build the full conversation log for this session
      const fullConversation = [
        historyContext,
        `User: ${prompt}`,
        `(answered with ${memories.length} memories as context)`,
      ].filter(Boolean).join("\n");

      try {
        await storeMemory(project, "chat-session", fullConversation, sessionId);
      } catch {
        // silently ignore
      }
    }
  );

  participant.iconPath = new vscode.ThemeIcon("brain");

  context.subscriptions.push(storeCmd, retrieveCmd, participant);
}

export function deactivate() {
  if (autoCaptureDisposable) {
    autoCaptureDisposable.dispose();
  }
}
