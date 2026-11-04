import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

/** 逐行流式读文件（Claude Code / Codex 的日志动辄几个 GB，不能一次读进内存） */
export async function* readLines(path: string): AsyncIterable<string> {
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of Bun.file(path).stream()) {
    buf += decoder.decode(chunk, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      yield buf.slice(0, i);
      buf = buf.slice(i + 1);
    }
  }
  buf += decoder.decode();
  if (buf) yield buf;
}

/** 递归列出目录下指定后缀的文件；目录不存在时返回空 */
export async function* walk(dir: string, ext: string): AsyncIterable<string> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, ext);
    else if (e.isFile() && e.name.endsWith(ext)) yield p;
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 把工作目录变成项目名：worktree 归到所属仓库，取最后一级目录名 */
export function projectOf(cwd: string | undefined | null): string | undefined {
  if (!cwd) return undefined;
  const wt = cwd.indexOf("/.claude/worktrees/");
  const root = (wt >= 0 ? cwd.slice(0, wt) : cwd).replace(/\/+$/, "");
  if (root === home() || root === "/") return undefined; // 在主目录里开的会话不算某个项目
  const name = basename(root);
  return name || undefined;
}

export function home(): string {
  return process.env.HOME ?? "";
}
