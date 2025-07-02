import Bull from 'bull';
import dbClient from './utils/db.mjs';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs';

const fileQueue = new Bull('fileQueue');

fileQueue.process(async (job, done) => {
  const { fileId, userId } = job.data;
  if (!fileId) return done(new Error('Missing fileId'));
  if (!userId) return done(new Error('Missing userId'));
  const file = await dbClient.db.collection('files').findOne({ _id: new (await import('mongodb')).ObjectId(fileId), userId: new (await import('mongodb')).ObjectId(userId) });
  if (!file) return done(new Error('File not found'));
  try {
    const sizes = [500, 250, 100];
    for (const size of sizes) {
      const thumbnail = await imageThumbnail(file.localPath, { width: size });
      await fs.promises.writeFile(`${file.localPath}_${size}`, thumbnail);
    }
    done();
  } catch (err) {
    done(err);
  }
});
