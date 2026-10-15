// Two storage backends with the same shape:
//   list()            -> [{ key, size, mtime }]   (key is "file.ext" or "folder/file.ext")
//   put(key, tmpPath) -> moves/uploads a temp file into the vault
//   move(from, to)
//   remove(key)
//   removeFolder(folder)
//   read(key)         -> { stream, size } or null
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

function localStorage(root) {
  fs.mkdirSync(root, { recursive: true });
  const abs = (key) => {
    const p = path.resolve(root, key);
    if (!p.startsWith(path.resolve(root) + path.sep)) throw new Error('bad path');
    return p;
  };

  async function moveFile(src, dest) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    try {
      await fsp.rename(src, dest);
    } catch (err) {
      // tmp dir may live on another device (e.g. Render disk mount)
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }

  return {
    kind: 'local',
    async list() {
      const out = [];
      for (const ent of await fsp.readdir(root, { withFileTypes: true })) {
        if (ent.name.startsWith('.')) continue;
        if (ent.isFile()) {
          const st = await fsp.stat(path.join(root, ent.name));
          out.push({ key: ent.name, size: st.size, mtime: st.mtimeMs });
        } else if (ent.isDirectory()) {
          for (const sub of await fsp.readdir(path.join(root, ent.name), { withFileTypes: true })) {
            if (!sub.isFile() || sub.name.startsWith('.')) continue;
            const st = await fsp.stat(path.join(root, ent.name, sub.name));
            out.push({ key: `${ent.name}/${sub.name}`, size: st.size, mtime: st.mtimeMs });
          }
        }
      }
      return out;
    },
    async put(key, tmpPath) {
      await moveFile(tmpPath, abs(key));
    },
    async move(from, to) {
      await moveFile(abs(from), abs(to));
      await this._cleanupDir(from);
    },
    async remove(key) {
      await fsp.rm(abs(key), { force: true });
      await this._cleanupDir(key);
    },
    async removeFolder(folder) {
      await fsp.rm(abs(folder), { recursive: true, force: true });
    },
    async read(key) {
      try {
        const st = await fsp.stat(abs(key));
        if (!st.isFile()) return null;
        return { stream: fs.createReadStream(abs(key)), size: st.size };
      } catch {
        return null;
      }
    },
    // drop a folder once its last file is gone
    async _cleanupDir(key) {
      if (!key.includes('/')) return;
      const dir = path.dirname(abs(key));
      try {
        if ((await fsp.readdir(dir)).length === 0) await fsp.rmdir(dir);
      } catch {}
    },
  };
}

function s3Storage(cfg) {
  const {
    S3Client, ListObjectsV2Command, CopyObjectCommand,
    DeleteObjectCommand, GetObjectCommand,
  } = require('@aws-sdk/client-s3');
  const { Upload } = require('@aws-sdk/lib-storage');

  const client = new S3Client({
    region: cfg.region || 'auto',
    endpoint: cfg.endpoint || undefined,
    forcePathStyle: !!cfg.endpoint,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  const Bucket = cfg.bucket;
  const prefix = cfg.prefix ? cfg.prefix.replace(/\/?$/, '/') : '';
  const k = (key) => prefix + key;

  async function list() {
    const out = [];
    let ContinuationToken;
    do {
      const res = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken }));
      for (const obj of res.Contents || []) {
        const key = obj.Key.slice(prefix.length);
        if (!key || key.endsWith('/') || key.split('/').length > 2) continue;
        out.push({ key, size: obj.Size, mtime: obj.LastModified ? obj.LastModified.getTime() : 0 });
      }
      ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (ContinuationToken);
    return out;
  }

  return {
    kind: 's3',
    list,
    async put(key, tmpPath) {
      await new Upload({
        client,
        params: { Bucket, Key: k(key), Body: fs.createReadStream(tmpPath) },
      }).done();
      await fsp.rm(tmpPath, { force: true });
    },
    async move(from, to) {
      await client.send(new CopyObjectCommand({
        Bucket, Key: k(to), CopySource: encodeURI(`${Bucket}/${k(from)}`),
      }));
      await client.send(new DeleteObjectCommand({ Bucket, Key: k(from) }));
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: k(key) }));
    },
    async removeFolder(folder) {
      for (const item of await list()) {
        if (item.key.startsWith(folder + '/')) await this.remove(item.key);
      }
    },
    async read(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket, Key: k(key) }));
        return { stream: res.Body, size: res.ContentLength };
      } catch (err) {
        if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
  };
}

function createStorage(env = process.env) {
  if (env.S3_BUCKET) {
    return s3Storage({
      bucket: env.S3_BUCKET,
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      prefix: env.S3_PREFIX,
    });
  }
  return localStorage(path.resolve(env.STORAGE_DIR || './data/vault'));
}

module.exports = { createStorage };
