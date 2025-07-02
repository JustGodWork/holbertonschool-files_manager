import { ObjectId } from 'mongodb';
import Bull from 'bull';
import fs from 'fs';
import mime from 'mime-types';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import redisClient from '../utils/redis';
import dbClient from '../utils/db';

const fileQueue = new Bull('fileQueue');

class FilesController {
  static async postUpload(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const userObjId = new ObjectId(userId);

    const {
      name,
      type,
      parentId = 0,
      isPublic = false,
      data,
    } = req.body;

    if (!name) return res.status(400).json({ error: 'Missing name' });
    if (!type || !['folder', 'file', 'image'].includes(type)) return res.status(400).json({ error: 'Missing type' });
    if (type !== 'folder' && !data) return res.status(400).json({ error: 'Missing data' });
    let parentFile = null;
    if (parentId && parentId !== 0) {
      parentFile = await dbClient.db.collection('files').findOne({ _id: new ObjectId(parentId) });
      if (!parentFile) return res.status(400).json({ error: 'Parent not found' });
      if (parentFile.type !== 'folder') return res.status(400).json({ error: 'Parent is not a folder' });
    }
    if (type === 'folder') {
      const doc = {
        userId: userObjId,
        name,
        type,
        isPublic,
        parentId: parentId === 0 ? 0 : new ObjectId(parentId),
      };
      const result = await dbClient.db.collection('files').insertOne(doc);
      return res.status(201).json({
        id: result.insertedId.toString(),
        userId,
        name,
        type,
        isPublic,
        parentId,
      });
    }
    // file or image
    const folderPath = process.env.FOLDER_PATH || '/tmp/files_manager';
    if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
    const localPath = path.join(folderPath, uuidv4());
    await fs.promises.writeFile(localPath, Buffer.from(data, 'base64'));
    const doc = {
      userId: userObjId,
      name,
      type,
      isPublic,
      parentId: parentId === 0 ? 0 : new ObjectId(parentId),
      localPath,
    };
    const result = await dbClient.db.collection('files').insertOne(doc);
    if (type === 'image') {
      await fileQueue.add({
        userId,
        fileId: result.insertedId.toString(),
      });
    }
    return res.status(201).json({
      id: result.insertedId.toString(),
      userId,
      name,
      type,
      isPublic,
      parentId,
    });
  }

  static async getShow(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const fileId = req.params.id;
    let file;
    try {
      file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId), userId: new ObjectId(userId) });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!file) return res.status(404).json({ error: 'Not found' });
    return res.status(200).json({
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId && file.parentId.toString ? file.parentId.toString() : file.parentId,
    });
  }

  static async getIndex(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const { parentId, page: pageQuery } = req.query;
    const page = parseInt(pageQuery, 10) || 0;
    const match = { userId: new ObjectId(userId) };
    if (parentId && parentId !== '0') {
      match.parentId = parentId.length === 24 ? new ObjectId(parentId) : parentId;
    } else {
      match.parentId = 0;
    }
    const files = await dbClient.db.collection('files')
      .aggregate([
        { $match: match },
        { $skip: page * 20 },
        { $limit: 20 },
      ]).toArray();
    const result = files.map((file) => ({
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: file.isPublic,
      parentId: file.parentId && file.parentId.toString ? file.parentId.toString() : file.parentId,
    }));
    return res.status(200).json(result);
  }

  static async putPublish(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const fileId = req.params.id;
    let file;
    try {
      file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId), userId: new ObjectId(userId) });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!file) return res.status(404).json({ error: 'Not found' });
    await dbClient.db.collection('files').updateOne({ _id: file._id }, { $set: { isPublic: true } });
    file.isPublic = true;
    return res.status(200).json({
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: true,
      parentId: file.parentId && file.parentId.toString ? file.parentId.toString() : file.parentId,
    });
  }

  static async putUnpublish(req, res) {
    const token = req.headers['x-token'];
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const userId = await redisClient.get(`auth_${token}`);
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const fileId = req.params.id;
    let file;
    try {
      file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId), userId: new ObjectId(userId) });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!file) return res.status(404).json({ error: 'Not found' });
    await dbClient.db.collection('files').updateOne({ _id: file._id }, { $set: { isPublic: false } });
    file.isPublic = false;
    return res.status(200).json({
      id: file._id.toString(),
      userId: file.userId.toString(),
      name: file.name,
      type: file.type,
      isPublic: false,
      parentId: file.parentId && file.parentId.toString ? file.parentId.toString() : file.parentId,
    });
  }

  static async getFile(req, res) {
    const fileId = req.params.id;
    const { size } = req.query;
    let file;
    try {
      file = await dbClient.db.collection('files').findOne({ _id: new ObjectId(fileId) });
    } catch (err) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (!file) return res.status(404).json({ error: 'Not found' });
    let userId = null;
    const token = req.headers['x-token'];
    if (token) userId = await redisClient.get(`auth_${token}`);
    if (!file.isPublic && (!userId || userId !== file.userId.toString())) {
      return res.status(404).json({ error: 'Not found' });
    }
    if (file.type === 'folder') {
      return res.status(400).json({ error: "A folder doesn't have content" });
    }
    let filePath = file.localPath;
    if (file.type === 'image' && size && ['500', '250', '100'].includes(size)) {
      filePath = `${file.localPath}_${size}`;
    }
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const mimeType = mime.lookup(file.name) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    fs.createReadStream(filePath).pipe(res);
    return null; // Ensure a value is always returned
  }
}

export default FilesController;
