import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

// ── Types ──

interface Chunk {
  source: string;
  content: string;
  embedding: number[];
}

export interface MemoryEntry {
  id: string;
  source: string;
  preview: string;
  content: string;
}

// ── Embedding ──
// Deterministic 128-dim embedding (same algorithm as the Rust version).
// Characters are mapped to bucket indices and the result is L2-normalised.

function embed(text: string): number[] {
  const vec = new Float64Array(128);

  let i = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0;
    const idx = (code + i) % 128;
    vec[idx] += 1.0;
    i++;
  }

  let norm = 0;
  for (let j = 0; j < 128; j++) {
    norm += vec[j] * vec[j];
  }
  norm = Math.sqrt(norm);

  const result: number[] = new Array(128);
  if (norm > 0) {
    for (let j = 0; j < 128; j++) {
      result[j] = vec[j] / norm;
    }
  } else {
    result.fill(0);
  }

  return result;
}

// ── Retrieval ──
// Cosine similarity (dot product on L2-normalised vectors).

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

// ── Storage ──

function memoryDir(project: string): string {
  return path.join(project, ".copilot-memory");
}

export function storeMemory(
  project: string,
  source: string,
  content: string,
  id?: string
): void {
  const base = memoryDir(project);
  fs.mkdirSync(base, { recursive: true });

  const filename = id || randomUUID();
  const filePath = path.join(base, `${filename}.json`);

  const chunk: Chunk = {
    source,
    content,
    embedding: embed(content),
  };

  fs.writeFileSync(filePath, JSON.stringify(chunk));
}

function loadAll(project: string): { content: string; embedding: number[] }[] {
  const base = memoryDir(project);
  const out: { content: string; embedding: number[] }[] = [];

  if (!fs.existsSync(base)) {
    return out;
  }

  for (const file of fs.readdirSync(base)) {
    if (!file.endsWith(".json")) {
      continue;
    }
    try {
      const raw = fs.readFileSync(path.join(base, file), "utf-8");
      const chunk: Chunk = JSON.parse(raw);
      out.push({ content: chunk.content, embedding: chunk.embedding });
    } catch {
      // skip corrupted files
    }
  }

  return out;
}

export function retrieveMemory(project: string, prompt: string): string[] {
  const target = embed(prompt);
  const data = loadAll(project);

  const scored = data.map((d) => ({
    score: cosine(target, d.embedding),
    content: d.content,
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((s) => s.content);
}

export function listMemories(project: string): MemoryEntry[] {
  const base = memoryDir(project);
  const out: MemoryEntry[] = [];

  if (!fs.existsSync(base)) {
    return out;
  }

  for (const file of fs.readdirSync(base)) {
    if (!file.endsWith(".json")) {
      continue;
    }

    const id = path.basename(file, ".json");

    try {
      const raw = fs.readFileSync(path.join(base, file), "utf-8");
      const chunk: Chunk = JSON.parse(raw);
      const preview =
        chunk.content.length > 120
          ? chunk.content.slice(0, 120) + "…"
          : chunk.content;

      out.push({
        id,
        source: chunk.source,
        preview,
        content: chunk.content,
      });
    } catch {
      // skip corrupted files
    }
  }

  return out;
}
