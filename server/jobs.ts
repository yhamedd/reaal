import { all, run, type DB } from './db.js';
import { getSettings } from './settings.js';
import { notify, unitLabel } from './activity.js';

/**
 * Notifies assigned agents when their units cross the "needs attention" or
 * "potentially outdated" verification thresholds. Each level notifies once
 * until the unit is verified again.
 */
export async function runVerificationCheck(db: DB) {
  const s = (await getSettings(db)).verification;
  if (!s.notify_agents) return 0;
  const rows = await all<any>(
    db,
    `SELECT id, assigned_user_id, last_verified, verification_notified_level,
            CASE WHEN last_verified IS NULL THEN 99999 ELSE julianday('now') - julianday(last_verified) END AS age
       FROM units
      WHERE archived_at IS NULL AND status IN ('Available', 'Reserved', 'Pending Verification') AND assigned_user_id IS NOT NULL`,
  );
  let sent = 0;
  for (const r of rows) {
    const level = r.age >= s.outdated_days ? 'outdated' : r.age >= s.attention_days ? 'attention' : null;
    if (!level || level === r.verification_notified_level) continue;
    if (r.verification_notified_level === 'outdated' && level === 'attention') continue;
    const label = await unitLabel(db, r.id);
    await notify(
      db,
      r.assigned_user_id,
      'verification',
      level === 'outdated'
        ? `${label} may be outdated – ${r.last_verified ? `last verified ${Math.floor(r.age)} days ago` : 'never verified'}`
        : `${label} needs verification (last verified ${Math.floor(r.age)} days ago)`,
      `/inventory/${r.id}`,
    );
    await run(db, 'UPDATE units SET verification_notified_level = ? WHERE id = ?', [level, r.id]);
    sent++;
  }
  return sent;
}

export async function cleanupExpired(db: DB) {
  await run(db, "DELETE FROM sessions WHERE expires_at < datetime('now')");
  await run(db, "DELETE FROM password_resets WHERE expires_at < datetime('now', '-7 days')");
  await run(db, "DELETE FROM imports WHERE status <> 'completed' AND created_at < datetime('now', '-7 days')");
  await run(db, "DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now', '-90 days')");
}

export function startJobs(db: DB) {
  const tick = async () => {
    try {
      await runVerificationCheck(db);
      await cleanupExpired(db);
    } catch (e) {
      console.error('Background job failed', e);
    }
  };
  setTimeout(tick, 5_000).unref();
  setInterval(tick, 60 * 60_000).unref();
}
