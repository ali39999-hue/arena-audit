/**
 * Arena Audit — Enterprise Secrets Vault & Data Retention (STEP 7-5)
 *
 * Provides:
 *  - AES-256-GCM Secret Vault with Key Rotation
 *  - Secret redaction for logs and reports
 *  - Configurable data retention policies (e.g., 90-day archive / purge)
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

/**
 * Enterprise Secret Vault with key versioning and rotation.
 */
export class SecretVault {
  constructor(masterKeyHex = null) {
    this.keyVersion = 1;
    this.keys = new Map();

    const initialKey = masterKeyHex
      ? Buffer.from(masterKeyHex, 'hex')
      : randomBytes(32);
    this.keys.set(this.keyVersion, initialKey);
  }

  /**
   * Rotate master encryption key to a new version.
   */
  rotateKey() {
    this.keyVersion++;
    const newKey = randomBytes(32);
    this.keys.set(this.keyVersion, newKey);
    return { newVersion: this.keyVersion, rotatedAt: new Date().toISOString() };
  }

  /**
   * Encrypt a sensitive secret payload.
   */
  encrypt(plaintext) {
    const iv = randomBytes(12);
    const key = this.keys.get(this.keyVersion);
    const cipher = createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag,
      version: this.keyVersion,
    };
  }

  /**
   * Decrypt a sensitive secret payload using its specific key version.
   */
  decrypt({ ciphertext, iv, authTag, version }) {
    const key = this.keys.get(version);
    if (!key) throw new Error(`Vault key version ${version} not found (may have been pruned)`);

    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(ciphertext, 'hex', 'utf-8');
    decrypted += decipher.final('utf-8');
    return decrypted;
  }
}

/**
 * Redact sensitive patterns from text.
 */
export function redactSecrets(text) {
  if (!text) return '';
  const patterns = [
    /(?:sk|pk)_[a-zA-Z0-9_\-]{16,}/g,
    /AKIA[0-9A-Z]{16}/g,
    /ghp_[a-zA-Z0-9]{20,}/g,
    /(Bearer\s+)[A-Za-z0-9_\-\.]{20,}/gi,
    /(password\s*[:=]\s*["'])[^"']+?(["'])/gi,
  ];

  let result = String(text);
  for (const p of patterns) {
    result = result.replace(p, '$1[REDACTED]');
  }
  return result;
}

/**
 * Apply retention policy: identify records older than retentionDays.
 */
export function applyRetentionPolicy(records = [], { retentionDays = 90, dateField = 'createdAt' } = {}) {
  const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
  const active = [];
  const expired = [];

  for (const r of records) {
    const recDate = new Date(r[dateField] || r.finished_at || r.timestamp || 0).getTime();
    if (recDate < cutoffTime) {
      expired.push(r);
    } else {
      active.push(r);
    }
  }

  return {
    retentionDays,
    cutoffDate: new Date(cutoffTime).toISOString(),
    retainedCount: active.length,
    expiredCount: expired.length,
    active,
    expired,
  };
}
