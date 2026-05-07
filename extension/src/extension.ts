import * as vscode from "vscode";
import { storeMemory, retrieveMemory, listMemories } from "./memoryClient";
import { simpleHash, getProjectRoot } from "./utils";

let autoCaptureDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
  console.log("copilot-memory extension activated");

  // ── Save Current Chat command ──
  // One-step save: auto-copies the active chat panel content and stores it
  const saveChatCmd = vscode.commands.registerCommand(
    "copilotMemory.saveCurrentChat",
    async () => {
      const previousClipboard = await vscode.env.clipboard.readText();

      // Try to auto-copy the chat panel content
      let copied = false;
      try {
        await vscode.commands.executeCommand("workbench.action.chat.copyAll");
        copied = true;
      } catch {
        // Command may not exist in older VS Code versions
      }

      if (!copied) {
        // Fallback: try generic select-all + copy (works when chat panel is focused)
        try {
          await vscode.commands.executeCommand("editor.action.selectAll");
          await new Promise((r) => setTimeout(r, 100));
          await vscode.commands.executeCommand("editor.action.clipboardCopyAction");
          copied = true;
        } catch {
          // Neither worked
        }
      }

      // Wait for clipboard to update
      await new Promise((r) => setTimeout(r, 300));
      const clipboard = await vscode.env.clipboard.readText();

      if (
        !clipboard ||
        clipboard.trim().length === 0 ||
        clipboard === previousClipboard
      ) {
        vscode.window.showWarningMessage(
          "Could not auto-copy chat. Please copy the chat manually (Ctrl+A, Ctrl+C in chat panel), then run this command again."
        );
        return;
      }

      try {
        const project = getProjectRoot();
        const sessionId = "chat-saved-" + simpleHash(clipboard.slice(0, 100));
        await storeMemory(project, "chat-saved", clipboard.trim(), sessionId);
        const lines = clipboard.trim().split("\n").length;
        vscode.window.showInformationMessage(
          `Chat saved to memory (${lines} lines).`
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to save: ${err.message}`);
      }

      // Restore previous clipboard
      await vscode.env.clipboard.writeText(previousClipboard);
    }
  );

  // Store Memory command
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

  // ── Retrieve Memory command ──
  const retrieveCmd = vscode.commands.registerCommand(
    "copilotMemory.retrieveMemory",
    async () => {
      const project = getProjectRoot();

      let entries;
      try {
        entries = await listMemories(project);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Failed to list memories: ${err.message}`);
        return;
      }

      if (entries.length === 0) {
        vscode.window.showInformationMessage("No memories stored yet.");
        return;
      }

      // Show multi-select picker with all memories
      const items = entries.map((e) => ({
        label: e.source,
        description: e.id,
        detail: e.preview,
        picked: false,
        entry: e,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        canPickMany: true,
        placeHolder: `Select memories to retrieve (${entries.length} available)`,
        matchOnDescription: true,
        matchOnDetail: true,
      });

      if (!selected || selected.length === 0) {
        return;
      }

      const contents = selected.map((s) => s.entry.content);
      const doc = await vscode.workspace.openTextDocument({
        content: contents.join("\n\n---\n\n"),
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc);
    }
  );

  // Auto-capture on document change (opt-in via setting)
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

  // @memory Chat Participant
  const participant = vscode.chat.createChatParticipant("copilot-memory.memory", async (
          request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, 
          token: vscode.CancellationToken ) => {
      const project = getProjectRoot();
      // /save command — store the user's message OR entire conversation history
      if (request.command === "save") {
        let text = request.prompt.trim();

        // If no text provided, save the entire conversation history
        if (!text) {
          const history = context.history
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

          if (history) {
            text = history;
          } else {
            // No @memory history — try auto-copying chat panel
            const previousClipboard = await vscode.env.clipboard.readText();
            let autoCopied = false;
            try {
              await vscode.commands.executeCommand("workbench.action.chat.copyAll");
              autoCopied = true;
            } catch {
              // Command may not exist
            }

            if (autoCopied) {
              await new Promise((r) => setTimeout(r, 300));
              const clipboard = await vscode.env.clipboard.readText();
              if (clipboard && clipboard.trim().length > 0 && clipboard !== previousClipboard) {
                text = clipboard.trim();
                // Restore clipboard
                await vscode.env.clipboard.writeText(previousClipboard);
                stream.markdown("*Auto-captured chat from this panel.*\n\n");
              }
            }

            // If auto-copy didn't work, fall back to existing clipboard content
            if (!text) {
              const clipboard = await vscode.env.clipboard.readText();
              if (clipboard && clipboard.trim().length > 0) {
                text = clipboard.trim();
                stream.markdown("*Saving clipboard content as memory.*\n\n");
              } else {
                stream.markdown(
                  "**Nothing to save.**\n\n" +
                  "Easiest way: run **Copilot Memory: Save Current Chat** from the Command Palette (`Ctrl+Shift+P`).\n\n" +
                  "Or: copy the chat manually (`Ctrl+A`, `Ctrl+C` in chat panel), then `@memory /save` again."
                );
                return;
              }
            }
          }
        }

        try {
          const sessionId = "save-" + simpleHash(text.slice(0, 100));
          await storeMemory(project, "chat-saved", text, sessionId);
          const lines = text.split("\n").length;
          stream.markdown(`**Conversation saved** (${lines} lines).\n\n> ${text.slice(0, 200)}${text.length > 200 ? "…" : ""}`);
        } catch (err: any) {
          stream.markdown(`**Failed to save memory:** ${err.message}`);
        }
        return;
      }
      // /recall command — show picker to choose which memories to feed as context
      if (request.command === "recall") {
        let entries;
        try {
          entries = await listMemories(project);
        } catch (err: any) {
          stream.markdown(`**Could not reach memory engine:** ${err.message}\n\nMake sure the backend is running.`);
          return;
        }

        if (entries.length === 0) {
          stream.markdown("No memories stored yet. Use `@memory /save` to save a conversation first.");
          return;
        }

        // Show multi-select picker with all stored memories
        const items = entries.map((e) => ({
          label: e.source,
          description: e.id,
          detail: e.preview,
          picked: false,
          entry: e,
        }));

        const selected = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: `Select memories to load as context (${entries.length} available)`,
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (!selected || selected.length === 0) {
          stream.markdown("No memories selected.");
          return;
        }

        const selectedContents = selected.map((s) => s.entry.content);
        const memoryBlock = selectedContents
          .map((m, i) => `### Memory ${i + 1}\n${m}`)
          .join("\n\n---\n\n");

        const question = request.prompt.trim();

        // If user also typed a question after /recall, answer it with selected context
        if (question) {
          const systemPrompt = [
            "You are a helpful coding assistant with access to the user's stored memories from previous sessions.",
            "Use the retrieved memories below as context to answer the user's question.",
            `\n\n## Selected Memories (${selected.length})\n\n${memoryBlock}`,
          ].join("\n");

          const [model] = await vscode.lm.selectChatModels({
            vendor: "copilot",
            family: "gpt-4o",
          });

          if (!model) {
            stream.markdown(`## Selected Memories\n\n${memoryBlock}\n\n---\n\n*No language model available. Showing raw memories above.*`);
            return;
          }

          const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt),
            vscode.LanguageModelChatMessage.User(question),
          ];
          const response = await model.sendRequest(messages, {}, token);
          for await (const chunk of response.text) {
            stream.markdown(chunk);
          }
        } else {
          // No question — just load the memories into the chat as context
          stream.markdown(`## Loaded ${selected.length} memories as context\n\n${memoryBlock}\n\n---\n\n*These memories are now in this chat. Ask me anything about them.*`);
        }
        return;
      }

      // Default — retrieve relevant memories and answer with context
      const prompt = request.prompt.trim();
      if (!prompt) {
        stream.markdown("Please ask a question so I can retrieve relevant memories.\n\nTip: Use `/save` to save conversations or `/recall` to pick specific memories.");
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
        .filter(Boolean).join("\n");
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
  context.subscriptions.push(saveChatCmd, storeCmd, retrieveCmd, participant);
}

export function deactivate() {
  if (autoCaptureDisposable) {
    autoCaptureDisposable.dispose();
  }
}
