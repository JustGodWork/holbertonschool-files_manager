import Bull from 'bull';
import imageThumbnail from 'image-thumbnail';
import fs from 'fs/promises';
import { ObjectId } from 'mongodb';
import dbClient from './utils/db';

const fileQueue = new Bull('fileQueue');

// eslint-disable-next-line consistent-return
async function process(job, done) {
  const { fileId, userId } = job.data;
  if (!fileId) return done(new Error('Missing fileId'));
  if (!userId) return done(new Error('Missing userId'));
  const file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId), userId: new ObjectId(userId) });
  if (!file) return done(new Error('File not found'));
  try {
    const sizes = [500, 250, 100];
    for (const size of sizes) {
      imageThumbnail(file.localPath, { width: size }).then(async (thumb) => {
        await fs.writeFile(`${file.localPath}_${size}`, thumb);
      });
    }
    done();
  } catch (err) {
    done(err);
  }
}

fileQueue.process(process);
