import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

import { collections } from '../db.js';

type Job = {
  id: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  pushToken: string;
  deviceTokenId: string;
  attempts: number;
};

export function parseFirebaseServiceAccount(json?: string, base64?: string) {
  const value = base64
    ? Buffer.from(base64, 'base64').toString('utf8')
    : json;
  if (!value) return null;
  return JSON.parse(value) as Record<string, unknown>;
}

function firebaseApp() {
  const existing = getApps()[0];
  if (existing) return existing;

  const serviceAccount = parseFirebaseServiceAccount(
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64,
  );
  const credential = serviceAccount
    ? cert(serviceAccount)
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
  const db = await collections();
  const jobs: Job[] = [];
  for (let index = 0; index < limit; index += 1) {
    const now = new Date();
    const job = await db.notificationJobs.findOneAndUpdate(
      { status: { $in: ['pending', 'processing'] }, availableAt: { $lte: now } },
      {
        $set: { status: 'processing', availableAt: new Date(now.getTime() + 5 * 60 * 1_000) },
        $inc: { attempts: 1 },
      },
      { sort: { createdAt: 1 }, returnDocument: 'after' },
    );
    if (!job) break;
    if (job.failedTransaction && (await db.users.findOne({ _id: job.userId }))?.trackFailedTransactions !== true) {
      await db.notificationJobs.updateOne({ _id: job._id }, { $set: { status: 'failed', lastError: 'Failed transaction tracking disabled' } });
      continue;
    }
    const device = await db.deviceTokens.findOne({ _id: job.deviceTokenId });
    if (!device || device.disabledAt) {
      await db.notificationJobs.updateOne(
        { _id: job._id },
        { $set: { status: 'failed', lastError: 'Push token is unavailable' } },
      );
      continue;
    }
    jobs.push({
      id: job._id,
      title: job.title,
      body: job.body,
      data: job.data,
      pushToken: device.token,
      deviceTokenId: job.deviceTokenId,
      attempts: job.attempts,
    });
  }
  if (!jobs.length) return { processed: 0, sent: 0 };

  try {
    const response = await getMessaging(firebaseApp()).sendEach(
      jobs.map((job) => ({
        token: job.pushToken,
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
      ) invalidDeviceIds.push(job.deviceTokenId);
    });

    if (sentIds.length) {
      await db.notificationJobs.updateMany(
        { _id: { $in: sentIds } },
        { $set: { status: 'sent', sentAt: new Date() } },
      );
    }
    if (failedIds.length) {
      await Promise.all(jobs.filter((job) => failedIds.includes(job.id)).map((job) =>
        db.notificationJobs.updateOne(
          { _id: job.id },
          {
            $set: {
              status: job.attempts >= 5 ? 'failed' : 'pending',
              availableAt: new Date(Date.now() + 30_000 * 2 ** job.attempts),
              lastError: 'FCM rejected this notification',
            },
          },
        )));
    }
    if (invalidDeviceIds.length) {
      await db.deviceTokens.updateMany(
        { _id: { $in: invalidDeviceIds } },
        { $set: { disabledAt: new Date() } },
      );
    }
    return { processed: jobs.length, sent: sentIds.length };
  } catch (error) {
    await Promise.all(jobs.map((job) => db.notificationJobs.updateOne(
      { _id: job.id },
      {
        $set: {
          status: job.attempts >= 5 ? 'failed' : 'pending',
          availableAt: new Date(Date.now() + 30_000 * 2 ** job.attempts),
          lastError: error instanceof Error ? error.message : String(error),
        },
      },
    )));
    throw error;
  }
}
