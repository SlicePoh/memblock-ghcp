import * as vscode from "vscode";
import * as https from "node:https";
import * as http from "node:http";


export function getServerUrl(): string {
  const config = vscode.workspace.getConfiguration("copilotMemory");
  return config.get<string>("serverUrl", "http://127.0.0.1:3210");
}



// Lightweight JSON POST using only Node built-ins (no node-fetch dependency).

function jsonPost<T>(url: string, body: object): Promise<T> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === "https:" ? https : http;
    const data = JSON.stringify(body);
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk: Buffer) => (raw += chunk.toString()));
        res.on("end", () => {
          try {
            resolve(JSON.parse(raw) as T);
          } catch {
            reject(new Error(`Invalid JSON from server: ${raw}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Public API
export async function storeMemory(project: string, source: string, context: string, id?: string) {
  const body: Record<string, string> = { project, source, context };
  if (id) { body.id = id; }
  return jsonPost<string>(`${getServerUrl()}/store`, body);
}

export async function retrieveMemory(project: string, prompt: string): Promise<string[]> {
  const res = await jsonPost<string[]>(`${getServerUrl()}/retrieve`, { project, prompt });
  return res;
}
