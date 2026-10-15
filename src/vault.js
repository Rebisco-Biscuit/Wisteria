// The grouping rules live here so they're easy to reason about (and test).
//
// - A file on its own (art.psd, art.sai2, sketch.png) sits at the top level as-is.
// - Once a finished image and a non-image file share a name (art.psd + art.png),
//   they get moved into a folder called "art".
// - Anything uploaded later with the same name (art.clip, art.kra...) goes
//   straight into the existing folder.

const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'avif', 'heic', 'heif', 'svg', 'ico',
]);

function extOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

function stemOf(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

function isImage(name) {
  return IMAGE_EXTS.has(extOf(name));
}

// Turn whatever the browser sent into a single safe filename.
function safeName(raw) {
  let name = String(raw || '').split(/[\\/]/).pop();
  name = name.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (!name || name.length > 200) return null;
  return name;
}

function splitKey(key) {
  const i = key.indexOf('/');
  return i === -1 ? { folder: null, name: key } : { folder: key.slice(0, i), name: key.slice(i + 1) };
}

function folderMap(keys) {
  const map = new Map(); // lowercase -> actual folder name
  for (const key of keys) {
    const { folder } = splitKey(key);
    if (folder) map.set(folder.toLowerCase(), folder);
  }
  return map;
}

// Where should a freshly uploaded file land?
function destinationFor(name, keys) {
  const folder = folderMap(keys).get(stemOf(name).toLowerCase());
  return folder ? `${folder}/${name}` : name;
}

// Look at the top level and work out which files now need to be bundled together.
function planRegroup(keys) {
  const folders = folderMap(keys);
  const rootFiles = keys.filter((k) => !k.includes('/'));
  const rootLower = new Set(rootFiles.map((k) => k.toLowerCase()));

  const groups = new Map();
  for (const name of rootFiles) {
    const s = stemOf(name).toLowerCase();
    if (!groups.has(s)) groups.set(s, []);
    groups.get(s).push(name);
  }

  const moves = [];
  for (const [s, names] of groups) {
    const existing = folders.get(s);
    const hasImage = names.some(isImage);
    const hasSource = names.some((n) => !isImage(n));
    if (!existing && !(hasImage && hasSource)) continue;

    // name the folder after the finished image so it keeps the artist's casing
    const folder = existing || stemOf(names.find(isImage));
    // can't make a folder if a bare file already has that exact name
    if (!existing && rootLower.has(folder.toLowerCase())) continue;
    for (const name of names) moves.push({ from: name, to: `${folder}/${name}` });
  }
  return moves;
}

// Shape the flat listing into what the UI shows.
function buildTree(items) {
  const folders = new Map();
  const files = [];
  for (const item of items) {
    const { folder, name } = splitKey(item.key);
    const entry = { key: item.key, name, size: item.size, mtime: item.mtime, image: isImage(name), ext: extOf(name) };
    if (!folder) {
      files.push(entry);
      continue;
    }
    if (!folders.has(folder)) folders.set(folder, { name: folder, files: [], mtime: 0 });
    const f = folders.get(folder);
    f.files.push(entry);
    f.mtime = Math.max(f.mtime, item.mtime);
  }
  const out = [...folders.values()].map((f) => {
    f.files.sort((a, b) => (a.image === b.image ? a.name.localeCompare(b.name) : a.image ? -1 : 1));
    f.cover = (f.files.find((x) => x.image) || {}).key || null;
    return f;
  });
  return { folders: out, files };
}

module.exports = { isImage, extOf, stemOf, safeName, destinationFor, planRegroup, buildTree, splitKey };
