import { describe, it, expect } from 'vitest';
import { GitHelper } from '@/git/helper';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';

const testWorkspace = '/tmp/opencode-test-git';

async function setupGitRepo() {
  if (existsSync(testWorkspace)) {
    await rm(testWorkspace, { recursive: true, force: true });
  }
  await mkdir(testWorkspace, { recursive: true });

  execSync('git init', { cwd: testWorkspace });
  execSync('git config user.email "test@test.com"', { cwd: testWorkspace });
  execSync('git config user.name "Test"', { cwd: testWorkspace });
}

describe('GitHelper', () => {
  it('should create branch with proper naming', async () => {
    await setupGitRepo();
    // Create an initial commit so we can branch
    execSync('touch README.md && git add . && git commit -m "init"', { cwd: testWorkspace });

    const git = new GitHelper(testWorkspace);
    const branchName = git.generateBranchName('feat', 'add user auth');
    expect(branchName).toMatch(/^\d{6}-feat-add-user-auth$/);
  });

  it('should detect git status', async () => {
    await setupGitRepo();

    const git = new GitHelper(testWorkspace);
    const status = git.getStatus();
    expect(status.staged).toEqual([]);

    // Create an untracked file
    execSync('touch newfile.txt', { cwd: testWorkspace });
    const status2 = git.getStatus();
    expect(status2.untracked).toContain('newfile.txt');
  });

  it('should get current branch', async () => {
    await setupGitRepo();
    execSync('touch x.txt && git add . && git commit -m "init"', { cwd: testWorkspace });

    const git = new GitHelper(testWorkspace);
    const branch = git.getCurrentBranch();
    expect(branch).toBeTruthy();
  });

  it('should check uncommitted changes', async () => {
    await setupGitRepo();

    const git = new GitHelper(testWorkspace);
    const hasChanges = await git.hasUncommittedChanges();
    expect(hasChanges).toBe(false);

    execSync('touch test.txt', { cwd: testWorkspace });
    const hasChanges2 = await git.hasUncommittedChanges();
    expect(hasChanges2).toBe(true);
  });

  it('should return empty submodule list when none exist', async () => {
    await setupGitRepo();

    const git = new GitHelper(testWorkspace);
    const subs = await git.getChangedSubmodules();
    expect(subs).toEqual([]);
  });
});
