import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return null; }
}

async function writeJsonAtomic(file, value) {
  const temporary = `${file}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" }).catch(async (error) => {
    if (error.code !== "EEXIST") throw error;
    await unlink(temporary);
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  });
  await rename(temporary, file);
}

export async function recordMergedAudit(root, input, now = new Date()) {
  const ticket = Number(input?.ticket);
  const note = String(input?.note || "").replace(/\r\n/g, "\n").trim();
  if (!Number.isSafeInteger(ticket) || ticket < 1) return { ok: false, output: "Invalid ticket" };
  if (input?.acknowledged !== true) return { ok: false, output: "Acknowledge the assurance exception first" };
  if (note.length < 12) return { ok: false, output: "Add a specific audit note of at least 12 characters" };
  if (note.length > 4000) return { ok: false, output: "Audit note is too long" };

  const stateDir = path.join(root, "state");
  const exceptionFile = path.join(stateDir, `${ticket}.merged-unverified`);
  const auditFile = path.join(stateDir, `${ticket}.post-merge-audit.json`);
  const reviewFile = path.join(stateDir, `${ticket}.review.json`);
  const resolvedFile = path.join(stateDir, `${ticket}.merged-audited`);
  const lockFile = path.join(stateDir, `${ticket}.post-merge-audit.lock`);
  try {
    await writeFile(lockFile, `${process.pid}\n`, { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") return { ok: false, output: `Issue #${ticket} audit is already being recorded` };
    throw error;
  }
  try {
    const [exception, existing, review] = await Promise.all([
      readFile(exceptionFile, "utf8").catch(() => ""),
      readJson(auditFile),
      readJson(reviewFile)
    ]);
    if (existing || await readFile(resolvedFile, "utf8").catch(() => "")) return { ok: false, output: `Issue #${ticket} audit is already recorded` };
    if (!exception.trim() || review?.action !== "merged-unverified") return { ok: false, output: `Issue #${ticket} is not awaiting a post-merge audit` };
    if (!review.pr || !review.head_oid) return { ok: false, output: "The immutable PR audit target is missing" };

    const recordedAt = now.toISOString();
    const audit = {
      schema: 1,
      ticket,
      pr: review.pr,
      head_oid: review.head_oid,
      original_exception: exception.trim(),
      disposition: "accepted-after-post-merge-audit",
      note,
      recorded_by: "owner (operator console)",
      recorded_at: recordedAt
    };
    const updatedReview = { ...review, action: "merged-audited", post_merge_audit: path.basename(auditFile) };

    await writeJsonAtomic(auditFile, audit);
    await writeJsonAtomic(reviewFile, updatedReview);
    await writeFile(resolvedFile, `Post-merge audit recorded at ${recordedAt}; original assurance exception retained in ${path.basename(auditFile)}\n`);
    await unlink(exceptionFile);
    return { ok: true, output: `Issue #${ticket} post-merge audit recorded`, audit };
  } finally {
    await unlink(lockFile).catch(() => {});
  }
}
