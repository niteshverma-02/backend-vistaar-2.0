import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { cert, getApp, initializeApp, type App } from 'firebase-admin/app';
import { getStorage } from 'firebase-admin/storage';

import { unavailable } from '@common/errors/api-error';
import type { Env } from '@config/env.schema';

const APP_NAME = 'vistaar-uploads';
const SIGNED_URL_TTL_MS = 60 * 60 * 1000;
/** A cached signed URL is handed out only while it has at least this long left. */
const SIGNED_URL_MIN_LEFT_MS = 15 * 60 * 1000;
/** ~200 bytes a URL: ~10 MB at the cap. */
const SIGNED_URL_CACHE_MAX = 50_000;

export const ALLOWED_MIME =
  /^(image\/(jpeg|png|webp|heic|heif)|application\/pdf)$/;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'docx',
};

/**
 * KYC files (Aadhaar, PAN, cheque, selfie…) in the organisation's document
 * folder — `KO-documents/<pii_id>/<purpose>/`, beside ko-sales' own — but as
 * **private** objects (decided 2026-10-09): a reader gets a signed URL that
 * expires in an hour, minted on each read. `piis.documents` records the
 * object's canonical URL, which opens only for someone with bucket access.
 *
 * The `<pii_id>` prefix is how a partner is stopped from attaching someone
 * else's file to their own form.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private app: App | null = null;
  /**
   * path → signed URL. Signing is local RSA, ~1.6 ms of CPU each, and a
   * "My stories" page signs up to 40 — so a URL is reused while it has 15+
   * minutes left. Insertion order makes the oldest the first to go.
   */
  private readonly signed = new Map<string, { url: string; expires: number }>();
  private readonly bucketName?: string;
  private readonly credentials?: {
    projectId: string;
    clientEmail: string;
    privateKey: string;
  };

  constructor(config: ConfigService<Env, true>) {
    const projectId = config.get('FIREBASE_PROJECT_ID', { infer: true });
    const clientEmail = config.get('FIREBASE_CLIENT_EMAIL', { infer: true });
    const privateKey = config.get('FIREBASE_PRIVATE_KEY', { infer: true });
    this.bucketName = config.get('FIREBASE_STORAGE_BUCKET', { infer: true });
    if (projectId && clientEmail && privateKey && this.bucketName) {
      this.credentials = {
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, '\n'),
      };
    }
  }

  get configured(): boolean {
    return !!this.credentials;
  }

  /** `KO-documents/<piiId>/<purpose>/<ts>-<id>.<ext>` — the value stored in `raw_data`. */
  async save(
    piiId: string,
    purpose: string,
    buffer: Buffer,
    mime: string,
  ): Promise<string> {
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}.${EXT[mime] ?? 'bin'}`;
    const path = `KO-documents/${piiId}/${purpose}/${name}`;
    await this.bucket()
      .file(path)
      .save(buffer, {
        contentType: mime,
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0' },
      });
    return path;
  }

  /**
   * A file every partner may download — banner art, not KYC. Its URL carries
   * a Firebase download token, so it opens without a signature and never
   * changes: the app's image cache and the banners' ETag both stay valid.
   * Each upload gets a new path, so the object can be cached for a year.
   */
  async savePublic(
    folder: string,
    buffer: Buffer,
    mime: string,
    extra: Record<string, string> = {},
  ): Promise<{ path: string; url: string }> {
    const path = `${folder}/${randomUUID()}.${EXT[mime] ?? 'bin'}`;
    const token = randomUUID();
    await this.bucket()
      .file(path)
      .save(buffer, {
        contentType: mime,
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000, immutable',
          metadata: { ...extra, firebaseStorageDownloadTokens: token },
        },
      });
    return { path, url: this.downloadUrl(path, token) };
  }

  /**
   * A file `savePublic` wrote: its download URL and the `extra` it was saved
   * with. `null` when it is not there, or was not saved as public.
   */
  async publicFile(
    path: string,
  ): Promise<{ url: string; extra: Record<string, string> } | null> {
    try {
      const [meta] = await this.bucket().file(path).getMetadata();
      const custom: Record<string, string> = {};
      for (const [key, value] of Object.entries(meta.metadata ?? {})) {
        if (value !== null && value !== undefined) custom[key] = String(value);
      }
      const { firebaseStorageDownloadTokens: tokens = '', ...extra } = custom;
      const token = tokens.split(',')[0];
      return token ? { url: this.downloadUrl(path, token), extra } : null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  /**
   * A partner's own file outside KYC — a saved story's image. Private like
   * KYC: read through `sign()`. `extra` (e.g. pixel size) is read back with
   * `privateFile`, so a save can trust the upload's measurements.
   */
  async savePrivate(
    folder: string,
    buffer: Buffer,
    mime: string,
    extra: Record<string, string> = {},
    /** File stem (default a new UUID) — e.g. one carrying a signed receipt. */
    stem: string = randomUUID(),
  ): Promise<string> {
    const path = `${folder}/${stem}.${EXT[mime] ?? 'bin'}`;
    await this.bucket()
      .file(path)
      .save(buffer, {
        contentType: mime,
        resumable: false,
        metadata: { cacheControl: 'private, max-age=0', metadata: extra },
      });
    return path;
  }

  /** The `extra` a `savePrivate` file carries; `null` when it is not there. */
  async privateFile(path: string): Promise<Record<string, string> | null> {
    try {
      const [meta] = await this.bucket().file(path).getMetadata();
      const extra: Record<string, string> = {};
      for (const [key, value] of Object.entries(meta.metadata ?? {})) {
        if (value !== null && value !== undefined) extra[key] = String(value);
      }
      return extra;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  /**
   * A URL the app PUTs one file to, straight into the bucket — a minute of
   * video never passes through this server. The signature pins the path, the
   * type and the size range: the app must send exactly `headers`, and a bigger
   * file is refused by the bucket itself.
   */
  async signedUpload(
    path: string,
    contentType: string,
    maxBytes: number,
    ttlMs: number,
  ): Promise<{ url: string; headers: Record<string, string>; expires: Date }> {
    const expires = new Date(Date.now() + ttlMs);
    const headers = {
      'Content-Type': contentType,
      'x-goog-content-length-range': `1,${maxBytes}`,
    };
    const [url] = await this.bucket()
      .file(path)
      .getSignedUrl({
        version: 'v4',
        action: 'write',
        expires,
        contentType,
        extensionHeaders: {
          'x-goog-content-length-range': headers['x-goog-content-length-range'],
        },
      });
    return { url, headers, expires };
  }

  /** What the bucket holds at `path`; `null` when nothing was uploaded there. */
  async stat(
    path: string,
  ): Promise<{ size: number; contentType: string } | null> {
    try {
      const [meta] = await this.bucket().file(path).getMetadata();
      return {
        size: Number(meta.size ?? 0),
        contentType: String(meta.contentType ?? ''),
      };
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  /**
   * Opens a private file to anyone with the link: gives it a download token
   * (reusing one it has) and answers the token URL — what Stockship's product
   * pages play. `unpublish` takes the token away and the link dies.
   */
  async publish(path: string): Promise<string> {
    const file = this.bucket().file(path);
    const [meta] = await file.getMetadata();
    const existing = String(
      meta.metadata?.firebaseStorageDownloadTokens ?? '',
    ).split(',')[0];
    if (existing) return this.downloadUrl(path, existing);
    const token = randomUUID();
    await file.setMetadata({
      metadata: { firebaseStorageDownloadTokens: token },
    });
    return this.downloadUrl(path, token);
  }

  /** Best-effort, like `remove`: the caller has already hidden the row. */
  async unpublish(path: string): Promise<void> {
    try {
      await this.bucket()
        .file(path)
        .setMetadata({ metadata: { firebaseStorageDownloadTokens: null } });
    } catch (error) {
      if ((error as { code?: number }).code === 404) return;
      this.logger.warn(`Could not unpublish ${path}: ${String(error)}`);
    }
  }

  /** Best-effort: a file left behind costs storage, never a failed request. */
  async remove(path: string): Promise<void> {
    this.signed.delete(path);
    try {
      await this.bucket().file(path).delete({ ignoreNotFound: true });
    } catch (error) {
      this.logger.warn(`Could not delete ${path}: ${String(error)}`);
    }
  }

  private downloadUrl(path: string, token: string): string {
    return (
      `https://firebasestorage.googleapis.com/v0/b/${this.bucketName}/o/` +
      `${encodeURIComponent(path)}?alt=media&token=${token}`
    );
  }

  /** The object's canonical URL, in the form ko-sales stores in `piis.documents`. */
  urlOf(path: string): string | null {
    if (!this.bucketName) return null;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    return `https://storage.googleapis.com/${this.bucketName}/${encoded}`;
  }

  /**
   * The object path behind a URL into **this** bucket — a download-token URL
   * (`firebasestorage…/v0/b/<bucket>/o/<path>`) or a canonical one
   * (`storage.googleapis.com/<bucket>/<path>`). `null` for anything else, so a
   * stored link can never make the server read another host or bucket.
   */
  pathOf(url: string): string | null {
    if (!this.bucketName) return null;
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    const token = `/v0/b/${this.bucketName}/o/`;
    const raw =
      u.hostname === 'firebasestorage.googleapis.com' &&
      u.pathname.startsWith(token)
        ? u.pathname.slice(token.length)
        : u.hostname === 'storage.googleapis.com' &&
            u.pathname.startsWith(`/${this.bucketName}/`)
          ? u.pathname.slice(this.bucketName.length + 2)
          : null;
    if (!raw) return null;
    try {
      const path = decodeURIComponent(raw);
      return path.split('/').includes('..') ? null : path;
    } catch {
      return null;
    }
  }

  /** A file's bytes; `null` when it is not there. */
  async read(path: string): Promise<Buffer | null> {
    try {
      const [data] = await this.bucket().file(path).download();
      return data;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  /** Signed read URLs for many paths at once; a path that fails is left out. */
  async sign(paths: string[]): Promise<Map<string, string>> {
    const urls = new Map<string, string>();
    if (!this.configured || paths.length === 0) return urls;
    const now = Date.now();
    const expires = now + SIGNED_URL_TTL_MS;
    await Promise.all(
      [...new Set(paths)].map(async (path) => {
        const cached = this.signed.get(path);
        if (cached && cached.expires - now >= SIGNED_URL_MIN_LEFT_MS) {
          urls.set(path, cached.url);
          return;
        }
        try {
          const [url] = await this.bucket()
            .file(path)
            .getSignedUrl({ action: 'read', expires });
          urls.set(path, url);
          this.remember(path, url, expires);
        } catch (error) {
          this.logger.warn(`Could not sign ${path}: ${String(error)}`);
        }
      }),
    );
    return urls;
  }

  private remember(path: string, url: string, expires: number): void {
    this.signed.delete(path);
    this.signed.set(path, { url, expires });
    if (this.signed.size > SIGNED_URL_CACHE_MAX) {
      const oldest = this.signed.keys().next().value;
      if (oldest !== undefined) this.signed.delete(oldest);
    }
  }

  private bucket() {
    if (!this.credentials || !this.bucketName) {
      throw unavailable(
        'UPLOADS_NOT_CONFIGURED',
        'Uploading files is not working right now. Please try again later.',
      );
    }
    if (!this.app) {
      try {
        this.app = getApp(APP_NAME);
      } catch {
        this.app = initializeApp(
          { credential: cert(this.credentials) },
          APP_NAME,
        );
      }
    }
    return getStorage(this.app).bucket(this.bucketName);
  }
}
