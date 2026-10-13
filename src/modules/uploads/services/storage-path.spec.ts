import type { ConfigService } from '@nestjs/config';

import type { Env } from '@config/env.schema';

import { StorageService } from './storage.service';

const config = {
  get: (k: string) =>
    k === 'FIREBASE_STORAGE_BUCKET' ? 'micro-dealer.appspot.com' : undefined,
} as unknown as ConfigService<Env, true>;

describe('StorageService.pathOf', () => {
  const storage = new StorageService(config);

  it('reads both URL forms of this bucket', () => {
    expect(
      storage.pathOf(
        'https://firebasestorage.googleapis.com/v0/b/micro-dealer.appspot.com/o/toc%2Fa.docx?alt=media&token=t',
      ),
    ).toBe('toc/a.docx');
    expect(
      storage.pathOf(
        'https://storage.googleapis.com/micro-dealer.appspot.com/toc%2FRLM_T%26C.docx',
      ),
    ).toBe('toc/RLM_T&C.docx');
  });

  it('refuses another bucket, another host, plain http and path tricks', () => {
    for (const url of [
      'https://firebasestorage.googleapis.com/v0/b/other.appspot.com/o/toc%2Fa.docx',
      'https://evil.example/v0/b/micro-dealer.appspot.com/o/a',
      'http://storage.googleapis.com/micro-dealer.appspot.com/a',
      'https://storage.googleapis.com/micro-dealer.appspot.com/toc%2F..%2F..%2Fx',
      'not a url',
    ]) {
      expect(storage.pathOf(url)).toBeNull();
    }
  });
});
