// services/image/imageService.js

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

/**
 * Upgrade Amazon image URL to highest quality
 */
export function upgradeImageUrl(url) {
  if (!url) return '';
  return url
    .replace(/\._[A-Z0-9_,]+_\./gi, '.')
    .replace(/(\.(jpg|jpeg|png|webp))$/i, '._SL3000_$1');
}

/**
 * Fetch a single image as blob with retry
 */
async function fetchWithRetry(url, attempt = 0) {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.blob();
  } catch (err) {
    if (attempt < MAX_RETRIES - 1) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      return fetchWithRetry(url, attempt + 1);
    }
    throw err;
  }
}

/**
 * Convert blob to base64
 */
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Get file extension from URL
 */
function getExtension(url) {
  const match = url.match(/\.(jpg|jpeg|png|webp|gif)/i);
  return match ? match[1].toLowerCase() : 'jpg';
}

/**
 * Download all images for a product
 * Returns array of { path, data, type }
 */
export async function downloadProductImages(productData, onProgress = null) {
  const files = [];
  const errors = [];

  const allImages = [
    ...(productData.images || []).map((url, i) => ({
      url: upgradeImageUrl(url),
      path: `images/main/${i === 0 ? 'main' : i}.${getExtension(url)}`,
      label: i === 0 ? 'Main' : `Image ${i}`,
    })),
    ...(productData.variants || [])
      .filter((v) => v.image)
      .map((v) => ({
        url: upgradeImageUrl(v.image),
        path: `images/variants/${(v.value || 'unknown').replace(/\s+/g, '-').toUpperCase()}/main.${getExtension(v.image)}`,
        label: `Variant: ${v.value}`,
      })),
  ];

  const total = allImages.length;
  let done = 0;

  for (const item of allImages) {
    try {
      const blob = await fetchWithRetry(item.url);
      const base64 = await blobToBase64(blob);
      files.push({
        path: item.path,
        data: base64,
        type: blob.type || 'image/jpeg',
        url: item.url,
      });
    } catch (err) {
      errors.push({ url: item.url, error: err.message });
      console.warn(`Failed to download: ${item.url}`, err);
    }
    done++;
    if (onProgress) onProgress({ done, total, current: item.label, errors: errors.length });
  }

  return { files, errors, total, downloaded: files.length };
}

/**
 * Create a deduplicated list of image URLs
 */
export function deduplicateImages(images) {
  const seen = new Set();
  return images.filter((url) => {
    const normalized = url.replace(/\._[^.]+_\./g, '.').split('?')[0];
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}
