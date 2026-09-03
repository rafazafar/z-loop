import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  blocked_by: number[];
}

export interface GithubPr {
  number: number;
  url: string;
  state: string; // OPEN, MERGED, CLOSED
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  baseRefOid: string;
  mergeable: string; // MERGEABLE, CONFLICTING, UNKNOWN
}

export class GithubClient {
  public repo: string;

  constructor(repoOwnerName: string) {
    this.repo = repoOwnerName;
  }

  public static async resolveRepo(repoPath: string): Promise<string> {
    try {
      const { stdout } = await exec('git', ['-C', repoPath, 'remote', 'get-url', 'origin'], { timeout: 5000 });
      const url = stdout.trim();
      const match = url.match(/github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/);
      if (match) return match[1];
    } catch {}

    const { stdout } = await exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
      cwd: repoPath,
      timeout: 10000
    });
    return stdout.trim();
  }

  public async getIssue(number: number): Promise<GithubIssue | null> {
    try {
      const { stdout } = await exec('gh', [
        'issue', 'view', String(number),
        '-R', this.repo,
        '--json', 'number,title,body,labels'
      ], { timeout: 10000 });
      const data = JSON.parse(stdout);
      return {
        number: data.number,
        title: data.title,
        body: data.body || '',
        labels: (data.labels || []).map((l: any) => l.name),
        blocked_by: []
      };
    } catch {
      return null;
    }
  }

  public async getPr(prNumberOrUrl: string | number): Promise<GithubPr | null> {
    const num = String(prNumberOrUrl).replace(/^.*\/pull\//, '');
    try {
      const { stdout } = await exec('gh', [
        'pr', 'view', num,
        '-R', this.repo,
        '--json', 'number,url,state,headRefName,headRefOid,baseRefName,baseRefOid,mergeable'
      ], { timeout: 10000 });
      const data = JSON.parse(stdout);
      return {
        number: data.number,
        url: data.url,
        state: data.state.toUpperCase(),
        headRefName: data.headRefName,
        headRefOid: data.headRefOid,
        baseRefName: data.baseRefName,
        baseRefOid: data.baseRefOid,
        mergeable: data.mergeable
      };
    } catch {
      return null;
    }
  }

  public async addLabel(targetNumber: number, label: string): Promise<void> {
    await exec('gh', ['issue', 'edit', String(targetNumber), '-R', this.repo, '--add-label', label], { timeout: 10000 }).catch(() => null);
  }

  public async removeLabel(targetNumber: number, label: string): Promise<void> {
    await exec('gh', ['issue', 'edit', String(targetNumber), '-R', this.repo, '--remove-label', label], { timeout: 10000 }).catch(() => null);
  }

  public async postComment(targetNumber: number, body: string): Promise<void> {
    await exec('gh', ['issue', 'comment', String(targetNumber), '-R', this.repo, '--body', body], { timeout: 10000 }).catch(() => null);
  }
}
