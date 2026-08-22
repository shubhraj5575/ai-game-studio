/**
 * Artifact store — every agent output is a named, versioned file under
 * <runDir>/artifacts/. Artifacts are the deliverables; agents communicate
 * through them plus the blackboard.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fnv1a } from "../../engine/core/hash.js";

export class ArtifactStore {
  readonly dir: string;

  constructor(runDir: string) {
    this.dir = join(runDir, "artifacts");
    mkdirSync(this.dir, { recursive: true });
  }

  put(name: string, content: string): ArtifactRef {
    const path = join(this.dir, name);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
    return {
      name,
      path,
      bytes: Buffer.byteLength(content),
      checksum: fnv1a(content),
      writtenAt: new Date().toISOString(),
    };
  }

  putJson(name: string, data: unknown): ArtifactRef {
    return this.put(name.endsWith(".json") ? name : `${name}.json`, JSON.stringify(data, null, 2));
  }

  get(name: string): string | null {
    const path = join(this.dir, name);
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  }

  getJson<T>(name: string): T | null {
    const raw = this.get(name.endsWith(".json") ? name : `${name}.json`);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  list(): string[] {
    // Flat + nested listing via recursive walk.
    const out: string[] = [];
    const walk = (dir: string, prefix: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), prefix + entry.name + "/");
        else out.push(prefix + entry.name);
      }
    };
    walk(this.dir, "");
    return out.sort();
  }
}

export interface ArtifactRef {
  name: string;
  path: string;
  bytes: number;
  checksum: string;
  writtenAt: string;
}
