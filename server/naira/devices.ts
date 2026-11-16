/** Device tracking: a stable fingerprint per browser, with a security event when a known user signs in from a new one. */
import { alert, all, audit, get, now, notify, run, uid } from '../db'
import { sha256 } from '../security'

export async function trackDevice(userId: string, userAgent: string, ip: string): Promise<string> {
  const fp = sha256(userAgent || 'unknown').slice(0, 16)
  const label = userAgent.slice(0, 80) || 'Unknown device'
  const existing = await get<{ id: string }>('SELECT id FROM devices WHERE user_id=? AND fingerprint=?', userId, fp)
  if (existing) {
    await run('UPDATE devices SET last_seen=?, ip=? WHERE id=?', now(), ip, existing.id)
    return fp
  }
  const hadOthers = Boolean(await get('SELECT 1 FROM devices WHERE user_id=? LIMIT 1', userId))
  await run('INSERT INTO devices(id,user_id,fingerprint,label,ip,first_seen,last_seen) VALUES (?,?,?,?,?,?,?)', uid('dev'), userId, fp, label, ip, now(), now())
  if (hadOthers) {
    await audit(userId, 'security.new_device', userId, undefined, { fingerprint: fp, ip })
    await alert('warning', 'new_device', 'Sign-in from a new device', `${label} (${ip})`, userId)
    await notify(userId, 'security', 'New device sign-in', 'Your account was just accessed from a device we have not seen before. If this was not you, freeze your wallet and contact support.')
  }
  return fp
}

export const deviceList = async (userId: string) =>
  (await all<{ id: string; label: string; ip: string; first_seen: number; last_seen: number }>('SELECT * FROM devices WHERE user_id=? ORDER BY last_seen DESC LIMIT 20', userId)).map((d) => ({
    id: d.id, label: d.label, ip: d.ip, firstSeen: d.first_seen, lastSeen: d.last_seen,
  }))
