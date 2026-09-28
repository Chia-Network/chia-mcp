#!/usr/bin/env node
/**
 * check-upstream-drift.js — Upstream drift detection for chia-mcp / chia-for-agents.
 *
 * Fetches canonical files from chia-blockchain@main on GitHub and compares them
 * against the project's claims. Runs as a nightly CI job and fails when upstream
 * changes haven't been reflected.
 *
 * Checks:
 *  1. Condition opcodes drift — chia/types/condition_opcodes.py vs constants.json
 *  2. Error enum drift       — chia/util/errors.py vs REFERENCE.md error catalogue
 *  3. Consensus constants    — chia/consensus/default_constants.py vs constants.json
 *  4. Puzzle mod hashes      — chia_puzzles_py programs.py (via PyPI) vs constants.json
 *  5. AGENTS.md preamble     — upstream AGENTS.md vs chia-blockchain-AGENTS-new.md
 *
 * Run: node scripts/check-upstream-drift.js
 *      CHIA_FOR_AGENTS_ROOT=/path/to/chia-for-agents node scripts/check-upstream-drift.js
 * Exit 0 = all checks pass. Exit 1 = drift detected (details printed).
 *
 * Network failures produce warnings, not failures — upstream being unreachable
 * should not block CI for non-upstream reasons.
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { inflateRawSync } from "zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// Support env var override (for CI dual-checkout) or fall back to sibling directory
const AGENTS_ROOT = process.env.CHIA_FOR_AGENTS_ROOT
  ? process.env.CHIA_FOR_AGENTS_ROOT
  : join(ROOT, "..", "chia-for-agents");
const AGENTS_ROOT_PRESENT = existsSync(AGENTS_ROOT);

if (!AGENTS_ROOT_PRESENT) {
  console.error(`❌ FATAL: chia-for-agents not found at ${AGENTS_ROOT}`);
  console.error("   Set CHIA_FOR_AGENTS_ROOT=/path/to/chia-for-agents");
  process.exit(1);
}

const UPSTREAM_BASE = "https://raw.githubusercontent.com/Chia-Network/chia-blockchain/main/";

let errors = 0;
let networkWarnings = 0;

function fail(msg) {
  console.error(`❌ DRIFT: ${msg}`);
  errors++;
}

function ok(msg) {
  console.log(`✅ ${msg}`);
}

function warn(msg) {
  console.warn(`⚠️  SKIP: ${msg}`);
  networkWarnings++;
}

function readLocalFile(path) {
  if (!existsSync(path)) {
    fail(`File not found: ${path}`);
    return null;
  }
  return readFileSync(path, "utf8");
}

/**
 * Fetch a URL and return the response body as text.
 * Returns null on network failure (emits a warning, does NOT increment errors).
 */
async function fetchText(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      warn(`HTTP ${res.status} fetching ${url} — upstream check skipped`);
      return null;
    }
    return await res.text();
  } catch (err) {
    warn(`Network error fetching ${url}: ${err.message} — upstream check skipped`);
    return null;
  }
}

/**
 * Fetch a URL and return the response body as a Buffer.
 * Returns null on network failure (emits a warning).
 */
async function fetchBytes(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      warn(`HTTP ${res.status} fetching ${url} — upstream check skipped`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    warn(`Network error fetching ${url}: ${err.message} — upstream check skipped`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Minimal ZIP reader — no external deps
// ---------------------------------------------------------------------------
// Handles stored (method 0) and deflated (method 8) entries using Node's
// built-in zlib.inflateRawSync.

/**
 * Extract a named file from a ZIP buffer.
 * @param {Buffer} buf  — the ZIP file bytes
 * @param {string} target  — the path to extract (e.g. "pkg/programs.py")
 * @returns {string|null} — UTF-8 string content, or null if not found
 */
function extractFileFromZip(buf, target) {
  const SIG_LOCAL = 0x04034b50;
  let offset = 0;

  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== SIG_LOCAL) {
      // Scan forward to next local file header signature
      const next = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }

    const compression   = buf.readUInt16LE(offset + 8);
    const compressedSz  = buf.readUInt32LE(offset + 18);
    const fileNameLen   = buf.readUInt16LE(offset + 26);
    const extraLen      = buf.readUInt16LE(offset + 28);

    const fileName = buf.slice(offset + 30, offset + 30 + fileNameLen).toString("utf8");
    const dataStart = offset + 30 + fileNameLen + extraLen;
    const compressedData = buf.slice(dataStart, dataStart + compressedSz);

    if (fileName === target) {
      if (compression === 0) {
        return compressedData.toString("utf8");
      } else if (compression === 8) {
        return inflateRawSync(compressedData).toString("utf8");
      } else {
        throw new Error(`Unsupported ZIP compression method ${compression} for ${fileName}`);
      }
    }

    offset = dataStart + compressedSz;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Check 1: Condition opcodes drift
// ---------------------------------------------------------------------------
// Fetch chia/types/condition_opcodes.py and parse the ConditionOpcode enum.
// Compare against constants.json condition_opcodes (name -> hex string "0xNN").
// ---------------------------------------------------------------------------

async function checkConditionOpcodes() {
  console.log("\n--- Check 1: Condition opcodes drift ---");

  const constantsRaw = readLocalFile(join(AGENTS_ROOT, "constants.json"));
  if (!constantsRaw) return;
  const constants = JSON.parse(constantsRaw);
  const localOpcodes = constants.condition_opcodes; // name -> "0xNN"

  if (!localOpcodes || typeof localOpcodes !== "object") {
    fail("constants.json missing condition_opcodes object");
    return;
  }

  const pySource = await fetchText(UPSTREAM_BASE + "chia/types/condition_opcodes.py");
  if (pySource === null) return; // network failure — already warned

  // Parse the enum: lines like "    NAME = bytes([NN])"
  const upstreamOpcodes = {}; // name -> hex string "0xNN"
  const lineRe = /^\s{4}([A-Z_][A-Z0-9_]*)\s*=\s*bytes\(\[(\d+)\]\)/gm;
  let m;
  while ((m = lineRe.exec(pySource)) !== null) {
    const [, name, decimal] = m;
    upstreamOpcodes[name] = "0x" + parseInt(decimal, 10).toString(16).padStart(2, "0");
  }

  if (Object.keys(upstreamOpcodes).length === 0) {
    fail("Could not parse any opcodes from upstream condition_opcodes.py — format may have changed");
    return;
  }

  let driftCount = 0;

  // Entries in upstream but missing or mismatched in constants.json
  for (const [name, hex] of Object.entries(upstreamOpcodes)) {
    if (!(name in localOpcodes)) {
      fail(`Opcode ${name} (${hex}) in upstream condition_opcodes.py but missing from constants.json — add it`);
      driftCount++;
    } else if (localOpcodes[name] !== hex) {
      fail(`Opcode ${name} value mismatch: upstream=${hex}, constants.json=${localOpcodes[name]}`);
      driftCount++;
    }
  }

  // Entries in constants.json but not in upstream
  for (const name of Object.keys(localOpcodes)) {
    if (!(name in upstreamOpcodes)) {
      fail(`Opcode ${name} is in constants.json but not in upstream condition_opcodes.py — remove or verify source`);
      driftCount++;
    }
  }

  if (driftCount === 0) {
    ok(`Condition opcodes: all ${Object.keys(upstreamOpcodes).length} opcodes match between upstream and constants.json`);
  }
}

// ---------------------------------------------------------------------------
// Check 2: Error enum drift
// ---------------------------------------------------------------------------
// Fetch chia/util/errors.py and parse the Err enum members + values.
// Fail if any NEW Err member appears that is not accounted for — either:
//   (a) mentioned by name in REFERENCE.md, OR
//   (b) listed in scripts/upstream-err-exclusions.json (intentional exclusion)
//
// This catches new upstream additions that haven't been reviewed.
// Output: "New upstream Err codes not in catalogue: TIMEOUT(152), ..."
// ---------------------------------------------------------------------------

async function checkErrorEnum() {
  console.log("\n--- Check 2: Error enum drift ---");

  const refContent = readLocalFile(join(AGENTS_ROOT, "REFERENCE.md"));
  if (!refContent) return;

  // Load the explicit exclusion list (block-validation / networking errors
  // that are intentionally not documented in REFERENCE.md)
  const exclusionPath = join(AGENTS_ROOT, "scripts", "upstream-err-exclusions.json");
  let excludedNames = new Set();
  if (existsSync(exclusionPath)) {
    try {
      const excData = JSON.parse(readFileSync(exclusionPath, "utf8"));
      excludedNames = new Set(Object.keys(excData.excluded ?? {}));
    } catch (err) {
      warn(`Could not parse upstream-err-exclusions.json: ${err.message} — exclusions not applied`);
    }
  } else {
    warn(`upstream-err-exclusions.json not found at ${exclusionPath} — exclusions not applied`);
  }

  const pySource = await fetchText(UPSTREAM_BASE + "chia/util/errors.py");
  if (pySource === null) return;

  // Parse: lines like "    NAME = -1" or "    NAME = 42"
  const upstreamErrors = {}; // name -> numeric value
  const lineRe = /^\s{4}([A-Z_][A-Z0-9_]*)\s*=\s*(-?\d+)/gm;
  let m;
  while ((m = lineRe.exec(pySource)) !== null) {
    upstreamErrors[m[1]] = parseInt(m[2], 10);
  }

  if (Object.keys(upstreamErrors).length === 0) {
    fail("Could not parse any Err members from upstream errors.py — format may have changed");
    return;
  }

  // Find members that are neither in REFERENCE.md nor in the exclusion list
  const newUndocumented = [];
  for (const [name, value] of Object.entries(upstreamErrors)) {
    const inRef = refContent.includes(name);
    const excluded = excludedNames.has(name);
    if (!inRef && !excluded) {
      newUndocumented.push(`${name}(${value})`);
    }
  }

  if (newUndocumented.length > 0) {
    fail(
      `New upstream Err codes not in catalogue: ${newUndocumented.join(", ")}` +
      ` — add to REFERENCE.md error catalogue or add to scripts/upstream-err-exclusions.json`
    );
  } else {
    const docCount = Object.keys(upstreamErrors).length - excludedNames.size;
    ok(
      `Error enum: all ${Object.keys(upstreamErrors).length} upstream Err members accounted for ` +
      `(${docCount} in REFERENCE.md, ${excludedNames.size} explicitly excluded)`
    );
  }
}

// ---------------------------------------------------------------------------
// Check 3: Consensus constants drift
// ---------------------------------------------------------------------------
// Fetch chia/consensus/default_constants.py and extract key constants.
// Compare against constants.json values.
// ---------------------------------------------------------------------------

async function checkConsensusConstants() {
  console.log("\n--- Check 3: Consensus constants drift ---");

  const constantsRaw = readLocalFile(join(AGENTS_ROOT, "constants.json"));
  if (!constantsRaw) return;
  const constants = JSON.parse(constantsRaw);

  const pySource = await fetchText(UPSTREAM_BASE + "chia/consensus/default_constants.py");
  if (pySource === null) return;

  // Map of: upstreamConstantName -> localKey in constants.json
  const CONSTANTS_TO_CHECK = [
    { upstreamName: "MAX_BLOCK_COST_CLVM",  localKey: "max_block_cost_clvm"  },
    { upstreamName: "SLOT_BLOCKS_TARGET",   localKey: "slot_blocks_target"   },
    { upstreamName: "SUB_SLOT_TIME_TARGET", localKey: "sub_slot_time_target" },
    { upstreamName: "MEMPOOL_BLOCK_BUFFER", localKey: "mempool_block_buffer" },
  ];

  let driftCount = 0;

  for (const { upstreamName, localKey } of CONSTANTS_TO_CHECK) {
    // Match: NAME=uint8(123), NAME=uint64(11000000000), etc.
    const pattern = new RegExp(`${upstreamName}\\s*=\\s*uint\\d+\\((\\d+)\\)`);
    const match = pySource.match(pattern);

    if (!match) {
      warn(`Could not find ${upstreamName} in upstream default_constants.py — format may have changed`);
      continue;
    }

    const upstreamValue = parseInt(match[1], 10);
    const localValue = constants[localKey];

    if (localValue === undefined) {
      fail(`constants.json missing key "${localKey}" — upstream ${upstreamName}=${upstreamValue}`);
      driftCount++;
    } else if (localValue !== upstreamValue) {
      fail(
        `Consensus constant mismatch: ${upstreamName}\n` +
        `   upstream default_constants.py: ${upstreamValue}\n` +
        `   constants.json["${localKey}"]: ${localValue}`
      );
      driftCount++;
    }
  }

  if (driftCount === 0) {
    ok(`Consensus constants: all ${CONSTANTS_TO_CHECK.length} constants match upstream default_constants.py`);
  }
}

// ---------------------------------------------------------------------------
// Check 4: Puzzle mod hashes drift
// ---------------------------------------------------------------------------
// Fetch the chia_puzzles_py programs.py from PyPI (latest release as a .whl)
// and parse the _HASH constants. Compare against constants.json puzzle_mod_hashes.
// ---------------------------------------------------------------------------

async function checkPuzzleModHashes() {
  console.log("\n--- Check 4: Puzzle mod hashes drift ---");

  const constantsRaw = readLocalFile(join(AGENTS_ROOT, "constants.json"));
  if (!constantsRaw) return;
  const constants = JSON.parse(constantsRaw);

  const localHashes = constants.puzzle_mod_hashes;
  if (!localHashes || typeof localHashes !== "object") {
    fail("constants.json missing puzzle_mod_hashes object");
    return;
  }

  // Get latest version + wheel URL from PyPI
  const pypiText = await fetchText("https://pypi.org/pypi/chia_puzzles_py/json");
  if (pypiText === null) return;

  let pypiData;
  try {
    pypiData = JSON.parse(pypiText);
  } catch {
    warn("Could not parse PyPI metadata for chia_puzzles_py — puzzle hash check skipped");
    return;
  }

  const latestVersion = pypiData?.info?.version;
  if (!latestVersion) {
    warn("Could not determine latest chia_puzzles_py version from PyPI — puzzle hash check skipped");
    return;
  }

  // Find py3-none-any wheel URL
  const urlEntries = pypiData?.urls ?? [];
  const wheelEntry = urlEntries.find(
    (r) => typeof r.filename === "string" &&
           r.filename.endsWith(".whl") &&
           r.filename.includes("py3-none-any")
  );

  if (!wheelEntry) {
    warn(`No py3-none-any wheel found for chia_puzzles_py ${latestVersion} — puzzle hash check skipped`);
    return;
  }

  const wheelBuf = await fetchBytes(wheelEntry.url);
  if (wheelBuf === null) return;

  // Extract programs.py from the wheel (which is a ZIP file)
  let programsPy;
  try {
    programsPy = extractFileFromZip(wheelBuf, "chia_puzzles_py/programs.py");
  } catch (err) {
    warn(`Could not extract programs.py from chia_puzzles_py wheel: ${err.message} — puzzle hash check skipped`);
    return;
  }

  if (!programsPy) {
    warn("chia_puzzles_py/programs.py not found in wheel — puzzle hash check skipped");
    return;
  }

  // Parse _HASH constants: NAME_HASH = bytes.fromhex(\n    "hex"\n) or single-line
  const hashPattern = /([A-Z][A-Z0-9_]*_HASH)\s*=\s*bytes\.fromhex\(\s*["']([0-9a-f]+)["']\s*\)/g;
  const upstreamHashes = {}; // NAME_HASH -> hex string (no 0x prefix)
  let hm;
  while ((hm = hashPattern.exec(programsPy)) !== null) {
    upstreamHashes[hm[1]] = hm[2];
  }

  if (Object.keys(upstreamHashes).length === 0) {
    warn("Could not parse any hashes from chia_puzzles_py/programs.py — format may have changed");
    return;
  }

  // Map constants.json puzzle_mod_hashes keys -> programs.py constant names
  const KEY_MAP = {
    p2_delegated_puzzle_or_hidden_puzzle: "P2_DELEGATED_PUZZLE_OR_HIDDEN_PUZZLE_HASH",
    cat_v2:                               "CAT_PUZZLE_HASH",
    singleton_top_layer_v1_1:             "SINGLETON_TOP_LAYER_V1_1_HASH",
    nft_state_layer:                      "NFT_STATE_LAYER_HASH",
    settlement_payments:                  "SETTLEMENT_PAYMENT_HASH",
  };

  let driftCount = 0;

  for (const [localKey, upstreamKey] of Object.entries(KEY_MAP)) {
    if (!(localKey in localHashes)) {
      fail(`constants.json puzzle_mod_hashes missing key "${localKey}"`);
      driftCount++;
      continue;
    }

    const localHashRaw = localHashes[localKey];
    // Normalize: strip leading "0x" if present
    const localHex = String(localHashRaw).replace(/^0x/, "").toLowerCase();

    const upstreamHex = upstreamHashes[upstreamKey]?.toLowerCase();
    if (!upstreamHex) {
      warn(`Upstream programs.py does not define ${upstreamKey} — skipping this hash`);
      continue;
    }

    if (localHex !== upstreamHex) {
      fail(
        `Puzzle mod hash changed for "${localKey}" (${upstreamKey}):\n` +
        `   constants.json:           0x${localHex}\n` +
        `   upstream chia_puzzles_py: 0x${upstreamHex}\n` +
        `   (chia_puzzles_py version: ${latestVersion})`
      );
      driftCount++;
    }
  }

  if (driftCount === 0) {
    ok(
      `Puzzle mod hashes: all ${Object.keys(KEY_MAP).length} hashes match ` +
      `upstream chia_puzzles_py ${latestVersion}`
    );
  }
}

// ---------------------------------------------------------------------------
// Check 5: AGENTS.md preamble preservation
// ---------------------------------------------------------------------------
// Fetch AGENTS.md from chia-blockchain@main.
// The first N lines of chia-blockchain-AGENTS-new.md must match the upstream
// preamble byte-for-byte (the supplement must preserve the original preamble).
// ---------------------------------------------------------------------------

async function checkAgentsPreamble() {
  console.log("\n--- Check 5: AGENTS.md preamble preservation ---");

  const supplementContent = readLocalFile(join(AGENTS_ROOT, "chia-blockchain-AGENTS-new.md"));
  if (!supplementContent) return;

  const upstreamContent = await fetchText(UPSTREAM_BASE + "AGENTS.md");
  if (upstreamContent === null) return;

  const upstreamLines = upstreamContent.split("\n");
  const supplementLines = supplementContent.split("\n");

  // Compare the first N non-empty upstream lines.
  // We use the full upstream content length, capped at 20 lines to avoid
  // false-positiving on intentional additions to the supplement after the preamble.
  const PREAMBLE_LINE_COUNT = Math.min(upstreamLines.length, 20);

  let mismatchLine = -1;
  for (let i = 0; i < PREAMBLE_LINE_COUNT; i++) {
    if (supplementLines[i] !== upstreamLines[i]) {
      mismatchLine = i;
      break;
    }
  }

  if (mismatchLine !== -1) {
    fail(
      `AGENTS.md preamble diverges at line ${mismatchLine + 1}:\n` +
      `   upstream:   ${JSON.stringify(upstreamLines[mismatchLine])}\n` +
      `   supplement: ${JSON.stringify(supplementLines[mismatchLine] ?? "(missing)")}\n` +
      `   chia-blockchain-AGENTS-new.md must preserve the upstream preamble byte-for-byte.`
    );
  } else {
    ok(
      `AGENTS.md preamble: first ${PREAMBLE_LINE_COUNT} lines of chia-blockchain-AGENTS-new.md ` +
      `match upstream AGENTS.md byte-for-byte`
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("🔍 Upstream drift detection (chia-blockchain@main)\n");
  console.log(`   chia-for-agents root: ${AGENTS_ROOT}`);
  console.log(`   upstream base:        ${UPSTREAM_BASE}`);

  await checkConditionOpcodes();
  await checkErrorEnum();
  await checkConsensusConstants();
  await checkPuzzleModHashes();
  await checkAgentsPreamble();

  console.log("");

  if (networkWarnings > 0) {
    console.warn(`⚠️  ${networkWarnings} upstream check(s) skipped due to network/parse issues.`);
    console.warn("   Network failures do not cause exit-1 — check connectivity for full coverage.");
  }

  if (errors > 0) {
    console.error(`\n❌ ${errors} upstream drift issue(s) found. Update chia-for-agents to match upstream.`);
    process.exit(1);
  }

  const qualifier = networkWarnings > 0 ? "reachable " : "";
  console.log(`✅ All ${qualifier}upstream drift checks passed.`);
}

main().catch((err) => {
  console.error("Fatal error in upstream drift check:", err);
  process.exit(1);
});
