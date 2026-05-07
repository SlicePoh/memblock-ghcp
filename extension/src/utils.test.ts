import { simpleHash } from "./utils";

// ── simpleHash tests ──

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

function runTests() {
  let passed = 0;
  let failed = 0;
  const tests: [string, () => void][] = [
    [
      "returns a non-empty string",
      () => {
        const result = simpleHash("hello");
        assert(result.length > 0, "hash should not be empty");
      },
    ],
    [
      "is deterministic",
      () => {
        const a = simpleHash("test input");
        const b = simpleHash("test input");
        assertEqual(a, b, "same input should produce same hash");
      },
    ],
    [
      "different inputs produce different hashes",
      () => {
        const a = simpleHash("hello");
        const b = simpleHash("world");
        assert(a !== b, "different inputs should differ");
      },
    ],
    [
      "handles empty string",
      () => {
        const result = simpleHash("");
        assertEqual(result, "0", "empty string should hash to '0'");
      },
    ],
    [
      "handles unicode",
      () => {
        const result = simpleHash("こんにちは 🚀");
        assert(result.length > 0, "unicode hash should not be empty");
      },
    ],
    [
      "returns base-36 characters only",
      () => {
        const result = simpleHash("base36 test string with various chars!@#$%");
        assert(/^[0-9a-z]+$/.test(result), `hash '${result}' should be base-36`);
      },
    ],
    [
      "long input does not throw",
      () => {
        const longStr = "x".repeat(100_000);
        const result = simpleHash(longStr);
        assert(result.length > 0, "long input should still produce a hash");
      },
    ],
    [
      "similar inputs produce different hashes",
      () => {
        const a = simpleHash("test1");
        const b = simpleHash("test2");
        assert(a !== b, "similar inputs should produce different hashes");
      },
    ],
    [
      "hash is stable for session ID use case",
      () => {
        const prompt = "How do I authenticate users in my app?";
        const id1 = "chat-" + simpleHash(prompt);
        const id2 = "chat-" + simpleHash(prompt);
        assertEqual(id1, id2, "session IDs from same prompt should match");
        assert(id1.startsWith("chat-"), "should have chat- prefix");
      },
    ],
    [
      "different prompts yield different session IDs",
      () => {
        const id1 = "save-" + simpleHash("first chat about auth");
        const id2 = "save-" + simpleHash("second chat about databases");
        assert(id1 !== id2, "different prompts should yield different session IDs");
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

console.log("Extension unit tests\n");
runTests();
