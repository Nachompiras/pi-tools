/**
 * Pokémon Buddy — Native macOS overlay with PMD Collab sprites
 *
 * Uses https://sprites.pmdcollab.org/ for animated sprite sheets
 * with proper walk/idle/hurt/hop/sleep animations per mood.
 *
 * Commands:
 *   /pokemon             — add a random Pokémon (5% shiny chance)
 *   /pokemon charmander  — add a specific Pokémon
 *   /pokemon shiny       — force shiny random
 *   /pokemon shiny eevee — force shiny specific
 *   /pokemon walk        — all roam free
 *   /pokemon stay        — lineup mode
 *   /pokemon on          — enable auto-start (spawns on every new console)
 *   /pokemon off         — disable auto-start & dismiss all
 *   /pokemon dismiss     — dismiss all (keeps auto-start setting)
 *   /pokemon pop         — remove yours
 *   /pokemon list        — show suggestions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { spawn, type ChildProcess, execSync } from "node:child_process";
import { existsSync, statSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const SWIFT_SOURCE = join(EXTENSION_DIR, "PokemonOverlay.swift");
const SWIFT_BINARY = join(EXTENSION_DIR, ".build", "PokemonOverlay");
const SPRITES_DIR = join(EXTENSION_DIR, "sprites");
const POKEMON_DATA_DIR = join(homedir(), ".pokemon-buddy");
const SLOTS_DIR = join(POKEMON_DATA_DIR, "slots");
const CONFIG_FILE = join(POKEMON_DATA_DIR, "config.json");
const LOCK_TIMEOUT_MS = 5000; // max wait for slot lock

// ── Persistent config ───────────────────────────────────────────────

interface PokemonConfig {
  autoStart: boolean;
  lastPokemon?: string;  // remember last chosen name
  lastShiny?: boolean;
}

function loadConfig(): PokemonConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch {}
  return { autoStart: false };
}

function saveConfig(config: PokemonConfig) {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

const RANDOM_POOL = [
  "pikachu", "charmander", "bulbasaur", "squirtle", "eevee",
  "snorlax", "gengar", "mewtwo", "jigglypuff", "togepi",
  "mudkip", "torchic", "treecko", "lucario", "gardevoir",
  "charizard", "blastoise", "venusaur", "mew", "celebi",
  "psyduck", "magikarp", "dragonite", "umbreon", "espeon",
  "cyndaquil", "totodile", "chikorita", "piplup", "chimchar",
  "turtwig", "zorua", "riolu", "growlithe", "vulpix",
  "abra", "geodude", "machop", "gastly", "ditto",
];

function randomPokemon(): string {
  return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)];
}

const SLOT_WIDTH = 70;
const LINEUP_START_X = -40;
const SHINY_CHANCE = 1 / 20;

const GQL_ENDPOINT = "https://spriteserver.pmdcollab.org/graphql";

// ── PMD Collab GraphQL API ──────────────────────────────────────────

interface PMDForm {
  fullPath: string;
  name: string;
  isShiny: boolean;
  sprites: {
    animDataXml: string | null;
    actions: Array<{
      action: string;
      animUrl?: string;
      copyOf?: string;
    }>;
  };
}

interface PMDMonster {
  id: number;
  rawId: string;
  name: string;
  forms: PMDForm[];
}

async function searchPokemon(name: string): Promise<PMDMonster | null> {
  try {
    const res = await fetch(GQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `{
          searchMonster(monsterName: "${name}") {
            id, rawId, name,
            forms {
              fullPath, name, isShiny,
              sprites {
                animDataXml,
                actions {
                  ... on Sprite { action, animUrl }
                  ... on CopyOf { action, copyOf }
                }
              }
            }
          }
        }`,
      }),
    });
    const data = await res.json() as any;
    const results = data?.data?.searchMonster;
    if (!results || results.length === 0) return null;
    // Exact match first, then first result
    return results.find((m: PMDMonster) => m.name.toLowerCase() === name.toLowerCase()) || results[0];
  } catch {
    return null;
  }
}

function getForm(monster: PMDMonster, shiny: boolean): PMDForm | null {
  // Get the base form (path = rawId) or shiny variant
  const base = monster.forms.find((f) => f.fullPath === monster.rawId && !f.isShiny);
  if (!shiny) return base ?? null;
  // Shiny = fullPath like "0025/0000/0001"
  const shinyForm = monster.forms.find((f) => f.isShiny && f.sprites.actions.length > 0);
  return shinyForm ?? null;
}

// Actions we care about, mapped to moods
const MOOD_ACTIONS: Record<string, string[]> = {
  walk: ["Walk", "Idle"],
  idle: ["Sleep", "Idle"],          // resting when nothing happening
  happy: ["Hop", "Idle"],           // prompt done ✨
  sad: ["Pain", "Hurt", "Idle"],    // error 💧
  confused: ["Idle"],               // question pending ❓
  working: ["Attack", "Walk"],      // processing ⚙️
};

// ── Download sprite sheets + AnimData.xml ───────────────────────────

async function ensureSprites(monster: PMDMonster, form: PMDForm): Promise<string | null> {
  const dir = join(SPRITES_DIR, form.fullPath.replace(/\//g, "_"));
  mkdirSync(dir, { recursive: true });

  // Check if already downloaded
  const markerFile = join(dir, ".done");
  if (existsSync(markerFile)) return dir;

  try {
    // Download AnimData.xml (animDataXml field is a URL, not the content)
    const xmlUrl = form.sprites.animDataXml
      || `https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master/sprite/${form.fullPath}/AnimData.xml`;
    const xmlRes = await fetch(xmlUrl);
    if (xmlRes.ok) {
      await writeFile(join(dir, "AnimData.xml"), await xmlRes.text());
    }

    // Download action sprite sheets
    const needed = new Set<string>();
    for (const actions of Object.values(MOOD_ACTIONS)) {
      for (const a of actions) needed.add(a);
    }
    needed.add("Walk"); needed.add("Idle"); // always need fallbacks

    for (const spriteAction of form.sprites.actions) {
      if (!spriteAction.animUrl) continue;
      if (!needed.has(spriteAction.action)) continue;
      const pngPath = join(dir, `${spriteAction.action}-Anim.png`);
      if (existsSync(pngPath)) continue;
      const res = await fetch(spriteAction.animUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        await writeFile(pngPath, buf);
      }
    }

    await writeFile(markerFile, "ok");
    return dir;
  } catch {
    return null;
  }
}

// ── Build Swift binary ──────────────────────────────────────────────

async function ensureBinary(): Promise<string> {
  mkdirSync(join(EXTENSION_DIR, ".build"), { recursive: true });
  if (existsSync(SWIFT_BINARY)) {
    const src = statSync(SWIFT_SOURCE);
    const bin = statSync(SWIFT_BINARY);
    if (bin.mtimeMs > src.mtimeMs) return SWIFT_BINARY;
  }
  return new Promise<string>((resolve, reject) => {
    const proc = spawn("swiftc", ["-O", "-framework", "AppKit", "-o", SWIFT_BINARY, SWIFT_SOURCE]);
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => code === 0 ? resolve(SWIFT_BINARY) : reject(new Error(`Build failed: ${stderr}`)));
    proc.on("error", reject);
  });
}

// ── Helpers ─────────────────────────────────────────────────────────

function send(proc: ChildProcess, type: string, value?: string) {
  if (!proc.stdin?.writable) return;
  proc.stdin.write(JSON.stringify({ type, value: value ?? null }) + "\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Slot coordination (shared across all pi instances) ──────────────

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function ensureSlotsDir() {
  mkdirSync(SLOTS_DIR, { recursive: true });
}

function cleanStaleSlots() {
  ensureSlotsDir();
  for (const f of readdirSync(SLOTS_DIR)) {
    if (!f.endsWith(".pid")) continue;
    const filePath = join(SLOTS_DIR, f);
    try {
      const content = readFileSync(filePath, "utf8").trim();
      const pid = parseInt(content);
      if (isNaN(pid) || !isProcessAlive(pid)) {
        unlinkSync(filePath);
      }
    } catch { try { unlinkSync(filePath); } catch {} }
  }
}

/** Atomic slot claim using exclusive file creation to prevent races */
function claimSlot(pid: number): number {
  ensureSlotsDir();
  cleanStaleSlots();

  // Use a lock file to prevent two instances from racing
  const lockFile = join(SLOTS_DIR, ".lock");
  const startTime = Date.now();

  // Spin-wait for lock (with timeout)
  while (true) {
    try {
      // O_EXCL: fails if file already exists → atomic lock
      const fd = require("fs").openSync(lockFile, "wx");
      require("fs").closeSync(fd);
      break;
    } catch {
      if (Date.now() - startTime > LOCK_TIMEOUT_MS) {
        // Stale lock — force remove and retry
        try { unlinkSync(lockFile); } catch {}
        continue;
      }
      // Brief sleep via busy-wait (sync context, ~10ms)
      const until = Date.now() + 10 + Math.random() * 20;
      while (Date.now() < until) {}
    }
  }

  try {
    // Re-read after acquiring lock
    cleanStaleSlots();
    const taken = new Set(
      readdirSync(SLOTS_DIR)
        .filter((f) => f.endsWith(".pid"))
        .map((f) => parseInt(f.replace(".pid", "")))
        .filter((n) => !isNaN(n))
    );
    let slot = 0;
    while (taken.has(slot)) slot++;
    writeFileSync(join(SLOTS_DIR, `${slot}.pid`), String(pid));
    return slot;
  } finally {
    try { unlinkSync(lockFile); } catch {}
  }
}

function releaseSlot(slot: number) {
  try { unlinkSync(join(SLOTS_DIR, `${slot}.pid`)); } catch {}
}

function slotX(slot: number): number {
  return LINEUP_START_X + slot * SLOT_WIDTH;
}

// ── Buddy instance ──────────────────────────────────────────────────

interface Buddy {
  name: string;
  shiny: boolean;
  spriteDir: string;
  proc: ChildProcess;
  slot: number;
}

// ── Extension ────────────────────────────────────────────────────────

export default function pokemonBuddy(pi: ExtensionAPI) {
  let buddies: Buddy[] = [];
  let mode: "static" | "walk" = "static";
  let building = false;
  let waitingForAnswer = false;
  let working = false;
  const config = loadConfig();

  function sendAll(type: string, value?: string) {
    for (const b of buddies) send(b.proc, type, value);
  }

  async function addBuddy(name: string, ctx: any, forceShiny?: boolean): Promise<boolean> {
    if (building) {
      ctx.ui.notify("Hold on, still loading...", "warning");
      return false;
    }
    building = true;
    try {
      ctx.ui.notify(`Catching ${capitalize(name)}...`, "info");

      // Search PMD Collab
      const monster = await searchPokemon(name);
      if (!monster) {
        ctx.ui.notify(`"${name}" not found!`, "warning");
        return false;
      }

      const shiny = forceShiny ?? (Math.random() < SHINY_CHANCE);
      let form = getForm(monster, shiny);
      const actualShiny = form !== null && shiny;
      if (!form) form = getForm(monster, false);
      if (!form) {
        ctx.ui.notify(`No sprites for "${name}"`, "warning");
        return false;
      }

      // Download sprites
      const spriteDir = await ensureSprites(monster, form);
      if (!spriteDir) {
        ctx.ui.notify(`Failed to download sprites for "${name}"`, "warning");
        return false;
      }

      const binary = await ensureBinary();
      const proc = spawn(binary, [spriteDir, mode, "0"], { stdio: ["pipe", "pipe", "pipe"] });

      const realPid = proc.pid ?? process.pid;
      const realSlot = claimSlot(realPid);
      const buddy: Buddy = { name: monster.name, shiny: actualShiny, spriteDir, proc, slot: realSlot };

      if (mode === "static") {
        send(proc, "position", String(slotX(realSlot)));
      }

      proc.on("close", () => {
        releaseSlot(buddy.slot);
        buddies = buddies.filter((b) => b !== buddy);
      });
      proc.on("error", (err: Error) => {
        ctx.ui.notify(`Error: ${err.message}`, "error");
        buddies = buddies.filter((b) => b !== buddy);
      });

      buddies.push(buddy);
      if (actualShiny) {
        ctx.ui.notify(`✨ A shiny ${monster.name} appeared!! ✨`, "info");
      } else {
        ctx.ui.notify(`${monster.name} joined the team!`, "info");
      }
      return true;
    } catch (err: any) {
      ctx.ui.notify(`Failed: ${err.message}`, "error");
      return false;
    } finally {
      building = false;
    }
  }

  function removeLast(ctx: any) {
    if (buddies.length === 0) { ctx.ui.notify("No Pokémon to remove", "warning"); return; }
    const buddy = buddies.pop()!;
    releaseSlot(buddy.slot);
    send(buddy.proc, "quit");
    setTimeout(() => { if (!buddy.proc.killed) buddy.proc.kill("SIGTERM"); }, 500);
    ctx.ui.notify(`${buddy.name} returned!`, "info");
  }

  function removeAll(ctx: any) {
    if (buddies.length === 0) { ctx.ui.notify("No Pokémon active", "warning"); return; }
    const count = buddies.length;
    for (const b of buddies) {
      releaseSlot(b.slot);
      send(b.proc, "quit");
      setTimeout(() => { if (!b.proc.killed) b.proc.kill("SIGTERM"); }, 500);
    }
    buddies = [];
    ctx.ui.notify(`All ${count} Pokémon returned! 👋`, "info");
  }

  // ── Command ──────────────────────────────────────────────────────

  // ── Auto-start on new console ─────────────────────────────────

  async function autoStartBuddy() {
    if (!config.autoStart) return;
    // Small delay to let the TUI initialize
    await new Promise((r) => setTimeout(r, 800));
    const name = config.lastPokemon || randomPokemon();
    const fakeCtx = {
      ui: {
        notify: (msg: string, _level: string) => {
          // silent auto-start — no notifications on spawn
        },
      },
    };
    await addBuddy(name, fakeCtx, config.lastShiny);
  }

  autoStartBuddy();

  pi.registerCommand("pokemon", {
    description: "Pokémon buddy! /pokemon [name|shiny|on|off|dismiss|walk|stay|pop|list]",
    handler: async (args, ctx) => {
      const arg = (args || "").trim().toLowerCase();

      // /pokemon on — enable auto-start
      if (arg === "on") {
        config.autoStart = true;
        saveConfig(config);
        ctx.ui.notify("🟢 Pokémon auto-start enabled! A buddy will greet you on every new console.", "info");
        if (buddies.length === 0) {
          const name = config.lastPokemon || randomPokemon();
          await addBuddy(name, ctx, config.lastShiny);
        }
        return;
      }

      // /pokemon off — disable auto-start & dismiss all
      if (arg === "off") {
        config.autoStart = false;
        saveConfig(config);
        if (buddies.length > 0) removeAll(ctx);
        ctx.ui.notify("🔴 Pokémon auto-start disabled.", "info");
        return;
      }

      if (arg === "help" || arg === "?") {
        ctx.ui.notify(
          [
            "🐾 /pokemon commands:",
            "  /pokemon              → random buddy (5% shiny)",
            "  /pokemon <name>       → specific pokémon",
            "  /pokemon shiny [name] → force shiny",
            "  /pokemon on           → auto-start on new consoles",
            "  /pokemon off          → disable auto-start & dismiss",
            "  /pokemon dismiss      → dismiss all (keeps setting)",
            "  /pokemon pop          → remove last added",
            "  /pokemon walk         → free roam mode",
            "  /pokemon stay         → lineup mode",
            "  /pokemon list         → show name suggestions",
            "  /pokemon help         → this message",
          ].join("\n"),
          "info"
        );
        return;
      }

      if (arg === "dismiss" || arg === "bye") { removeAll(ctx); return; }
      if (arg === "pop" || arg === "remove") { removeLast(ctx); return; }

      if (arg === "list") {
        ctx.ui.notify(`Some: ${RANDOM_POOL.slice(0, 20).join(", ")}... (any name works!)`, "info");
        return;
      }
      if (arg === "walk" || arg === "free") {
        mode = "walk"; sendAll("mode", "walk");
        ctx.ui.notify("Pokémon set free! 🏃", "info"); return;
      }
      if (arg === "stay" || arg === "line" || arg === "lineup") {
        mode = "static"; sendAll("mode", "static");
        for (const b of buddies) send(b.proc, "position", String(slotX(b.slot)));
        ctx.ui.notify("Pokémon lined up! 📋", "info"); return;
      }

      // /pokemon shiny [name]
      if (arg.startsWith("shiny")) {
        const shinyName = arg.split(/\s+/)[1] || randomPokemon();
        if (buddies.length > 0) {
          // Switch existing
          removeLast(ctx);
        }
        await addBuddy(shinyName, ctx, true);
        // Remember shiny choice
        config.lastPokemon = shinyName;
        config.lastShiny = true;
        if (config.autoStart) saveConfig(config);
        return;
      }

      // /pokemon [name] — one per console
      const name = arg || randomPokemon();
      if (buddies.length > 0) {
        // Switch: remove old, add new
        const oldBuddy = buddies[0];
        releaseSlot(oldBuddy.slot);
        send(oldBuddy.proc, "quit");
        setTimeout(() => { if (!oldBuddy.proc.killed) oldBuddy.proc.kill("SIGTERM"); }, 500);
        buddies = [];
      }
      await addBuddy(name, ctx);

      // Remember choice for auto-start
      config.lastPokemon = name;
      config.lastShiny = undefined;
      if (config.autoStart) saveConfig(config);
    },
  });

  // ── Event reactions ─────────────────────────────────────────────

  pi.on("agent_end", async () => {
    if (buddies.length === 0) return;
    working = false;
    if (!waitingForAnswer) {
      sendAll("mood", "happy");
      sendAll("message", "Done! ✓");
    }
  });

  pi.on("agent_start", async () => {
    if (buddies.length === 0) return;
    waitingForAnswer = false;
    working = true;
    sendAll("mood", "working");
    sendAll("message", "");
  });

  pi.on("turn_start", async () => {
    if (buddies.length === 0) return;
    if (!waitingForAnswer && working) {
      sendAll("mood", "working");
    }
  });

  pi.on("tool_execution_end", async (event) => {
    if (buddies.length === 0 || !event.isError) return;
    sendAll("mood", "sad");
    sendAll("message", "Something failed! 💥");
    working = false;
  });

  // RTK savings detection — check after bash commands
  let lastRtkCheck = 0;
  const RTK_DB = join(homedir(), "Library/Application Support/rtk/history.db");

  pi.on("tool_result", async (event) => {
    if (buddies.length === 0) return;
    if (event.toolName !== "bash") return;
    // Only check every 2 seconds max
    const now = Date.now();
    if (now - lastRtkCheck < 2000) return;
    lastRtkCheck = now;

    if (!existsSync(RTK_DB)) return;
    try {
      const row = execSync(
        `sqlite3 "${RTK_DB}" "SELECT saved_tokens, savings_pct, original_cmd FROM commands ORDER BY id DESC LIMIT 1;"`,
        { timeout: 1000 }
      ).toString().trim();
      if (!row) return;
      const [savedStr, pctStr, cmd] = row.split("|");
      const saved = parseInt(savedStr);
      const pct = parseFloat(pctStr);
      if (saved > 50 && pct > 10) {
        sendAll("message", `RTK saved ${saved} tokens (${Math.round(pct)}%) 🌟`);
      }
    } catch {}
  });

  pi.on("message_end", async (event) => {
    if (buddies.length === 0) return;
    const msg = event.message;
    if (msg.role !== "assistant") return;
    let text = "";
    if (typeof msg.content === "string") text = msg.content;
    else if (Array.isArray(msg.content)) {
      text = (msg.content as any[]).filter((c) => c.type === "text").map((c) => c.text).join(" ");
    }
    const tail = text.slice(-500).toLowerCase();
    if (tail.includes("?")) {
      waitingForAnswer = true;
      sendAll("mood", "confused");
      sendAll("message", "Answer needed! ❓");
    }
  });

  pi.on("session_shutdown", async () => {
    for (const b of buddies) {
      releaseSlot(b.slot);
      send(b.proc, "quit");
      setTimeout(() => { if (!b.proc.killed) b.proc.kill("SIGTERM"); }, 300);
    }
    buddies = [];
  });
}
