/**
 * GitHub clone / branch / commit / push / PR helpers for the on-prem worker.
 */
import { promises as fs } from "fs";
import path from "path";
import { spawn } from "child_process";

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({
        code: 124,
        stdout,
        stderr: `${stderr}\nERROR: timed out`,
      });
    }, opts.timeoutMs || 120_000);
    child.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function gitEnv(token) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    // Avoid interactive credential helpers
    GIT_ASKPASS: "echo",
    GH_TOKEN: token,
  };
}

function authedRemoteUrl(owner, name, token) {
  return `https://x-access-token:${token}@github.com/${owner}/${name}.git`;
}

/** Public clone (no token) for the paste-URL path. */
export async function preparePublicGithubWorkspace(root, githubClone, job) {
  const branch = `dat-starcoder/${job.id.slice(0, 8)}`;
  const remote = githubClone.httpsUrl;
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: "echo",
  };

  const entries = await fs.readdir(root).catch(() => []);
  const hasGit = entries.includes(".git");

  if (!hasGit) {
    const cloneDir = `${root}__clone`;
    await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
    const cloned = await run(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        githubClone.defaultBranch || "main",
        remote,
        cloneDir,
      ],
      { env, timeoutMs: 180_000 },
    );
    if (cloned.code !== 0) {
      const retry = await run("git", ["clone", "--depth", "1", remote, cloneDir], {
        env,
        timeoutMs: 180_000,
      });
      if (retry.code !== 0) {
        throw new Error(
          `git clone failed: ${retry.stderr || cloned.stderr || retry.stdout}`,
        );
      }
    }

    if (entries.length === 0) {
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(cloneDir, root);
    } else {
      await fs.cp(path.join(cloneDir, ".git"), path.join(root, ".git"), {
        recursive: true,
      });
      const clonedFiles = await listFiles(cloneDir);
      for (const rel of clonedFiles) {
        const dest = path.join(root, rel);
        try {
          await fs.access(dest);
        } catch {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(path.join(cloneDir, rel), dest);
        }
      }
      await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  await run("git", ["remote", "set-url", "origin", remote], { cwd: root, env });
  await run("git", ["config", "user.email", "agent@datstarcoder.com"], {
    cwd: root,
    env,
  });
  await run("git", ["config", "user.name", "DAT STARCODER"], {
    cwd: root,
    env,
  });

  const co = await run("git", ["checkout", "-B", branch], { cwd: root, env });
  if (co.code !== 0) {
    throw new Error(`git checkout failed: ${co.stderr || co.stdout}`);
  }

  return { branch };
}

/** Terminal commands the user runs on their machine (no worker push). */
export function formatPushCommands({ githubClone, branch, job }) {
  const fullName = githubClone.fullName;
  const httpsUrl = `https://github.com/${fullName}.git`;
  const base = githubClone.defaultBranch || "main";
  const subject = `dat-starcoder: ${job.prompt}`.slice(0, 72).replace(/"/g, '\\"');
  const title = `[DAT STARCODER] ${job.prompt}`.slice(0, 80).replace(/"/g, '\\"');

  return [
    "## Push to GitHub",
    "",
    `Repo: \`${fullName}\` · branch: \`${branch}\` · base: \`${base}\``,
    "",
    "1. In Studio open **Workspace → Download zip** and unzip it.",
    "2. On your machine (you already have git / GitHub access):",
    "",
    "```bash",
    `git clone ${httpsUrl}`,
    `cd ${githubClone.name}`,
    `git checkout -b ${branch}`,
    "# Copy the unzipped Studio files into this folder (keep .git)",
    "git add -A",
    `git commit -m "${subject}"`,
    "git push -u origin HEAD",
    `gh pr create --base ${base} --title "${title}" --body "DAT STARCODER job ${job.id}"`,
    "```",
    "",
    "If you already have a local clone of this repo, skip `git clone` — checkout the branch, copy the zip over it, then add / commit / push / `gh pr create`.",
  ].join("\n");
}

export async function prepareGithubWorkspace(root, github, job) {
  const branch = `dat-starcoder/${job.id.slice(0, 8)}`;
  const remote = authedRemoteUrl(github.owner, github.name, github.token);
  const env = gitEnv(github.token);

  const entries = await fs.readdir(root).catch(() => []);
  const hasGit = entries.includes(".git");

  if (!hasGit) {
    // Clone into a temp sibling then move contents if root already has files.
    const cloneDir = `${root}__clone`;
    await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
    const cloned = await run(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        github.defaultBranch,
        remote,
        cloneDir,
      ],
      { env, timeoutMs: 180_000 },
    );
    if (cloned.code !== 0) {
      // Fallback: clone default HEAD without --branch
      const retry = await run("git", ["clone", "--depth", "1", remote, cloneDir], {
        env,
        timeoutMs: 180_000,
      });
      if (retry.code !== 0) {
        throw new Error(
          `git clone failed: ${retry.stderr || cloned.stderr || retry.stdout}`,
        );
      }
    }

    if (entries.length === 0) {
      // Empty workspace — move clone into root
      await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
      await fs.rename(cloneDir, root);
    } else {
      // Overlay: copy clone .git + missing files; keep existing workspace edits
      await fs.cp(path.join(cloneDir, ".git"), path.join(root, ".git"), {
        recursive: true,
      });
      const clonedFiles = await listFiles(cloneDir);
      for (const rel of clonedFiles) {
        const dest = path.join(root, rel);
        try {
          await fs.access(dest);
        } catch {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(path.join(cloneDir, rel), dest);
        }
      }
      await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  await run("git", ["remote", "set-url", "origin", remote], { cwd: root, env });
  await run("git", ["config", "user.email", "agent@datstarcoder.com"], {
    cwd: root,
    env,
  });
  await run("git", ["config", "user.name", "DAT STARCODER"], {
    cwd: root,
    env,
  });

  // Branch from current HEAD
  const co = await run("git", ["checkout", "-B", branch], { cwd: root, env });
  if (co.code !== 0) {
    throw new Error(`git checkout failed: ${co.stderr || co.stdout}`);
  }

  return { branch };
}

async function listFiles(dir, base = dir, out = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === ".git" || e.name === "node_modules") continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, base, out);
    else out.push(path.relative(base, full).replace(/\\/g, "/"));
  }
  return out;
}

export async function commitPushAndOpenPr(root, github, job, branch) {
  const env = gitEnv(github.token);
  const remote = authedRemoteUrl(github.owner, github.name, github.token);
  await run("git", ["remote", "set-url", "origin", remote], { cwd: root, env });

  await run("git", ["add", "-A"], { cwd: root, env });
  const status = await run("git", ["status", "--porcelain"], { cwd: root, env });
  if (!status.stdout.trim()) {
    return {
      branch,
      prUrl: null,
      note: "No file changes to commit",
    };
  }

  const subject = `dat-starcoder: ${job.prompt}`.slice(0, 72);
  const commit = await run("git", ["commit", "-m", subject], { cwd: root, env });
  if (commit.code !== 0) {
    throw new Error(`git commit failed: ${commit.stderr || commit.stdout}`);
  }

  const push = await run(
    "git",
    ["push", "-u", "origin", `HEAD:refs/heads/${branch}`, "--force-with-lease"],
    { cwd: root, env, timeoutMs: 180_000 },
  );
  if (push.code !== 0) {
    throw new Error(`git push failed: ${push.stderr || push.stdout}`);
  }

  if (!github.openPr) {
    return { branch, prUrl: null, note: "Push OK (open PR disabled)" };
  }

  const title = `[DAT STARCODER] ${job.prompt}`.slice(0, 80);
  const body = [
    `Automated PR from DAT STARCODER job \`${job.id}\`.`,
    "",
    "## Prompt",
    "",
    job.prompt,
    "",
    job.modelResolved ? `Model: \`${job.modelResolved}\`` : "",
    "",
    "Opened by the on-prem worker after a successful agent turn.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(
    `https://api.github.com/repos/${github.owner}/${github.name}/pulls`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${github.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "DAT-STARCODER-worker",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title,
        head: branch,
        base: github.defaultBranch || "main",
        body,
      }),
    },
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // If PR already exists for this branch, surface the message but keep branch.
    return {
      branch,
      prUrl: null,
      note: `PR API ${res.status}: ${data.message || JSON.stringify(data).slice(0, 200)}`,
    };
  }
  return {
    branch,
    prUrl: data.html_url || null,
    note: "PR opened",
  };
}
