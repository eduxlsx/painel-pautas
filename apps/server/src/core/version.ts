import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { VersionInfo } from '@pautaflow/shared';
import { REPO_ROOT } from '../env';

type BumpType = 'feature' | 'fix' | 'visual';

interface VersioningModule {
  readVersion(): string;
  readHistory(): { version: string; date: string; type: string; message: string; commit: string | null }[];
  parseVersion(v: string): { features: number; fixes: number; visual: number };
  applyVersion(o: { type: BumpType | 'manual'; version?: string; message: string }): { previous: string; version: string };
}

/** Exposição do versionamento (scripts/versioning.mjs) para a interface. */
export class VersionService {
  private mod: Promise<VersioningModule> | null = null;

  private load(): Promise<VersioningModule> {
    this.mod ??= import(pathToFileURL(path.join(REPO_ROOT, 'scripts', 'versioning.mjs')).href) as Promise<VersioningModule>;
    return this.mod;
  }

  async info(): Promise<VersionInfo> {
    const m = await this.load();
    const version = m.readVersion();
    return { version, parts: m.parseVersion(version), changelog: m.readHistory().slice(-50).reverse() };
  }

  async bump(type: BumpType, message: string): Promise<VersionInfo> {
    const m = await this.load();
    m.applyVersion({ type, message: message || 'Atualização manual' });
    return this.info();
  }

  async set(version: string, message: string): Promise<VersionInfo> {
    const m = await this.load();
    m.applyVersion({ type: 'manual', version, message: message || 'Versão definida manualmente' });
    return this.info();
  }
}
