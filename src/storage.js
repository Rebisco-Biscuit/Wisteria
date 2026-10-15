// Files live on local disk under STORAGE_DIR. The interface:
//   list()            -> [{ key, size, mtime }]   (key is "file.ext" or "folder/file.ext")
//   put(key, tmpPath) -> moves a temp file into the vault
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
      // tmp dir may live on another device
      if (err.code !== 'EXDEV') throw err;
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }

  return {
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

function createStorage(env = process.env) {
  return localStorage(path.resolve(env.STORAGE_DIR || './data/vault'));
}

module.exports = { createStorage };
