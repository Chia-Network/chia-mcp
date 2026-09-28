#!/usr/bin/env node
/**
 * check-drift.js — Mechanical drift prevention for chia-mcp / chia-for-agents.
 *
 * Checks:
 *  1. Tool count consistency across README, llms.txt, test assertions
 *  2. constants.json condition_opcodes match CONDITION_OPCODES in tools.ts
 *  3. constants.json opcodes match coin-model.md table
 *  4. llms-full.txt sections match source files (spot check first 200 chars)
 *  5. Footer dates are consistent across all files
 *
 * Run: node scripts/check-drift.js
 * Exit 0 = all checks pass. Exit 1 = drift detected (details printed).
 */

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, dirname, relative } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Support env var override (for CI dual-checkout) or fall back to sibling directory
const AGENTS_ROOT = process.env.CHIA_FOR_AGENTS_ROOT
  ? process.env.CHIA_FOR_AGENTS_ROOT
  : join(ROOT, "..", "chia-for-agents");
const AGENTS_ROOT_PRESENT = existsSync(AGENTS_ROOT);

// --strict turns a skipped cross-repo run into a hard failure. Use it in the
// pre-release procedure, where a partial run must not be mistaken for a pass.
const STRICT = process.argv.includes("--strict");

if (!AGENTS_ROOT_PRESENT) {
  if (process.env.CI) {
    // In CI, missing cross-repo context is a hard failure — silently skipping 20 checks
    // is worse than a clear error. Check out both repos side-by-side and set
    // CHIA_FOR_AGENTS_ROOT, or add the dual-checkout steps from ci.yml.
    console.error(`❌ FATAL: chia-for-agents not found at ${AGENTS_ROOT}`);
    console.error("   In CI, cross-repo drift checks MUST run — they are 26 of the 35 checks.");
    console.error("   Fix: add dual-checkout steps to ci.yml and set CHIA_FOR_AGENTS_ROOT.");
    console.error("   See: https://github.com/Chia-Network/chia-for-agents");
    process.exit(1);
  }
  console.warn(`⚠️  chia-for-agents not found at ${AGENTS_ROOT} — cross-repo checks skipped.`);
  console.warn("   Run with both repos checked out side-by-side for full drift verification.");
  console.warn("   Or set CHIA_FOR_AGENTS_ROOT=/path/to/chia-for-agents");
  console.warn("   See: https://github.com/Chia-Network/chia-for-agents");
}

let errors = 0;

function fail(msg) {
  console.error(`❌ DRIFT: ${msg}`);
  errors++;
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function readFile(path) {
  if (!existsSync(path)) {
    fail(`File not found: ${path}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

/**
 * Like readFile but returns null silently for missing files (no fail()).
 * Use for optional deliverables that may be distributed separately (e.g. blog-post.md).
 */
function readFileOptional(path) {
  if (!existsSync(path)) {
    return null;
  }
  return readFileSync(path, "utf8");
}

// --- Check 1: Tool count consistency ---

const README = readFile(join(ROOT, "README.md"));
const TEST = readFile(join(ROOT, "src/__tests__/tools-integration.test.ts"));

// Extract tool count from test assertion
const testMatch = TEST?.match(/expect\(tools\.tools\.length\)\.toBe\((\d+)\)/);
const testCount = testMatch ? parseInt(testMatch[1]) : null;

// Extract tool count from test name
const testNameMatch = TEST?.match(/it\("registers (\d+) tools/);
const testNameCount = testNameMatch ? parseInt(testNameMatch[1]) : null;

if (testCount !== null && testNameCount !== null) {
  if (testCount !== testNameCount) {
    fail(`Test name says ${testNameCount} tools but assertion expects ${testCount} — fix the test name`);
  } else {
    ok(`Test name and assertion agree: ${testCount} tools`);
  }
}

// Check README mentions the correct count
if (README && testCount !== null) {
  // README lists tools by section — check it mentions the count
  const readmeMatch = README.match(/\b(\d+) tools?\b/g);
  const countStr = readmeMatch?.find(m => parseInt(m) === testCount) ?? null;
  if (countStr) {
    ok(`README tool count mentions: ${countStr}`);
  } else {
    const counts = readmeMatch?.slice(0, 3).join(", ") ?? "none found";
    fail(`README does not mention the expected tool count (${testCount}). Found: ${counts}`);
  }
}

// HANDOFF.md is an internal doc (.gitignored) — skip test count check in CI

// --- Check 2: constants.json opcodes match tools.ts ---

const constantsPath = AGENTS_ROOT_PRESENT ? join(AGENTS_ROOT, "constants.json") : null;
const toolsPath = join(ROOT, "src", "tools.ts");

const constantsRaw = constantsPath ? readFile(constantsPath) : null;
const toolsRaw = readFile(toolsPath);

if (constantsRaw && toolsRaw) {
  const constants = JSON.parse(constantsRaw);
  // constants.json: name -> hex  (e.g. "REMARK": "0x01")
  const opcodesByName = constants.condition_opcodes;

  // Extract CONDITION_OPCODES from tools.ts (keyed hex -> name, e.g. "0x01": "REMARK")
  const toolsMatch = toolsRaw.match(/const CONDITION_OPCODES[^=]*=\s*\{([^}]+)\}/s);
  if (!toolsMatch) {
    fail("Could not find CONDITION_OPCODES in tools.ts");
  } else {
    const toolsOpcodes = {}; // hex -> name
    const entries = toolsMatch[1].matchAll(/"(0x[0-9a-f]+)"\s*:\s*"(\w+)"/g);
    for (const [, hex, name] of entries) {
      toolsOpcodes[hex] = name;
    }

    // Compare: both should have same set of hex values, matching names
    let mismatches = 0;
    for (const [name, hex] of Object.entries(opcodesByName)) {
      if (toolsOpcodes[hex] !== name) {
        fail(`Opcode mismatch for ${hex}: constants.json says "${name}", tools.ts says "${toolsOpcodes[hex]}"`);
        mismatches++;
      }
    }
    for (const [hex, name] of Object.entries(toolsOpcodes)) {
      if (!(hex in Object.fromEntries(Object.entries(opcodesByName).map(([n, h]) => [h, n])))) {
        fail(`Opcode ${hex}="${name}" in tools.ts but not in constants.json`);
        mismatches++;
      }
    }
    if (mismatches === 0) {
      ok(`All ${Object.keys(opcodesByName).length} opcodes match between constants.json and tools.ts`);
    }
  }
}

// --- Check 3: constants.json opcodes match coin-model.md table ---

const coinModelPath = AGENTS_ROOT_PRESENT ? join(AGENTS_ROOT, "resources", "coin-model.md") : null;
const coinModel = coinModelPath ? readFile(coinModelPath) : null;

if (coinModel && constantsRaw) {
  const constants = JSON.parse(constantsRaw);
  const opcodes = constants.condition_opcodes;
  let tableErrors = 0;

  // Build a decimal→hex and decimal→name map from canonical data
  const decimalToName = {};
  const decimalToHex = {};
  for (const [name, hex] of Object.entries(opcodes)) {
    const decimal = parseInt(hex, 16);
    decimalToName[decimal] = name;
    decimalToHex[decimal] = hex;
  }

  // Parse coin-model.md table rows as (name, decimal, hex) triples and verify pairing
  // Expected table format: | `NAME` | decimal (0xHH) | description |
  const tableRowRe = /\|\s*`([A-Z_]+)`\s*\|\s*(\d+)\s*\(?(0x[0-9a-fA-F]+)\)?/g;
  const foundPairs = new Set();
  let match;
  while ((match = tableRowRe.exec(coinModel)) !== null) {
    const [, rowName, rowDecimal, rowHex] = match;
    const dec = parseInt(rowDecimal, 10);
    const hexNorm = rowHex.toLowerCase();

    if (!(dec in decimalToName)) {
      // Could be a non-condition opcode in the table — skip silently
      continue;
    }

    const expectedName = decimalToName[dec];
    const expectedHex = decimalToHex[dec].toLowerCase();

    if (rowName !== expectedName) {
      fail(`coin-model.md opcode pairing mismatch at decimal ${dec}: name "${rowName}" should be "${expectedName}"`);
      tableErrors++;
    } else if (hexNorm !== expectedHex) {
      fail(`coin-model.md opcode pairing mismatch at decimal ${dec}: hex "${rowHex}" should be "${decimalToHex[dec]}"`);
      tableErrors++;
    } else {
      foundPairs.add(dec);
    }
  }

  // Also verify each canonical opcode is present (name + hex) as a fallback
  for (const [name, hex] of Object.entries(opcodes)) {
    if (!coinModel.includes(name)) {
      fail(`Opcode ${name} not found in coin-model.md`);
      tableErrors++;
    }
    if (!coinModel.includes(hex)) {
      fail(`Opcode hex ${hex} (for ${name}) not found in coin-model.md`);
      tableErrors++;
    }
  }

  if (tableErrors === 0) {
    ok(`All ${Object.keys(opcodes).length} opcode names, hex values, and decimal/hex pairings verified in coin-model.md`);
  }
}

// --- Check 4: llms-full.txt section-by-section verification ---

const llmsFullPath = AGENTS_ROOT_PRESENT ? join(AGENTS_ROOT, "llms-full.txt") : null;
const llmsFull = llmsFullPath ? readFile(llmsFullPath) : null;

/**
 * For each source file that feeds into llms-full.txt, extract key phrases
 * that MUST appear. These are chosen to catch the drift patterns we've seen:
 * missing bullets, stale descriptions, dropped qualifiers.
 */
const LLMS_FULL_CHECKS = [
  // Source file -> array of [description, phrase that must exist in llms-full.txt]
  ["README.md", [
    ["Subscribe to real-time events bullet", "Subscribe to real-time events"],
    ["get_address_summary in balance recipe", "get_address_summary"],
    ["Coinset qualifier on trace recipe", "Coinset-only"],
  ]],
  ["AGENTS.md", [
    ["complete flag in balance recipe", "complete: false"],
    ["Coinset qualifier on trace recipe", "Coinset-only; on a local node"],
    ["timestamp recipe", "When did this transaction happen"],
  ]],
  ["EVALUATION.md", [
    ["CLVM puzzle complexity bullet", "CLVM puzzle complexity"],
    ["warp.green security incident", "security incident"],
    ["Solana finality qualifier", "finality ~12.8s"],
  ]],
  ["ECOSYSTEM.md", [
    ["warp.green security incident", "Security incident"],
    ["CAT bridge not affected", "CAT bridge"],
  ]],
  ["resources/coin-model.md", [
    ["12th LLM mistake (event logs)", "Show me the event logs"],
    ["11th LLM mistake (conditions)", "Conditions are executed"],
    ["1st LLM mistake (balance)", "Query the balance"],
  ]],
  ["SECURITY.md", [
    ["push_tx gating", "push_tx"],
    ["untrusted on-chain data", "untrusted"],
    ["MCP registry warning", "tool-name"],
  ]],
  ["resources/rpc-quickstart.md", [
    ["push_tx PENDING status documented", "PENDING"],
  ]],
  ["chia-blockchain-AGENTS.md", [
    ["No stale integration instructions", "This document supplements"],
  ]],
];

if (llmsFull) {
  let llmsDriftCount = 0;
  for (const [sourceFile, checks] of LLMS_FULL_CHECKS) {
    for (const [desc, phrase] of checks) {
      if (!llmsFull.includes(phrase)) {
        fail(`llms-full.txt missing from ${sourceFile}: ${desc} (looking for "${phrase}")`);
        llmsDriftCount++;
      }
    }
  }

  // Also check that stale integration instructions are NOT present
  if (llmsFull.includes("**Integration path for chia-blockchain:**")) {
    fail("llms-full.txt contains stale 'Integration path' instructions from old chia-blockchain-AGENTS.md");
    llmsDriftCount++;
  }

  // Check no duplicate bullets (a pattern we've seen)
  const lines = llmsFull.split("\n");
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim().length > 40 && lines[i].trim() === lines[i - 1].trim()) {
      fail(`llms-full.txt has duplicate line at ${i + 1}: "${lines[i].trim().slice(0, 60)}..."`);
      llmsDriftCount++;
    }
  }

  // Content-inclusion check: verify each source file appears in llms-full.txt
  // by sampling 3 non-trivial lines from the middle of each file
  const LLMS_SOURCE_FILES = [
    "README.md", "AGENTS.md", "REFERENCE.md", "EVALUATION.md",
    "ECOSYSTEM.md", "resources/coin-model.md", "resources/chialisp-basics.md",
    "resources/rpc-quickstart.md", "SECURITY.md", "chia-blockchain-AGENTS.md",
    "examples/query-blockchain-state.md", "examples/lookup-coin.md", "examples/trace-coin-lineage.md",
  ];
  let contentMismatches = 0;
  for (const relPath of LLMS_SOURCE_FILES) {
    const content = readFile(join(AGENTS_ROOT, relPath));
    if (!content) continue;
    const contentLines = content.split("\n").filter(l => l.trim().length > 50);
    // Sample 3 lines from the middle
    const samples = [
      contentLines[Math.floor(contentLines.length * 0.25)],
      contentLines[Math.floor(contentLines.length * 0.5)],
      contentLines[Math.floor(contentLines.length * 0.75)],
    ].filter(Boolean);
    for (const sample of samples) {
      if (!llmsFull.includes(sample.trim())) {
        fail(`llms-full.txt content mismatch for ${relPath}: line not found: "${sample.trim().slice(0, 80)}..."`);
        contentMismatches++;
      }
    }
  }
  if (contentMismatches === 0) {
    ok(`llms-full.txt content-inclusion verified (${LLMS_SOURCE_FILES.length} files × 3 sample lines)`);
  }

  if (llmsDriftCount === 0 && contentMismatches === 0) {
    ok(`llms-full.txt fully verified (${LLMS_FULL_CHECKS.reduce((n, [, c]) => n + c.length, 0)} phrases + ${LLMS_SOURCE_FILES.length * 3} content samples, no duplicates)`);
  }
}

// --- Check 5: Footer dates are consistent ---

// Build the footer file list dynamically by globbing all *.md in chia-for-agents.
// A hardcoded list will itself drift whenever a file is added — defeat the purpose.
function findMarkdownFiles(dir, skipDirs = ["node_modules", ".git", ".github"]) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    if (skipDirs.includes(entry)) continue;
    // Skip review artifacts (blind-review*, review-fixes*, deep-review*)
    if (entry.startsWith("blind-review") || entry.startsWith("review-fixes") || entry.startsWith("deep-review")) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...findMarkdownFiles(full, skipDirs));
    } else if (entry.endsWith(".md")) {
      results.push(full);
    }
  }
  return results;
}

// Only include files that actually contain a "Last verified" footer line.
const datePattern = /Last verified[^\n]*(\d{4}-\d{2}-\d{2})/;
const FILES_WITH_FOOTERS = AGENTS_ROOT_PRESENT
  ? findMarkdownFiles(AGENTS_ROOT).filter(f => {
      try {
        return datePattern.test(readFileSync(f, "utf8"));
      } catch { return false; }
    })
  : [];

const footerDates = new Map();

for (const filePath of FILES_WITH_FOOTERS) {
  const content = readFile(filePath);
  if (!content) continue;
  const match = content.match(datePattern);
  if (match) {
    // Use relative path for display to avoid filename collisions across subdirs
    const relPath = AGENTS_ROOT_PRESENT ? relative(AGENTS_ROOT, filePath) : filePath.split("/").pop();
    footerDates.set(relPath, match[1]);
  }
}

const uniqueDates = new Set(footerDates.values());
if (uniqueDates.size > 1) {
  fail(`Footer dates are inconsistent across ${footerDates.size} files:`);
  for (const [file, date] of footerDates) {
    console.error(`   ${file}: ${date}`);
  }
} else if (uniqueDates.size === 1) {
  ok(`Footer dates consistent: ${[...uniqueDates][0]} across ${footerDates.size} files`);
}

// --- Check 5b: llms-full.txt footer dates match ---

if (llmsFull && uniqueDates.size === 1) {
  const expectedDate = [...uniqueDates][0];
  const llmsDateMatches = [...llmsFull.matchAll(/Last verified[^\n]*(\d{4}-\d{2}-\d{2})/g)];
  const staleInLlms = llmsDateMatches.filter(m => m[1] !== expectedDate);
  if (staleInLlms.length > 0) {
    fail(`llms-full.txt has ${staleInLlms.length} stale footer date(s) (expected ${expectedDate}): ${staleInLlms.map(m => m[1]).join(", ")}`);
  } else {
    ok(`llms-full.txt footer dates: all ${llmsDateMatches.length} match ${expectedDate}`);
  }
}

// --- Check 5c: No references to offerpool.io ---

const allContentFiles = AGENTS_ROOT_PRESENT ? [
  join(AGENTS_ROOT, "ECOSYSTEM.md"),
  join(AGENTS_ROOT, "llms-full.txt"),
  join(AGENTS_ROOT, "llms.txt"),
  join(AGENTS_ROOT, "README.md"),
  join(AGENTS_ROOT, ".github", "workflows", "ci.yml"),
] : [];

let offerpoolFound = false;
for (const filePath of allContentFiles) {
  const content = readFile(filePath);
  if (content?.toLowerCase().includes("offerpool")) {
    fail(`${filePath.split("/").pop()} still references offerpool.io (removed)`);
    offerpoolFound = true;
  }
}
if (!offerpoolFound) {
  ok("No references to removed offerpool.io");
}

// --- Check 6: No references to generate-guides.js ---

const filesToCheck = [
  join(ROOT, "README.md"),
];

for (const filePath of filesToCheck) {
  const content = readFile(filePath);
  if (content?.includes("generate-guides.js")) {
    fail(`${filePath.split("/").pop()} still references generate-guides.js (which was deleted)`);
  }
}
ok("No references to deleted generate-guides.js");

// --- Check 7: src/guides/ does not exist (resources.ts is canonical) ---

const guidesDir = join(ROOT, "src", "guides");
if (existsSync(guidesDir)) {
  fail("src/guides/ exists — delete it or add equality tests. resources.ts should be canonical.");
} else {
  ok("src/guides/ absent — resources.ts is canonical guide source");
}

// --- Check 7b: No orphan constants.json outside the canonical path ---
// The canonical constants.json lives at chia-for-agents/constants.json.
// Any other copy is a stale duplicate that can silently contradict the source.
(function checkOrphanConstantsJson() {
  // Search in both repos
  const searchRoots = [ROOT];
  if (AGENTS_ROOT_PRESENT) searchRoots.push(AGENTS_ROOT);

  function findFiles(dir, filename, results = []) {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          findFiles(full, filename, results);
        } else if (entry.name === filename) {
          results.push(full);
        }
      }
    } catch (_) { /* skip unreadable dirs */ }
    return results;
  }

  const canonical = AGENTS_ROOT_PRESENT ? join(AGENTS_ROOT, "constants.json") : null;
  const allFound = [];
  for (const root of searchRoots) {
    allFound.push(...findFiles(root, "constants.json"));
  }

  const orphans = canonical
    ? allFound.filter(f => f !== canonical)
    : allFound;

  if (orphans.length > 0) {
    for (const orphan of orphans) {
      fail(`Orphan constants.json found at ${relative(ROOT, orphan)} — delete it. Canonical path: chia-for-agents/constants.json`);
    }
  } else {
    ok("No orphan constants.json outside canonical path");
  }
})();

// --- Check 8: Numeric claims registry ---
//
// These are load-bearing numeric claims that must agree across files.
// Each entry lists: a human-readable id, the exact string to search for,
// and the files in which it must appear. This catches the class of drift
// that survived sixteen reviews (B1: TPS contradiction in Review 19).

const NUMERIC_CLAIMS = [
  {
    id: "tps_simple_send",
    description: "Simple-send TPS (~19)",
    // Match "19" near "TPS" or "send"
    pattern: /\b19\b.*(?:TPS|send)|(?:TPS|send).*\b19\b/,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "EVALUATION.md"),
      join(AGENTS_ROOT, "resources", "coin-model.md"),
    ] : [],
  },
  {
    id: "block_time_any",
    description: "Any-block time (~18.75s)",
    pattern: /18\.75/,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "EVALUATION.md"),
      join(AGENTS_ROOT, "resources", "coin-model.md"),
    ] : [],
  },
  {
    id: "max_block_cost",
    description: "MAX_BLOCK_COST_CLVM (11,000,000,000 or 11e9 or 11B)",
    pattern: /11[,_]?000[,_]?000[,_]?000|11e9|11B/,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "EVALUATION.md"),
      join(AGENTS_ROOT, "resources", "coin-model.md"),
      join(AGENTS_ROOT, "constants.json"),
    ] : [],
  },
  {
    id: "tx_block_ratio",
    description: "Transaction-block ratio (~36%)",
    pattern: /36%/,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "EVALUATION.md"),
      join(AGENTS_ROOT, "resources", "coin-model.md"),
    ] : [],
  },
  {
    id: "mojos_per_xch",
    description: "Mojos per XCH (1,000,000,000,000 / 10^12 / 1e12)",
    pattern: /1[,_]?000[,_]?000[,_]?000[,_]?000|10\^?12|1e12/,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "resources", "coin-model.md"),
      join(AGENTS_ROOT, "constants.json"),
    ] : [],
  },
  {
    id: "llm_mistake_count",
    description: "LLM mistake count (thirty-two/32)",
    // Derive expected count dynamically below — this pattern is the fallback literal check.
    // Count is computed from numbered items in coin-model.md and compared against prose references.
    pattern: /thirty-two|32/i,
    files: AGENTS_ROOT_PRESENT ? [
      join(AGENTS_ROOT, "REFERENCE.md"),
    ] : [],
  },
];

let numericDriftCount = 0;
for (const claim of NUMERIC_CLAIMS) {
  for (const filePath of claim.files) {
    const content = readFile(filePath);
    if (!content) continue;
    if (!claim.pattern.test(content)) {
      fail(`Numeric claim "${claim.id}" (${claim.description}) not found in ${filePath.split("/").pop()}`);
      numericDriftCount++;
    }
  }
}
if (numericDriftCount === 0 && NUMERIC_CLAIMS.some(c => c.files.length > 0)) {
  ok(`Numeric claims registry: all ${NUMERIC_CLAIMS.length} claims verified across files`);
}

// --- Check: Derive LLM mistake count from coin-model.md and verify prose references ---
//
// The count of numbered items in the "Common LLM Mistakes" section of coin-model.md
// is the canonical source. Prose references in REFERENCE.md, blog-post.md, and HANDOFF.md must agree.

if (coinModel) {
  // Extract only the "Common LLM Mistakes About Chia" section
  const mistakesSectionMatch = coinModel.match(/##\s*Common LLM Mistakes About Chia([\s\S]*?)(?=\n##\s|\n#\s|$)/);
  const mistakesSection = mistakesSectionMatch ? mistakesSectionMatch[1] : coinModel;
  // Count numbered list items in that section
  const mistakeCount = (mistakesSection.match(/^\d+\. /gm) || []).length;
  ok(`Derived LLM mistake count from coin-model.md: ${mistakeCount} items`);

  const MISTAKE_COUNT_FILES = AGENTS_ROOT_PRESENT ? [
    join(AGENTS_ROOT, "REFERENCE.md"),
    join(AGENTS_ROOT, "blog-post.md"),
    join(AGENTS_ROOT, "llms.txt"),
    join(ROOT, "src", "resources.ts"),
  ] : [];

  const countPattern = new RegExp(`\\b${mistakeCount}\\b`, "g");
  const wordsMap = {
    20: "twenty", 21: "twenty-one", 22: "twenty-two",
    23: "twenty-three", 24: "twenty-four", 25: "twenty-five",
    26: "twenty-six", 27: "twenty-seven", 28: "twenty-eight",
    29: "twenty-nine", 30: "thirty", 31: "thirty-one", 32: "thirty-two",
    33: "thirty-three", 34: "thirty-four", 35: "thirty-five",
    36: "thirty-six", 37: "thirty-seven", 38: "thirty-eight", 39: "thirty-nine", 40: "forty",
  };
  const wordPattern = wordsMap[mistakeCount] ? new RegExp(wordsMap[mistakeCount], "i") : null;

  // blog-post.md is an optional deliverable distributed separately from the tarball.
  // Use readFileOptional so its absence is tracked as a skip, not a failure.
  const BLOG_POST_PATH = AGENTS_ROOT_PRESENT ? join(AGENTS_ROOT, "blog-post.md") : null;

  let mistakeDrift = 0;
  const actuallyReadFiles = [];  // track files we successfully read (not skipped)
  const skippedFiles = [];       // track files that were absent
  for (const filePath of MISTAKE_COUNT_FILES) {
    const isBlogPost = BLOG_POST_PATH && filePath === BLOG_POST_PATH;
    const content = isBlogPost ? readFileOptional(filePath) : readFile(filePath);
    if (!content) {
      skippedFiles.push(filePath.split("/").pop());
      continue;
    }
    actuallyReadFiles.push(filePath.split("/").pop());
    countPattern.lastIndex = 0;
    const hasDigit = countPattern.test(content);
    const hasWord = wordPattern ? wordPattern.test(content) : false;
    if (!hasDigit && !hasWord) {
      fail(`LLM mistake count (${mistakeCount}) not found in ${filePath.split("/").pop()} — update the reference`);
      mistakeDrift++;
    }
  }
  if (mistakeDrift === 0 && actuallyReadFiles.length > 0) {
    const checkedNames = actuallyReadFiles.join(", ");
    const skipNote = skippedFiles.length > 0 ? ` (skipped: ${skippedFiles.join(", ")})` : "";
    ok(`LLM mistake count (${mistakeCount}) verified in: ${checkedNames}${skipNote}`);
  }
}

// --- Check: XCH send cost cross-file agreement ---
//
// constants.json ships node_cost_estimates.send_xch_transaction (9401710, 1-in/2-out).
// Prose uses ~17M (2-in/2-out). The _note in constants.json must explain this.
// Also verify the get_fee_estimate description in tools.ts references ~17,000,000.

if (AGENTS_ROOT_PRESENT && constantsRaw && toolsRaw) {
  const constants = JSON.parse(constantsRaw);
  const nodeCost = constants.node_cost_estimates?.send_xch_transaction;
  const notePresent = constants.node_cost_estimates?._note?.includes("17");
  const toolsFeeDesc = toolsRaw.includes("17,000,000") || toolsRaw.includes("17000000");

  if (nodeCost && !notePresent) {
    fail(`constants.json node_cost_estimates._note missing — must explain 9.4M (1-in/2-out) vs ~17M (2-in/2-out) discrepancy`);
  } else if (notePresent) {
    ok(`constants.json node_cost_estimates._note reconciles 1-in/2-out vs 2-in/2-out cost`);
  }
  if (!toolsFeeDesc) {
    fail(`tools.ts get_fee_estimate description should reference ~17,000,000 CLVM cost for a realistic XCH send`);
  } else {
    ok(`tools.ts get_fee_estimate references ~17,000,000 CLVM cost`);
  }

  // Verify standard_xch_send_cost_standalone and standard_xch_send_cost_in_generator exist
  const standaloneCost = constants.standard_xch_send_cost_standalone;
  const inGenCost = constants.standard_xch_send_cost_in_generator;
  if (!standaloneCost || standaloneCost !== 17000000) {
    fail(`constants.json standard_xch_send_cost_standalone missing or wrong (expected 17000000, got ${standaloneCost})`);
  } else {
    ok(`constants.json standard_xch_send_cost_standalone = ${standaloneCost} (standalone single-bundle cost)`);
  }
  if (!inGenCost || inGenCost !== 6000000) {
    fail(`constants.json standard_xch_send_cost_in_generator missing or wrong (expected 6000000, got ${inGenCost})`);
  } else {
    ok(`constants.json standard_xch_send_cost_in_generator = ${inGenCost} (in-block compressed cost for TPS derivation)`);
  }
}

// --- Check: MCP instructions string length is drift-tracked ---
//
// The instructions string length (1,182 chars) is cited in HANDOFF, blog-post, and PLAN.
// Any change to index.ts instructions must update those references.
// We extract the backtick template literal after "instructions:" and measure it.

if (AGENTS_ROOT_PRESENT) {
  const indexPath = join(ROOT, "src", "index.ts");
  const indexContent = readFile(indexPath);
  if (indexContent) {
    // Find the instructions backtick string. It spans from `instructions: \`` to the closing \`
    const instrStart = indexContent.indexOf("instructions: `");
    if (instrStart !== -1) {
      const contentStart = instrStart + "instructions: `".length;
      // Find closing backtick (not escaped) — scan forward
      let end = contentStart;
      while (end < indexContent.length && indexContent[end] !== '`') end++;
      const instrLen = end - contentStart;
      // Check HANDOFF and blog-post mention the correct length
      const LENGTH_FILES = [
        join(AGENTS_ROOT, "blog-post.md"),
        join(AGENTS_ROOT, "HANDOFF.md"),
      ];
      // Match both "1182" and "1,182" (comma-formatted number in prose)
      const formatted = instrLen.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const lenPattern = new RegExp(`\\b${instrLen}\\b|\\b${formatted.replace(",", ",")}\\b`);
      let lenDrift = 0;
      for (const filePath of LENGTH_FILES) {
        const content = readFile(filePath);
        if (!content) continue;
        if (!lenPattern.test(content)) {
          fail(`Instructions string length (${instrLen} chars) not found in ${filePath.split("/").pop()} — update the reference`);
          lenDrift++;
        }
      }
      if (lenDrift === 0) {
        ok(`Instructions string length (${instrLen} chars) verified in prose references`);
      }
    }
  }
}

// --- Check Q21a: Validate inline Opcode N references in markdown against canonical map ---
//
// Catches F1-class bugs: prose like "Opcode 74 — ..." that disagrees with the canonical
// condition_opcodes map. We build an inverse map from opcode decimal → name, then scan
// every markdown file for "Opcode (\d+)" references.

if (AGENTS_ROOT_PRESENT && constantsRaw) {
  const constants = JSON.parse(constantsRaw);
  // constants.condition_opcodes: name -> hex (e.g. "ASSERT_MY_BIRTH_SECONDS": "0x4a")
  // Build: decimal -> name
  const decimalToName = {};
  for (const [name, hex] of Object.entries(constants.condition_opcodes)) {
    const decimal = parseInt(hex, 16);
    decimalToName[decimal] = name;
  }

  const MARKDOWN_FILES_TO_SCAN = [
    join(AGENTS_ROOT, "REFERENCE.md"),
    join(AGENTS_ROOT, "AGENTS.md"),
    join(AGENTS_ROOT, "README.md"),
    join(AGENTS_ROOT, "resources", "coin-model.md"),
    join(AGENTS_ROOT, "resources", "rpc-quickstart.md"),
    join(AGENTS_ROOT, "examples", "lookup-coin.md"),
    join(AGENTS_ROOT, "examples", "trace-coin-lineage.md"),
    join(AGENTS_ROOT, "SECURITY.md"),
    join(AGENTS_ROOT, "EVALUATION.md"),
    join(AGENTS_ROOT, "ECOSYSTEM.md"),
  ];

  let opcodeRefErrors = 0;
  for (const filePath of MARKDOWN_FILES_TO_SCAN) {
    const content = readFile(filePath);
    if (!content) continue;
    const filename = filePath.split("/").pop();

    // Find all "Opcode N" references (where N is a decimal number)
    const opcodeRefs = [...content.matchAll(/Opcode\s+(\d+)/g)];
    for (const match of opcodeRefs) {
      const decimal = parseInt(match[1]);
      const canonicalName = decimalToName[decimal];

      if (canonicalName === undefined) {
        // Opcode number not in canonical map — could be intentional non-condition opcode,
        // but flag it for review
        fail(`${filename}: "Opcode ${decimal}" not found in canonical condition_opcodes map`);
        opcodeRefErrors++;
        continue;
      }

      // Check if the line around this reference names the right opcode
      // Find the line containing this match
      const lineStart = content.lastIndexOf("\n", match.index) + 1;
      const lineEnd = content.indexOf("\n", match.index);
      const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);

      // Check that the line contains the canonical name (or a variant of it)
      // We check for the base name (without _FAILED suffix) to handle error catalogue entries
      const baseName = canonicalName.replace(/_FAILED$/, "");
      const baseNameNoPrefix = baseName.replace(/^(ASSERT_|AGG_SIG_)/, "");
      if (!line.includes(canonicalName) && !line.includes(baseName) && !line.includes(baseNameNoPrefix)) {
        fail(`${filename}: "Opcode ${decimal}" — canonical name is ${canonicalName} but line does not reference it:\n   ${line.trim()}`);
        opcodeRefErrors++;
      }
    }
  }
  if (opcodeRefErrors === 0) {
    ok(`Inline Opcode N references: all verified against canonical map (${MARKDOWN_FILES_TO_SCAN.length} files scanned)`);
  }
}

// --- Check Q21b: Fail on using .spent as the spent-check ---
//
// The `spent` boolean IS present in RPC responses (added by coin_record_dict_backwards_compat()),
// so mentioning it is fine. What's wrong is USING it as the spent-check instead of
// spent_block_index > 0, since spent is a compat shim field, not the canonical struct field.
// Allowed: mentioning "spent" descriptively, explaining it exists, documenting the compat shim
// Disallowed: using .spent as the actual check (e.g., `.spent === true`, `if.*\.spent[^_]`, `["spent"]`)

if (AGENTS_ROOT_PRESENT) {
  const SPENT_CHECK_FILES = [
    join(AGENTS_ROOT, "AGENTS.md"),
    join(AGENTS_ROOT, "REFERENCE.md"),
    join(AGENTS_ROOT, "README.md"),
    join(AGENTS_ROOT, "resources", "coin-model.md"),
    join(AGENTS_ROOT, "resources", "rpc-quickstart.md"),
    join(AGENTS_ROOT, "examples", "lookup-coin.md"),
    join(AGENTS_ROOT, "examples", "trace-coin-lineage.md"),
    join(AGENTS_ROOT, "examples", "query-blockchain-state.md"),
    join(AGENTS_ROOT, "SECURITY.md"),
    join(AGENTS_ROOT, "ECOSYSTEM.md"),
    join(AGENTS_ROOT, "EVALUATION.md"),
    join(AGENTS_ROOT, "llms-full.txt"),
  ];

  // Patterns that indicate USING .spent as the spent-check (not just mentioning it)
  const SPENT_AS_CHECK_PATTERNS = [
    // .spent used in a boolean check: .spent === true, .spent == true, .spent !== false, etc.
    /\.spent\s*===?\s*(true|false)/g,
    // .spent used in an if-condition (not followed by _block_index)
    /if\s*\(.*\.spent(?!_block_index|_coins)/g,
    // ["spent"] as a dict lookup for checking (not in descriptive prose)
    /\["spent"\]\s*===?\s*(true|false)/g,
    // `spent: true` or `spent: false` as JSON field used for checking
    /`spent:\s*(true|false)`/g,
  ];

  let spentCheckErrors = 0;
  for (const filePath of SPENT_CHECK_FILES) {
    const content = readFile(filePath);
    if (!content) continue;
    const filename = filePath.split("/").pop();

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip lines that are explicitly documenting the rule or explaining the compat field
      if (line.includes("don't rely on") || line.includes("do not rely on") ||
          line.includes("compat shim") || line.includes("compatibility shim") ||
          line.includes("coin_record_dict_backwards_compat") || line.includes("@property") ||
          line.includes("Use spent_block_index") || line.includes("use spent_block_index") ||
          line.includes("spent_block_index > 0") || line.includes("not part of the canonical")) {
        continue;
      }
      // Skip code comments explaining the rule
      if (line.trim().startsWith("#") && (line.includes("spent_block_index") || line.includes("not a JSON") || line.includes("NOT"))) {
        continue;
      }

      for (const pattern of SPENT_AS_CHECK_PATTERNS) {
        pattern.lastIndex = 0;
        const matches = [...line.matchAll(pattern)];
        for (const match of matches) {
          const ctx = line.slice(Math.max(0, match.index - 5), match.index + match[0].length + 15);
          if (ctx.includes("_block_index") || ctx.includes("_coins")) {
            continue;
          }
          fail(`${filename}:${i + 1}: .spent used as spent-check (use spent_block_index > 0 instead — .spent is a compat shim): ${line.trim().slice(0, 100)}`);
          spentCheckErrors++;
        }
      }
    }
  }
  if (spentCheckErrors === 0) {
    ok(`No .spent used as spent-check (mentions of spent field allowed; spent_block_index > 0 is the canonical check)`);
  }
}

// --- Check Q21c: Fail on jq extracting .amount paths ---
//
// Catches F3-class bugs: jq used to extract coin amounts, which loses precision
// on uint64 values > 2^53. The docs explicitly warn against this. Any jq
// expression extracting a path ending in .amount should use python3 instead.

if (AGENTS_ROOT_PRESENT) {
  const JQ_AMOUNT_FILES = [
    join(AGENTS_ROOT, "examples", "lookup-coin.md"),
    join(AGENTS_ROOT, "examples", "trace-coin-lineage.md"),
    join(AGENTS_ROOT, "examples", "query-blockchain-state.md"),
    join(AGENTS_ROOT, "resources", "rpc-quickstart.md"),
    join(AGENTS_ROOT, "AGENTS.md"),
    join(AGENTS_ROOT, "REFERENCE.md"),
  ];

  // Pattern: jq expression that extracts a path ending in .amount (but not .amount_mojos or similar)
  // Matches things like: jq '.coin.amount', jq -r '.coin_record.coin.amount', jq '... .amount ...'
  // We look for jq commands that reference .amount as a terminal field (not .amount_mojos, .amount_str, etc.)
  const JQ_AMOUNT_PATTERN = /jq\s+(?:-[rR]\s+)?['"](?:[^'"]*\.amount(?!_)[^'"]*)['"]/g;
  // Also match inline jq with .amount in object projection: {amount: .coin.amount}
  const JQ_AMOUNT_PROJECTION = /jq\s+['""][^'"]*\bamount\b\s*:\s*\.(?:[\w.]*\.)?amount(?!_)[^'"]*['"]/g;

  let jqAmountErrors = 0;
  for (const filePath of JQ_AMOUNT_FILES) {
    const content = readFile(filePath);
    if (!content) continue;
    const filename = filePath.split("/").pop();

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment lines explaining why not to do it
      if (line.trim().startsWith("#") && (line.includes("python3") || line.includes("uint64") || line.includes("precision"))) {
        continue;
      }

      JQ_AMOUNT_PATTERN.lastIndex = 0;
      JQ_AMOUNT_PROJECTION.lastIndex = 0;
      const m1 = JQ_AMOUNT_PATTERN.exec(line);
      const m2 = JQ_AMOUNT_PROJECTION.exec(line);
      if (m1 || m2) {
        fail(`${filename}:${i + 1}: jq extracting .amount (loses uint64 precision — use python3 instead): ${line.trim().slice(0, 100)}`);
        jqAmountErrors++;
      }
    }
  }
  if (jqAmountErrors === 0) {
    ok(`No jq .amount extractions found (uint64 precision protected)`);
  }
}

// --- Check: No "offer sniping" claims that contradict the superset rule ---
// The default mempool's superset rule prevents offer sniping. Claims that
// offers are "race-able" or "snipeable" without qualification are wrong.
if (AGENTS_ROOT_PRESENT) {
  const snipingFiles = ["EVALUATION.md", "AGENTS.md", "REFERENCE.md", "SECURITY.md"];
  let snipingIssues = 0;
  for (const relPath of snipingFiles) {
    const content = readFile(join(AGENTS_ROOT, relPath));
    if (!content) continue;
    // Flag bare "offer sniping" or "race-able" claims that don't mention the superset rule
    if (/offer sniping|race-able.*offer|sniping.*offer/i.test(content) && !/superset rule/i.test(content)) {
      fail(`${relPath}: mentions offer sniping without referencing the superset rule`);
      snipingIssues++;
    }
  }
  if (snipingIssues === 0) {
    ok("No unqualified offer-sniping claims (superset rule referenced where needed)");
  }
}

// --- Check: No false "32-block reorg bound" claims ---
// Chia has no protocol-enforced maximum reorg depth. The "32" was a conflation
// with SLOT_BLOCKS_TARGET. Catch any remnant across all files including resources.ts.
{
  const reorgFiles = AGENTS_ROOT_PRESENT
    ? ["resources/coin-model.md", "REFERENCE.md", "SECURITY.md", "EVALUATION.md", "AGENTS.md"].map(f => join(AGENTS_ROOT, f))
    : [];
  reorgFiles.push(join(ROOT, "src", "resources.ts"));
  let reorgIssues = 0;
  for (const filePath of reorgFiles) {
    const content = readFile(filePath);
    if (!content) continue;
    if (/reverse the last 32 blocks|32.block reorg bound|reorg.*cap.*32|maximum reorg.*32/i.test(content)) {
      fail(`${filePath.split("/").pop()}: contains false "32-block reorg" claim — Chia has no protocol-enforced max reorg depth`);
      reorgIssues++;
    }
  }
  if (reorgIssues === 0) {
    ok("No false 32-block reorg claims (Chia has no protocol-enforced max reorg depth)");
  }
}

// --- Check: 256-day replot window must be qualified when it appears ---
//
// The April 2026 CHIP-49 Q&A described a 256-day replot window as "likely" — it is NOT
// a finalized protocol parameter. Any file that mentions "256" near "day" or "replot" must
// include a qualifier (likely / provisional / not yet final / estimate) to avoid presenting
// an unconfirmed parameter as settled fact.
//
// Note: As of v30/v31, the 256-day/replot content has been removed from both projects.
// This check remains as a prophylactic guard against re-introduction.
{
  const QUALIFIER_RE = /likely|provisional|not yet final|treat as provisional|open for input|estimate/i;
  // Match lines that mention "256" near "day" or "replot" (case-insensitive, within 60 chars)
  const REPLOT_256_RE = /(?:256.{0,30}(?:day|replot)|(?:day|replot).{0,30}256)/i;

  const scanExts = [".md", ".ts", ".json", ".txt"];
  const skipDirs = ["node_modules", ".git", "dist"];

  function* walkFiles(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (skipDirs.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) yield* walkFiles(full);
      else if (entry.isFile() && scanExts.some(e => entry.name.endsWith(e))) yield full;
    }
  }

  const searchRoots = [ROOT, ...(AGENTS_ROOT_PRESENT ? [AGENTS_ROOT] : [])];
  let replotIssues = 0;
  const replotViolations = [];

  for (const searchRoot of searchRoots) {
    for (const filePath of walkFiles(searchRoot)) {
      const content = readFile(filePath);
      if (!content) continue;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!REPLOT_256_RE.test(line)) continue;
        // Check the surrounding context window (±2 lines) for a qualifier
        const window = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join(" ");
        if (!QUALIFIER_RE.test(window)) {
          const rel = filePath.replace(ROOT, "").replace(AGENTS_ROOT, "").replace(/^\//, "");
          replotViolations.push(`${rel}:${i + 1}: ${line.trim().substring(0, 100)}`);
          replotIssues++;
        }
      }
    }
  }

  if (replotIssues > 0) {
    for (const v of replotViolations) {
      fail(`256-day replot window stated without qualifier: ${v}`);
    }
  } else {
    ok("No unqualified 256-day replot window claims (all occurrences include likely/provisional qualifier or none exist)");
  }
}

// --- Check: TibetSwap framing consistency ---
// The canonical framing is "will not relaunch at this time" (per operator's 2026-09-10 post-mortem).
// The phrase "has since shut down" is unqualified and inconsistent with the hedged language in
// EVALUATION.md and ECOSYSTEM.md. Fail if blog-post.md uses the bare "shut down" form.
(function checkTibetSwapFraming() {
  if (!AGENTS_ROOT_PRESENT) return;
  const blogPath = join(AGENTS_ROOT, "blog-post.md");
  const blogContent = readFile(blogPath);
  if (!blogContent) return;
  // Check that blog-post.md contains the hedged phrasing, not the bare "has since shut down"
  if (blogContent.includes("protocol has since shut down")) {
    fail(`blog-post.md uses "protocol has since shut down" — use hedged form "will not relaunch at this time" consistent with EVALUATION.md and ECOSYSTEM.md`);
  } else {
    ok(`TibetSwap framing in blog-post.md uses hedged "will not relaunch" form`);
  }
})();

// Pre-load resources.ts (used in multiple checks below)
const resourcesPath = join(ROOT, "src", "resources.ts");
const resourcesContent = readFile(resourcesPath);

// --- Check: "What You Cannot Do" canonical section integrity ---
//
// AGENTS.md is the authoritative source for "What You Cannot Do".
// README.md has a shortened routing version that points to AGENTS.md.
// We verify:
// (a) AGENTS.md contains the canonical full list (spot-check key bullets)
// (b) README.md references AGENTS.md for the full list (not a self-contained duplicate)
// This prevents the two-file divergence pattern identified in Review 24 (Item 13).

if (AGENTS_ROOT_PRESENT) {
  const agentsContent = readFile(join(AGENTS_ROOT, "AGENTS.md"));
  const readmeContent = readFile(join(AGENTS_ROOT, "README.md"));

  if (agentsContent) {
    const requiredInAgents = [
      "Query CAT/NFT balances directly",
      "Create or sign transactions",
      "Subscribe to real-time events",
      "Screen an address for scam",
    ];
    let agentsMissing = 0;
    for (const phrase of requiredInAgents) {
      if (!agentsContent.includes(phrase)) {
        fail(`AGENTS.md "What You Cannot Do" missing: "${phrase}"`);
        agentsMissing++;
      }
    }
    if (agentsMissing === 0) {
      ok(`AGENTS.md "What You Cannot Do" has all required bullets`);
    }
  }

  if (readmeContent) {
    // README should point to AGENTS.md for the full list, not duplicate it verbatim
    // Check that README's "What You Cannot Do" section links to AGENTS.md
    if (!readmeContent.includes("AGENTS.md") || !readmeContent.includes("What You Cannot Do")) {
      fail(`README.md "What You Cannot Do" section must link to AGENTS.md (not standalone duplicate)`);
    } else {
      ok(`README.md "What You Cannot Do" links to canonical AGENTS.md`);
    }

    // Safety-critical "Cannot Do" items must appear in README too (it's the landing page)
    const safetyBullets = [
      "Screen an address for scam",
      "Set up or manage a wallet",
    ];
    let readmeMissing = 0;
    for (const phrase of safetyBullets) {
      if (!readmeContent.includes(phrase)) {
        fail(`README.md "What You Cannot Do" missing safety-critical bullet: "${phrase}"`);
        readmeMissing++;
      }
    }
    if (readmeMissing === 0) {
      ok(`README.md "What You Cannot Do" has all safety-critical bullets`);
    }
  }
}

// --- Check: Numeric claims in resources.ts embedded guides against constants.json ---
//
// F7 finding: embedded MCP guides get weaker drift protection than llms-full.txt.
// Verify that key numeric constants referenced in resources.ts match constants.json.

if (AGENTS_ROOT_PRESENT && constantsRaw && resourcesContent) {
  const constants = JSON.parse(constantsRaw);
  let guidesNumericErrors = 0;

  // Check mojos_per_xch appears correctly in resources.ts
  const mojosValue = constants.mojos_per_xch;
  if (mojosValue && !resourcesContent.includes(String(mojosValue).replace(/(\d{3})/g, '$1').slice(0,-1))) {
    // Simplified check: verify 1,000,000,000,000 or 10^12 appears
    if (!resourcesContent.includes("1,000,000,000,000") && !resourcesContent.includes("10¹²") && !resourcesContent.includes("10^12") && !resourcesContent.includes("1e12")) {
      fail(`resources.ts embedded guides: mojos_per_xch value not found (expected 1,000,000,000,000 or 10^12)`);
      guidesNumericErrors++;
    }
  }

  // Check cat_decimal_places (3) is referenced
  const catDecimals = constants.cat_decimal_places;
  if (catDecimals !== undefined) {
    // Look for "3 decimal" in resources.ts
    if (!resourcesContent.includes("3 decimal") && !resourcesContent.includes("three decimal")) {
      fail(`resources.ts embedded guides: cat_decimal_places (3) not referenced`);
      guidesNumericErrors++;
    }
  }

  // Check condition opcode count matches: 35 opcodes
  const opcodeCount = Object.keys(constants.condition_opcodes || {}).length;
  if (opcodeCount > 0 && !resourcesContent.includes(`${opcodeCount} condition opcode`)) {
    fail(`resources.ts embedded guides: opcode count (${opcodeCount}) not mentioned`);
    guidesNumericErrors++;
  }

  if (guidesNumericErrors === 0) {
    ok(`resources.ts embedded guides: numeric claims verified against constants.json`);
  }
}

// --- Check Q17: Embedded guide strings in resources.ts vs markdown sources ---
//
// The guide strings in resources.ts are intentionally CONDENSED rewrites of the
// full markdown files (see the comment at the top of resources.ts). They cannot
// be compared verbatim against the source markdown. Instead, we verify that
// key conceptual phrases from the markdown appear in the embedded guide — enough
// to detect major content divergence without false-positiving on rewrites.
//
// Note: resourcesContent and resourcesPath are already loaded above.

if (resourcesContent && AGENTS_ROOT_PRESENT) {
  // Phrases that MUST appear in the resources.ts embedded guides.
  // These are concept-level phrases from the markdown that any condensed rewrite
  // should preserve. If they're missing, the guide has drifted from the source.
  const GUIDE_PHRASE_CHECKS = [
    {
      id: "coin-model",
      phrases: [
        "spent_block_index",     // core field, must be in any coin-model guide
        "uint64",                // precision warning
        "mojos",                 // denomination
        "puzzle_hash",           // fundamental concept
        "spend bundle",          // transaction model
      ],
    },
    {
      id: "rpc-quickstart",
      phrases: [
        "get_coin_record_by_name",  // primary RPC
        "puzzle_hash",              // core field
        "spent_block_index",        // spent status (must not reference .spent)
        "Content-Type",             // curl examples
      ],
    },
  ];

  let guideDriftCount = 0;
  for (const { id, phrases } of GUIDE_PHRASE_CHECKS) {
    for (const phrase of phrases) {
      if (!resourcesContent.includes(phrase)) {
        fail(`resources.ts embedded guide "${id}" missing key phrase: "${phrase}" — may have drifted from source docs`);
        guideDriftCount++;
      }
    }
  }

  // Check that resources.ts does NOT use .spent as the spent-check
  // (mentioning spent is fine — it exists in responses — but using it AS the check is wrong)
  const resourcesLines = resourcesContent.split("\n");
  for (let i = 0; i < resourcesLines.length; i++) {
    const line = resourcesLines[i];
    if (/\.spent\s*===?\s*(true|false)/.test(line) ||
        (/if\s*\(.*\.spent(?!_block_index|_coins)/.test(line))) {
      fail(`resources.ts:${i+1}: .spent used as spent-check in embedded guide (use spent_block_index > 0): ${line.trim().slice(0, 80)}`);
      guideDriftCount++;
    }
  }

  if (guideDriftCount === 0) {
    ok(`resources.ts embedded guides verified: key phrases present, no bare .spent references`);
  }
}

// --- Check: Count coin-model items in resources.ts vs coin-model.md ---
//
// Don't match numerals in headers — actually count the bullet items and compare.

if (resourcesContent && coinModel) {
  // Count items in resources.ts: lines starting with "- **\""
  const resourcesBullets = (resourcesContent.match(/^- \*\*"/gm) || []).length;

  // Count items in coin-model.md: numbered lines like "1. **\""
  const coinModelItems = (coinModel.match(/^\d+\.\s+\*\*"/gm) || []).length;

  if (resourcesBullets !== coinModelItems) {
    fail(`Coin-model item count mismatch: resources.ts has ${resourcesBullets} bullet items, coin-model.md has ${coinModelItems} numbered items`);
  } else {
    ok(`Coin-model item count matches: ${resourcesBullets} items in both resources.ts and coin-model.md`);
  }

  // Also verify the header claim matches the actual count
  const headerMatch = resourcesContent.match(/Common LLM Mistakes About Chia \((\d+) items\)/);
  if (headerMatch) {
    const headerCount = parseInt(headerMatch[1]);
    if (headerCount !== resourcesBullets) {
      fail(`resources.ts header claims ${headerCount} items but contains ${resourcesBullets} bullet items`);
    } else {
      ok(`resources.ts header count (${headerCount}) matches actual bullet count`);
    }
  }
}

// --- Check: Assert stated file sizes for llms-full.txt ---
//
// Any "~NNN KB" claim about llms-full.txt should be within ±15% of actual size.

if (AGENTS_ROOT_PRESENT) {
  const llmsFullPath2 = join(AGENTS_ROOT, "llms-full.txt");
  if (existsSync(llmsFullPath2)) {
    const actualBytes = statSync(llmsFullPath2).size;
    const actualKB = Math.round(actualBytes / 1024);

    // Scan all files for "~NNN KB" claims near "llms-full"
    const SIZE_CLAIM_FILES = [
      join(AGENTS_ROOT, "llms.txt"),
      join(AGENTS_ROOT, "AGENTS.md"),
      join(AGENTS_ROOT, "llms-full.txt"),
    ];

    let sizeClaimErrors = 0;
    for (const filePath of SIZE_CLAIM_FILES) {
      const content = readFile(filePath);
      if (!content) continue;
      const filename = filePath.split("/").pop();

      // Match patterns like "~113 KB", "~100KB", "~155 KB" near llms-full context
      const sizeMatches = [...content.matchAll(/~(\d+)\s*KB/g)];
      for (const match of sizeMatches) {
        // Check if this claim is about llms-full.txt (within 200 chars of "llms-full" or "llms_full")
        const start = Math.max(0, match.index - 200);
        const end = Math.min(content.length, match.index + 200);
        const context = content.slice(start, end);
        if (!/llms[-_]full/i.test(context) && !/LLM ingestion/i.test(context)) continue;

        const claimedKB = parseInt(match[1]);
        const tolerance = 0.15;
        const lowerBound = actualKB * (1 - tolerance);
        const upperBound = actualKB * (1 + tolerance);
        if (claimedKB < lowerBound || claimedKB > upperBound) {
          fail(`${filename}: claims llms-full.txt is ~${claimedKB} KB but actual size is ${actualKB} KB (±15% tolerance: ${Math.round(lowerBound)}-${Math.round(upperBound)} KB)`);
          sizeClaimErrors++;
        }
      }
    }
    if (sizeClaimErrors === 0) {
      ok(`llms-full.txt size claims verified (actual: ${actualKB} KB, all claims within ±15%)`);
    }
  }
}

// --- Check: Capability-claim registry (mTLS caveat) ---
//
// Any file mentioning CHIA_FULL_NODE_URL alongside "localhost" or "local node"
// must also mention "mTLS" or "reverse proxy". This catches the F1-class bug
// where local-node recommendations omit the mTLS requirement.

{
  const MTLS_CHECK_FILES = [
    join(ROOT, "README.md"),
    join(ROOT, "src", "tools.ts"),
    join(ROOT, "src", "resources.ts"),
  ];

  if (AGENTS_ROOT_PRESENT) {
    MTLS_CHECK_FILES.push(
      join(AGENTS_ROOT, "SECURITY.md"),
      join(AGENTS_ROOT, "blog-post.md"),
      join(AGENTS_ROOT, "AGENTS.md"),
      join(AGENTS_ROOT, "README.md"),
    );
  }

  let mtlsErrors = 0;
  for (const filePath of MTLS_CHECK_FILES) {
    const content = readFileOptional(filePath);
    if (!content) continue;
    const filename = filePath.split("/").pop();

    // Check if file mentions CHIA_FULL_NODE_URL alongside localhost or local node
    const hasLocalNodeRef = /CHIA_FULL_NODE_URL/.test(content) &&
      (/localhost/i.test(content) || /local\s+node/i.test(content) || /your own node/i.test(content));

    if (hasLocalNodeRef) {
      const hasCaveat = /mTLS/i.test(content) || /reverse proxy/i.test(content);
      if (!hasCaveat) {
        fail(`${filename}: mentions CHIA_FULL_NODE_URL with local node but missing mTLS/reverse proxy caveat`);
        mtlsErrors++;
      }
    }
  }
  if (mtlsErrors === 0) {
    ok(`Capability-claim registry: all local-node references include mTLS caveat`);
  }
}

// --- Check: Description-vs-implementation drift (response field names in tests) ---
//
// Verifies that key response field names mentioned in composite tool descriptions
// actually appear in the corresponding test file assertions. This catches the class
// of bug from F1 (trace_coin_lineage description promising fields that don't exist).

{
  const compositeTestPath = join(ROOT, "src", "__tests__", "tools-composite.test.ts");
  const compositeTest = readFileOptional(compositeTestPath);
  const integrationTestPath = join(ROOT, "src", "__tests__", "tools-integration.test.ts");
  const integrationTest = readFileOptional(integrationTestPath);

  if (compositeTest && toolsRaw) {
    let fieldDriftErrors = 0;

    const FIELD_CHECKS = [
      {
        tool: "trace_coin_lineage",
        fields: ["reached_origin", "truncated_at_max_depth"],
        testFile: compositeTest,
        testName: "tools-composite.test.ts",
      },
      {
        tool: "get_address_summary",
        fields: ["complete", "unspent_coin_count", "pages_scanned", "total_mojos", "total_xch"],
        testFile: compositeTest,
        testName: "tools-composite.test.ts",
      },
      {
        tool: "decode_offer",
        fields: ["coin_spends", "has_aggregated_signature", "coin_id", "parent_coin_info"],
        testFile: compositeTest,
        testName: "tools-composite.test.ts",
      },
      {
        tool: "decode_offer",
        fields: ["amount_mojos", "puzzle_reveal_size_bytes", "solution_size_bytes", "num_coin_spends", "spend_bundle_hash", "has_aggregated_signature"],
        testFile: integrationTest,
        testName: "tools-integration.test.ts",
      },
      {
        tool: "summarize_block",
        fields: ["additions_count", "removals_count", "net_mojos", "unique_puzzle_hashes", "total_added_mojos", "total_removed_mojos", "top_additions", "top_removals", "top_receivers", "top_senders"],
        testFile: compositeTest,
        testName: "tools-composite.test.ts",
      },
    ];

    for (const { tool, fields, testFile, testName } of FIELD_CHECKS) {
      // Verify each field appears in the tool description in tools.ts
      // Find the tool description block (search for the tool name string)
      const toolDescIdx = toolsRaw.indexOf(`"${tool}"`);
      if (toolDescIdx === -1) {
        fail(`Description drift: tool "${tool}" not found in tools.ts`);
        fieldDriftErrors++;
        continue;
      }
      // Get the next ~2000 chars after the tool name to capture the description
      const descBlock = toolsRaw.slice(toolDescIdx, toolDescIdx + 2000);

      for (const field of fields) {
        // Check field is mentioned in the description
        if (!descBlock.includes(field)) {
          fail(`Description drift: "${tool}" description in tools.ts does not mention field "${field}"`);
          fieldDriftErrors++;
        }
        // Check field is asserted in the test file
        if (!testFile || !testFile.includes(field)) {
          fail(`Description drift: "${tool}" field "${field}" not found in ${testName} assertions`);
          fieldDriftErrors++;
        }
      }
    }

    if (fieldDriftErrors === 0) {
      ok(`Description-vs-implementation drift: all composite tool response fields verified in tests`);
    }
  } else {
    if (!compositeTest) {
      console.warn("⚠️  tools-composite.test.ts not found — description drift check skipped");
    }
  }
}

// --- Check: Error catalogue total count in REFERENCE.md ---
//
// Verify the stated total in the error catalogue summary matches the actual row count.

if (AGENTS_ROOT_PRESENT) {
  const refContent = readFile(join(AGENTS_ROOT, "REFERENCE.md"));
  if (refContent) {
    // Extract the stated total from the summary line (e.g., "52 push_tx errors + 1 PENDING status + 21 RPC-level + 5 client/MCP-layer = 79 entries")
    const totalMatch = refContent.match(/=\s*(\d+)\s*entries/);
    if (totalMatch) {
      const statedTotal = parseInt(totalMatch[1], 10);
      // Count actual table rows in the Error Catalogue section
      const catalogueSection = refContent.split("## Error Catalogue")[1] || "";
      const tableRows = catalogueSection.split("\n").filter(l =>
        l.startsWith("|") && !l.startsWith("|---") && !l.startsWith("| Code") && !l.startsWith("| Status") && !l.startsWith("| Error") && !l.startsWith("| RPC") && l.trim() !== "|"
      );
      if (Math.abs(tableRows.length - statedTotal) > 1) {
        fail(`REFERENCE.md error catalogue: stated ${statedTotal} entries but counted ${tableRows.length} table rows`);
      } else {
        ok(`REFERENCE.md error catalogue total (${statedTotal}) matches row count (${tableRows.length})`);
      }
    }
  }
}

// --- Check: Coinset-only claim registry ---
//
// Assert that the "Coinset-hosted-node extension" phrase appears ONLY in the
// descriptions of the 3 tools that actually use Coinset-extended RPCs.

if (toolsRaw) {
  // The three Coinset-only tools (from README compatibility table):
  const COINSET_ONLY_TOOLS = new Set([
    "get_puzzle_and_solution_with_conditions",
    "get_coin_records_by_hints",
    "get_memos_by_coin_name",
  ]);

  // Find all tool registrations and check which ones contain Coinset-only claims
  const toolRegex = /server\.tool\(\s*"([^"]+)",\s*"([^"]*(?:Coinset[^"]*|coinset[^"]*)?)"/gs;
  const coinsetClaimRegex = /Coinset-hosted-node extension|Coinset-only/i;
  let coinsetClaimErrors = 0;
  let toolMatch;

  // Simpler approach: find all server.tool( calls, extract name and description
  const toolBlocks = toolsRaw.split(/server\.tool\(/);
  for (let i = 1; i < toolBlocks.length; i++) {
    const block = toolBlocks[i];
    // Extract tool name (first quoted string)
    const nameMatch = block.match(/^\s*"([^"]+)"/);
    if (!nameMatch) continue;
    const toolName = nameMatch[1];

    // Get the description (up to the first z. schema or { readOnlyHint)
    const descEnd = block.search(/\{\s*\n|z\.\w+\(/);
    const descBlock = descEnd > 0 ? block.slice(0, descEnd) : block.slice(0, 2000);

    const hasCoinsetClaim = coinsetClaimRegex.test(descBlock);

    if (hasCoinsetClaim && !COINSET_ONLY_TOOLS.has(toolName)) {
      fail(`Coinset-only claim in "${toolName}" description, but tool is NOT a Coinset extension (expected only in: ${[...COINSET_ONLY_TOOLS].join(", ")})`);
      coinsetClaimErrors++;
    }
  }

  // Also verify the 3 Coinset-only tools DO have the claim
  for (const toolName of COINSET_ONLY_TOOLS) {
    const idx = toolsRaw.indexOf(`"${toolName}"`);
    if (idx === -1) {
      fail(`Coinset-only tool "${toolName}" not found in tools.ts`);
      coinsetClaimErrors++;
      continue;
    }
    const descBlock = toolsRaw.slice(idx, idx + 2000);
    if (!coinsetClaimRegex.test(descBlock)) {
      fail(`Coinset-only tool "${toolName}" missing Coinset-hosted-node extension claim in description`);
      coinsetClaimErrors++;
    }
  }

  if (coinsetClaimErrors === 0) {
    ok(`Coinset-only claim registry: claims appear only in the ${COINSET_ONLY_TOOLS.size} Coinset-extension tools`);
  }
}

// --- Check: Embedded guide distinguishing-term check ---
//
// For key LLM mistakes, verify that resources.ts contains the distinguishing
// term from the corresponding coin-model.md item.

if (resourcesContent) {
  const DISTINGUISHING_TERMS = [
    { mistake: 17, term: "spent_block_index", description: "coin record spent field" },
    { mistake: 16, term: "odd", description: "singleton odd amount" },
    { mistake: 21, term: "fee-per-cost", altTerm: "fee_per_cost", description: "mempool fee ordering" },
    { mistake: 30, term: "superset", description: "RBF superset rule" },
  ];

  let termErrors = 0;
  for (const { mistake, term, altTerm, description } of DISTINGUISHING_TERMS) {
    const hasTerm = resourcesContent.includes(term) || (altTerm && resourcesContent.includes(altTerm));
    if (!hasTerm) {
      fail(`resources.ts missing distinguishing term "${term}" for LLM mistake #${mistake} (${description})`);
      termErrors++;
    }
  }

  if (termErrors === 0) {
    ok(`Embedded guide distinguishing-term check: all ${DISTINGUISHING_TERMS.length} key terms present in resources.ts`);
  }
}

// --- Check: Doc↔CI consistency (every network in ci.yml must be mentioned in TESTING.md) ---

{
  const ciPath = join(ROOT, ".github", "workflows", "ci.yml");
  const testingPath = join(ROOT, "TESTING.md");
  const ciContent = readFileOptional(ciPath);
  const testingContent = readFileOptional(testingPath);

  if (ciContent && testingContent) {
    // Extract network names from CI job step names (e.g., "Run on-chain tests (testnet11)")
    const ciNetworks = new Set();
    const networkMatches = ciContent.matchAll(/CHIA_NETWORK=(\w+)/g);
    for (const m of networkMatches) {
      ciNetworks.add(m[1]);
    }

    let ciDocErrors = 0;
    for (const network of ciNetworks) {
      if (!testingContent.includes(network)) {
        fail(`ci.yml references network "${network}" but TESTING.md does not mention it`);
        ciDocErrors++;
      }
    }
    if (ciDocErrors === 0) {
      ok(`Doc↔CI consistency: all ${ciNetworks.size} networks in ci.yml are documented in TESTING.md`);
    }
  }
}

// --- Check: Balance warning placement (get_address_balance bug) ---

if (AGENTS_ROOT_PRESENT) {
  const BALANCE_WARNING_FILES = [
    [join(AGENTS_ROOT, "AGENTS.md"), "AGENTS.md"],
    [join(AGENTS_ROOT, "README.md"), "README.md"],
    [join(AGENTS_ROOT, "SECURITY.md"), "SECURITY.md"],
    [join(AGENTS_ROOT, "llms.txt"), "llms.txt"],
    [join(AGENTS_ROOT, "blog-post.md"), "blog-post.md"],
  ];

  const BALANCE_WARNING_MARKERS = ["get_address_balance", "incorrect XCH totals"];

  let balanceWarningErrors = 0;
  for (const [filePath, name] of BALANCE_WARNING_FILES) {
    const content = name === "blog-post.md" ? readFileOptional(filePath) : readFile(filePath);
    if (!content) continue;
    const hasMarker = BALANCE_WARNING_MARKERS.some(marker => content.includes(marker));
    if (!hasMarker) {
      fail(`${name}: missing get_address_balance bug warning (expected one of: ${BALANCE_WARNING_MARKERS.join(", ")})`);
      balanceWarningErrors++;
    }
  }
  if (balanceWarningErrors === 0) {
    ok(`Balance warning placement: get_address_balance bug documented in all ${BALANCE_WARNING_FILES.length} required files`);
  }
}

// --- Check: Prompt count consistency ---
//
// Verify that the expected number of prompts are registered in prompts.ts
// and that README.md documents them.

{
  const promptsPath = join(ROOT, "src", "prompts.ts");
  const promptsContent = readFileOptional(promptsPath);
  const readmeContent2 = readFile(join(ROOT, "README.md"));

  if (promptsContent) {
    const promptCount = (promptsContent.match(/server\.prompt\(/g) || []).length;
    const expectedPromptCount = 9;

    if (promptCount !== expectedPromptCount) {
      fail(`prompts.ts registers ${promptCount} prompts, expected ${expectedPromptCount} — update the count and README`);
    } else {
      ok(`Prompt count: ${promptCount} prompts registered in prompts.ts`);
    }

    // Verify README mentions the prompts section
    if (readmeContent2) {
      if (!readmeContent2.includes("## Prompts")) {
        fail("README.md missing ## Prompts section — prompts are undocumented");
      } else {
        // Count prompt names mentioned in README
        const promptNames = ["network_status", "address_balance", "coin_lookup", "trace_lineage",
          "block_summary", "transaction_status", "offer_safety", "token_verification", "fee_selection"];
        let missingPrompts = 0;
        for (const name of promptNames) {
          if (!readmeContent2.includes(name)) {
            fail(`README.md Prompts section missing prompt: ${name}`);
            missingPrompts++;
          }
        }
        if (missingPrompts === 0) {
          ok(`README.md documents all ${promptNames.length} prompts`);
        }
      }
    }
  }
}

// --- Check: Coinset error code divergence documented in REFERENCE.md ---
//
// REFERENCE.md must mention that Coinset returns different error codes for
// get_puzzle_and_solution (PUZZLE_SOLUTION_FAILED instead of INVALID_HEIGHT_FOR_COIN).

if (AGENTS_ROOT_PRESENT) {
  const refContent2 = readFile(join(AGENTS_ROOT, "REFERENCE.md"));
  if (refContent2) {
    const hasCoinsetNote = refContent2.includes("Coinset") &&
      refContent2.includes("PUZZLE_SOLUTION_FAILED") &&
      refContent2.includes("INVALID_HEIGHT_FOR_COIN");
    if (!hasCoinsetNote) {
      fail("REFERENCE.md error catalogue missing Coinset error code divergence note (INVALID_HEIGHT_FOR_COIN vs PUZZLE_SOLUTION_FAILED)");
    } else {
      ok("REFERENCE.md documents Coinset error code divergence (INVALID_HEIGHT_FOR_COIN → PUZZLE_SOLUTION_FAILED)");
    }
  }
}

// --- Summary ---

console.log("");
if (errors > 0) {
  console.log(`❌ ${errors} drift issue(s) found. Fix before release.`);
  process.exit(1);
}

if (AGENTS_ROOT_PRESENT) {
  console.log("✅ All drift checks passed.");
} else {
  // Never report an incomplete run as a full pass. The cross-repo checks are the
  // bulk of the drift defense (opcode alignment, llms-full.txt fidelity, footer
  // dates, numeric-claim registry); saying "all checks passed" after skipping
  // them is the failure mode this script exists to prevent.
  console.log("⚠️  PARTIAL RUN — all LOCAL drift checks passed, but cross-repo checks were SKIPPED.");
  console.log(`   chia-for-agents was not found at ${AGENTS_ROOT}.`);
  console.log("   This is NOT a full drift verification. Do not release on this result.");
  console.log("   For a full run: check out chia-for-agents beside chia-mcp, or set CHIA_FOR_AGENTS_ROOT.");
  if (STRICT) {
    console.log("");
    console.log("❌ --strict was requested and cross-repo checks could not run.");
    process.exit(1);
  }
}
