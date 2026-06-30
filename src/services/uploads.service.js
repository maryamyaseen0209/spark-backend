import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '../../');
const uploadRoot = path.join(projectRoot, 'uploads', 'resources');

export const allowedResourceMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
]);

export function inferResourceType(mimeType = '', url = '') {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType || /\.(pdf|docx?|pptx?|txt)$/i.test(url)) return 'document';
  if (/^https?:\/\//i.test(url)) return 'link';
  return 'other';
}

async function uploadToCloudinary(file) {
  if (!globalThis.FormData || !globalThis.Blob) {
    throw new Error('Cloudinary uploads require Node.js 18+ for native FormData support.');
  }

  const timestamp = String(Math.floor(Date.now() / 1000));
  const folder = env.cloudinary.uploadFolder;
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname || 'resource');
  form.append('api_key', env.cloudinary.apiKey);
  form.append('folder', folder);
  form.append('timestamp', timestamp);

  const signatureBase = `folder=${folder}&timestamp=${timestamp}`;

  const signature = crypto
    .createHash('sha1')
    .update(`${signatureBase}${env.cloudinary.apiSecret}`)
    .digest('hex');

  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/auto/upload`, {
    method: 'POST',
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cloudinary upload failed: ${response.status} ${detail}`);
  }

  const uploaded = await response.json();
  return {
    url: uploaded.secure_url,
    storageProvider: 'cloudinary',
    publicId: uploaded.public_id,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    type: inferResourceType(file.mimetype, uploaded.secure_url),
  };
}

export async function storeResourceFile(file) {
  if (!file) return null;
  if (env.cloudinary.enabled) {
    return uploadToCloudinary(file);
  }

  await fs.mkdir(uploadRoot, { recursive: true });
  const extension = path.extname(file.originalname || '').slice(0, 16);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const destination = path.join(uploadRoot, filename);
  await fs.writeFile(destination, file.buffer);
  return {
    url: `${env.apiUrl}/uploads/resources/${filename}`,
    storageProvider: 'local',
    publicId: filename,
    originalName: file.originalname,
    mimeType: file.mimetype,
    size: file.size,
    type: inferResourceType(file.mimetype),
  };
}

async function deleteCloudinaryAsset(publicId, resourceType = 'image') {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signatureBase = `public_id=${publicId}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(`${signatureBase}${env.cloudinary.apiSecret}`)
    .digest('hex');
  const form = new FormData();
  form.append('public_id', publicId);
  form.append('timestamp', timestamp);
  form.append('api_key', env.cloudinary.apiKey);
  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${env.cloudinary.cloudName}/${resourceType}/destroy`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Cloudinary delete failed: ${response.status} ${detail}`);
  }
  return response.json();
}

export async function deleteStoredResourceFile(resource) {
  if (!resource?.publicId) return { deleted: false, reason: 'missing_public_id' };
  if (resource.storageProvider === 'cloudinary') {
    if (!env.cloudinary.enabled) return { deleted: false, reason: 'cloudinary_not_configured' };
    const types = resource.mimeType?.startsWith('video/') ? ['video'] : ['image', 'raw'];
    let lastError;
    for (const type of types) {
      try {
        const result = await deleteCloudinaryAsset(resource.publicId, type);
        if (result.result === 'ok' || result.result === 'not found') return { deleted: true, provider: 'cloudinary', result };
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error('Cloudinary delete failed');
  }
  if (resource.storageProvider === 'local') {
    const destination = path.join(uploadRoot, path.basename(resource.publicId));
    await fs.rm(destination, { force: true });
    return { deleted: true, provider: 'local' };
  }
  return { deleted: false, reason: 'external_resource' };
}