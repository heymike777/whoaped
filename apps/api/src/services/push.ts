import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { query } from '../db.js';

type Job = {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  push_token: string;
  device_token_id: string;
  attempts: number;
};

function firebaseApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  const credential = serviceAccount
    ? cert(JSON.parse(serviceAccount))
    : applicationDefault();
  return initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

function stringData(data: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => [
      key,
      typeof value === 'string' ? value : JSON.stringify(value),
    ]),
  );
}

export async function drainNotificationJobs(limit = 100) {
  const jobs = await query<Job>(
    `WITH claimed AS (
       SELECT id FROM notification_jobs
       WHERE status IN ('pending', 'processing') AND available_at <= now()
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT $1
     )
     UPDATE notification_jobs jobs
     SET status = 'processing', attempts = attempts + 1,
         available_at = now() + interval '5 minutes'
     FROM claimed
     WHERE jobs.id = claimed.id
     RETURNING jobs.id, jobs.title, jobs.body, jobs.data, jobs.device_token_id,
       jobs.attempts,
       (SELECT token FROM device_tokens WHERE id = jobs.device_token_id) AS push_token`,
    [limit],
  );
  if (!jobs.length) return { processed: 0, sent: 0 };

  try {
    const response = await getMessaging(firebaseApp()).sendEach(
      jobs.map((job) => ({
        token: job.push_token,
        notification: { title: job.title, body: job.body },
        data: stringData(job.data),
        android: {
          priority: 'high',
          notification: { channelId: 'wallet-activity', sound: 'default' },
        },
        apns: {
          payload: { aps: { sound: 'default', badge: 1 } },
        },
      })),
    );

    const sentIds: string[] = [];
    const failedIds: string[] = [];
    const invalidDeviceIds: string[] = [];
    response.responses.forEach((result, index) => {
      const job = jobs[index];
      if (result.success) {
        sentIds.push(job.id);
        return;
      }
      failedIds.push(job.id);
      if (
        result.error?.code === 'messaging/registration-token-not-registered'
        || result.error?.code === 'messaging/invalid-registration-token'
      ) invalidDeviceIds.push(job.device_token_id);
    });

    if (sentIds.length) {
      await query(
        `UPDATE notification_jobs SET status = 'sent', sent_at = now()
         WHERE id = ANY($1::uuid[])`,
        [sentIds],
      );
    }
    if (failedIds.length) {
      await query(
        `UPDATE notification_jobs
         SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
             available_at = now() + (interval '30 seconds' * power(2, attempts)),
             last_error = 'FCM rejected this notification'
         WHERE id = ANY($1::uuid[])`,
        [failedIds],
      );
    }
    if (invalidDeviceIds.length) {
      await query(
        `UPDATE device_tokens SET disabled_at = now()
         WHERE id = ANY($1::uuid[])`,
        [invalidDeviceIds],
      );
    }
    return { processed: jobs.length, sent: sentIds.length };
  } catch (error) {
    await query(
      `UPDATE notification_jobs
       SET status = CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
           available_at = now() + (interval '30 seconds' * power(2, attempts)),
           last_error = $2
       WHERE id = ANY($1::uuid[])`,
      [jobs.map((job) => job.id), error instanceof Error ? error.message : String(error)],
    );
    throw error;
  }
}
