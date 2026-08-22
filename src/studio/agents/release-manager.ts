/**
 * Release Manager — versioning, release notes from the run's actual history,
 * build manifest verification, and the final go/no-go package.
 */
import { Agent } from "../core/agent.js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export class ReleaseManagerAgent extends Agent {
readonly id = "release";
  readonly title = "Release Manager";
  /**
   * Produce the release: bump version, write notes + changelog, verify the
   * built dist/ matches its manifest checksums.
   */
  release(rootDir: string): { version: string; notesPath: string; verified: boolean } {
    const board = this.ctx.board;
    const pack = board.pack!;
    const iteration = board.iteration;

    // Version: 0.major.minor-patch — minor bumps per successful sprint.
    const prev = readRepoVersion(rootDir);
    const version = `0.1.${prev.patch + 1}`;
    pack.meta.version = version;
    this.ctx.board.releaseVersion = version;

    // Persist the versioned pack so subsequent builds ship the released id.
    mkdirSync(join(rootDir, "content"), { recursive: true });
    writeFileSync(join(rootDir, "content", "pack.json"), JSON.stringify(pack, null, 2) + "\n");

    // Verify dist build integrity if present.
    let verified = false;
    const distDir = join(rootDir, "dist");
    const manifestPath = join(distDir, "build-info.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, Record<string, string>>;
      verified = verifyChecksums(distDir, manifest.files ?? {});
      this.act("dist.verified", verified ? "checksums match" : "CHECKSUM MISMATCH");
    } else {
      this.act("dist.missing", "no build-info.json — run the build phase");
    }

    const qa = board.latestQa!;
    const perf = board.latestPerf!;
    const notes = [
      `# Release ${version} — ${pack.meta.title}`,
      "",
      `Generated autonomously by AI Game Studio (run ${board.iteration} QA iterations).`,
      "",
      "## Contents",
      "",
      `- ${pack.enemies.length} enemy types across ${pack.floors.length} depths`,
      `- ${pack.items.length} items · ${pack.questTemplates.length} quest templates · ${pack.npcDefs.length} NPCs`,
      `- Procedural floors, quests, encounters; deterministic seeds`,
      "",
      "## Quality gates",
      "",
      `- QA verdict: **${qa.verdict}** (victory rate ${(qa.aggregate.victoryRate * 100).toFixed(0)}%, coverage ${(qa.aggregate.coverageFraction * 100).toFixed(0)}%)`,
      `- Performance verdict: **${perf.verdict}** (avg tick ${perf.budgets.tickAvgMs?.actual ?? "?"}ms)`,
      `- Dist checksums: ${verified ? "verified" : "not verified"}`,
      "",
    ];

    if (board.fixes.length > 0) {
      notes.push("## Fixes applied during the loop", "");
      for (const f of board.fixes) {
        notes.push(`- iter ${f.iteration} \`${f.strategy}\`: ${f.rationale}`);
      }
      notes.push("");
    }
    if (board.regressions.length > 0) {
      notes.push("## Regression pins", "");
      for (const r of board.regressions) notes.push(`- seed ${r.seed} (${r.issueId}) → ${r.testPath}`);
      notes.push("");
    }

    mkdirSync(join(rootDir, "docs", "releases"), { recursive: true });
    const notesPath = join(rootDir, "docs", "releases", `RELEASE-${version}.md`);
    writeFileSync(notesPath, notes.join("\n"));

    writeRepoVersion(rootDir, { patch: prev.patch + 1 });

    this.act("release.packaged", `${version} verified=${verified}`);
    this.artifactJson("release/release-manifest.json", {
      version,
      notesPath,
      distVerified: verified,
      qaVerdict: qa.verdict,
      perfVerdict: perf.verdict,
      fixes: board.fixes.length,
      regressions: board.regressions.length,
    });
    return { version, notesPath, verified };
  }
}

function readRepoVersion(rootDir: string): { patch: number } {
  try {
    const raw = JSON.parse(readFileSync(join(rootDir, "VERSION.json"), "utf8")) as { contentPatch?: number };
    return { patch: raw.contentPatch ?? 0 };
  } catch {
    return { patch: 0 };
  }
}

function writeRepoVersion(rootDir: string, v: { patch: number }): void {
  writeFileSync(
    join(rootDir, "VERSION.json"),
    JSON.stringify({ contentPatch: v.patch, updatedAtIso: new Date().toISOString() }, null, 2) + "\n",
  );
}

import { fnv1a } from "../../engine/core/hash.js";
function verifyChecksums(distDir: string, files: Record<string, string>): boolean {
  for (const [name, expected] of Object.entries(files)) {
    try {
      // Must mirror build-game.ts exactly: latin1 round-trip so each char is
      // one byte, length = byte count.
      const data = readFileSync(join(distDir, name), "latin1");
      const fingerprint = `${data.length.toString(16).padStart(8, "0")}${fnv1a(data)}`;
      if (fingerprint !== expected) return false;
    } catch {
      return false;
    }
  }
  return true;
}
