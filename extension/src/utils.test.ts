import { simpleHash } from "./utils";

// ── Test helpers ──

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FAIL: ${msg}`);
  }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  if (actual !== expected) {
    throw new Error(`FAIL: ${msg} — expected ${expected}, got ${actual}`);
  }
}

// ── memoryEngine imports ──
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { storeMemory, retrieveMemory, listMemories } from "./memoryEngine";

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "memblock-test-"));
}

function runTests() {
  let passed = 0;
  let failed = 0;
  const tests: [string, () => void][] = [
    // ── simpleHash ──
    [
      "hash: returns a non-empty string",
      () => {
        const result = simpleHash("hello");
        assert(result.length > 0, "hash should not be empty");
      },
    ],
    [
      "hash: is deterministic",
      () => {
        const a = simpleHash("test input");
        const b = simpleHash("test input");
        assertEqual(a, b, "same input should produce same hash");
      },
    ],
    [
      "hash: different inputs produce different hashes",
      () => {
        const a = simpleHash("hello");
        const b = simpleHash("world");
        assert(a !== b, "different inputs should differ");
      },
    ],
    [
      "hash: handles empty string",
      () => {
        const result = simpleHash("");
        assertEqual(result, "0", "empty string should hash to '0'");
      },
    ],
    [
      "hash: handles unicode",
      () => {
        const result = simpleHash("こんにちは 🚀");
        assert(result.length > 0, "unicode hash should not be empty");
      },
    ],
    [
      "hash: returns base-36 characters only",
      () => {
        const result = simpleHash("base36 test string with various chars!@#$%");
        assert(/^[0-9a-z]+$/.test(result), `hash '${result}' should be base-36`);
      },
    ],
    [
      "hash: long input does not throw",
      () => {
        const longStr = "x".repeat(100_000);
        const result = simpleHash(longStr);
        assert(result.length > 0, "long input should still produce a hash");
      },
    ],
    [
      "hash: similar inputs produce different hashes",
      () => {
        const a = simpleHash("test1");
        const b = simpleHash("test2");
        assert(a !== b, "similar inputs should produce different hashes");
      },
    ],
    [
      "hash: stable session ID use case",
      () => {
        const prompt = "How do I authenticate users in my app?";
        const id1 = "chat-" + simpleHash(prompt);
        const id2 = "chat-" + simpleHash(prompt);
        assertEqual(id1, id2, "session IDs from same prompt should match");
        assert(id1.startsWith("chat-"), "should have chat- prefix");
      },
    ],
    [
      "hash: different prompts yield different session IDs",
      () => {
        const id1 = "save-" + simpleHash("first chat about auth");
        const id2 = "save-" + simpleHash("second chat about databases");
        assert(id1 !== id2, "different prompts should yield different session IDs");
      },
    ],

    // ── storeMemory ──
    [
      "store: creates .copilot-memory dir and file",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "test.rs", "fn main() {}");
        const memDir = path.join(dir, ".copilot-memory");
        assert(fs.existsSync(memDir), "memory dir should exist");
        const files = fs.readdirSync(memDir);
        assertEqual(files.length, 1, "should have 1 file");
        assert(files[0].endsWith(".json"), "file should be .json");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "store: roundtrip via list",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "chat", "hello world");
        const entries = listMemories(dir);
        assertEqual(entries.length, 1, "should have 1 entry");
        assertEqual(entries[0].content, "hello world", "content should match");
        assertEqual(entries[0].source, "chat", "source should match");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "store: upsert with same id",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "chat", "v1", "session-1");
        storeMemory(dir, "chat", "v2", "session-1");
        const entries = listMemories(dir);
        assertEqual(entries.length, 1, "should have 1 entry after upsert");
        assertEqual(entries[0].content, "v2", "content should be updated");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "store: multiple entries",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "a", "content a");
        storeMemory(dir, "b", "content b");
        storeMemory(dir, "c", "content c");
        const entries = listMemories(dir);
        assertEqual(entries.length, 3, "should have 3 entries");
        fs.rmSync(dir, { recursive: true });
      },
    ],

    // ── retrieveMemory ──
    [
      "retrieve: returns stored content",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "auth.rs", "fn authenticate(user: &str) -> bool { true }");
        storeMemory(dir, "db.rs", "fn connect_database() -> Pool {}");
        const results = retrieveMemory(dir, "authenticate user");
        assert(results.length === 2, "should return both results");
        // Both stored items should be present in results
        const joined = results.join(" ");
        assert(joined.includes("authenticate"), "results should contain auth content");
        assert(joined.includes("connect_database"), "results should contain db content");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "retrieve: returns at most 5",
      () => {
        const dir = makeTempDir();
        for (let i = 0; i < 7; i++) {
          storeMemory(dir, `f${i}`, `content number ${i} about testing`);
        }
        const results = retrieveMemory(dir, "testing");
        assert(results.length <= 5, `should return at most 5, got ${results.length}`);
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "retrieve: empty project returns empty",
      () => {
        const dir = makeTempDir();
        const results = retrieveMemory(dir, "anything");
        assertEqual(results.length, 0, "empty project should return no results");
        fs.rmSync(dir, { recursive: true });
      },
    ],

    // ── listMemories ──
    [
      "list: empty project returns empty",
      () => {
        const dir = makeTempDir();
        const entries = listMemories(dir);
        assertEqual(entries.length, 0, "empty project should have no entries");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "list: preserves id from store",
      () => {
        const dir = makeTempDir();
        storeMemory(dir, "chat", "session data", "my-session");
        const entries = listMemories(dir);
        assertEqual(entries.length, 1, "should have 1 entry");
        assertEqual(entries[0].id, "my-session", "id should match");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "list: preview truncates long content",
      () => {
        const dir = makeTempDir();
        const long = "a".repeat(300);
        storeMemory(dir, "src", long);
        const entries = listMemories(dir);
        assert(entries[0].preview.length < entries[0].content.length, "preview should be shorter");
        assert(entries[0].preview.endsWith("…"), "preview should end with ellipsis");
        fs.rmSync(dir, { recursive: true });
      },
    ],
    [
      "list: skips corrupted files",
      () => {
        const dir = makeTempDir();
        const memDir = path.join(dir, ".copilot-memory");
        fs.mkdirSync(memDir, { recursive: true });
        fs.writeFileSync(path.join(memDir, "bad.json"), "not valid json");
        storeMemory(dir, "src", "good data");
        const entries = listMemories(dir);
        assertEqual(entries.length, 1, "should skip corrupted and return 1");
        assertEqual(entries[0].content, "good data", "content should match good entry");
        fs.rmSync(dir, { recursive: true });
      },
    ],
  ];

  for (const [name, fn] of tests) {
    try {
      fn();
      passed++;
      console.log(`  ✓ ${name}`);
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${name}: ${e.message}`);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total`);
  if (failed > 0) {
    process.exit(1);
  }
}

console.log("MemBlock extension tests\n");
runTests();
