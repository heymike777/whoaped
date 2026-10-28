import { describe, expect, it } from 'vitest';

import { parseFirebaseServiceAccount } from '../services/push.js';

describe('Firebase service-account configuration', () => {
  const serviceAccount = {
    type: 'service_account',
    project_id: 'whoaped',
    private_key: '-----BEGIN PRIVATE KEY-----\nexample\n-----END PRIVATE KEY-----\n',
    client_email: 'firebase-admin@whoaped.iam.gserviceaccount.com',
  };

  it('decodes a base64 service-account JSON value', () => {
    const encoded = Buffer.from(JSON.stringify(serviceAccount)).toString('base64');
    expect(parseFirebaseServiceAccount(undefined, encoded)).toEqual(serviceAccount);
  });

  it('keeps raw JSON compatibility for local environments', () => {
    expect(parseFirebaseServiceAccount(JSON.stringify(serviceAccount))).toEqual(serviceAccount);
  });
});
