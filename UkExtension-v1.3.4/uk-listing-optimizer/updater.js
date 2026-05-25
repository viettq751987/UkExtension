// updater.js - UK Listing Optimizer Auto-Update System
// Checks GitHub for new version, downloads ZIP, guides user through reload

'use strict';

// ─── Config ───────────────────────────────────────────────────────────────────
// ⚠ THAY YOUR_USERNAME bằng GitHub username của bạn
const UPDATE_MANIFEST_URL =
  'https://raw.githubusercontent.com/YOUR_USERNAME/uk-listing-optimizer/main/update_manifest.json';

const CHECK_INTERVAL_HOURS = 24;
const STORAGE_KEY_LAST_CHECK = 'updater_last_check';
const STORAGE_KEY_DISMISSED  = 'updater_dismissed_version';
const STORAGE_KEY_RESULT     = 'updater_last_result';

// ─── Version Comparison ───────────────────────────────────────────────────────

/**
 * So sánh 2 version string "1.0.0" vs "1.2.3"
 * Returns: 1 nếu b > a (có bản mới), 0 nếu bằng, -1 nếu a > b
 */
function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (nb > na) return 1;
    if (na > nb) return -1;
  }
  return 0;
}

// ─── Check for Update ─────────────────────────────────────────────────────────

async function checkForUpdate(force = false) {
  // Throttle: không check lại nếu chưa đủ 24h (trừ khi force)
  if (!force) {
    const { [STORAGE_KEY_LAST_CHECK]: lastCheck } = await chrome.storage.local.get(STORAGE_KEY_LAST_CHECK);
    if (lastCheck) {
      const hoursSince = (Date.now() - lastCheck) / 3_600_000;
      if (hoursSince < CHECK_INTERVAL_HOURS) {
        // Trả về cached result
        const { [STORAGE_KEY_RESULT]: cached } = await chrome.storage.local.get(STORAGE_KEY_RESULT);
        return cached || { hasUpdate: false, checked: false };
      }
    }
  }

  try {
    const res = await fetch(UPDATE_MANIFEST_URL + '?t=' + Date.now(), {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const remote = await res.json();
    const currentVersion = chrome.runtime.getManifest().version;
    const hasUpdate = compareVersions(currentVersion, remote.version) === 1;

    // Check nếu user đã dismiss version này rồi
    const { [STORAGE_KEY_DISMISSED]: dismissed } = await chrome.storage.local.get(STORAGE_KEY_DISMISSED);
    const userDismissed = dismissed === remote.version;

    const result = {
      hasUpdate,
      critical: remote.critical || false,
      currentVersion,
      newVersion: remote.version,
      releaseDate: remote.releaseDate,
      downloadUrl: remote.downloadUrl,
      changelogUrl: remote.changelogUrl,
      changelog: remote.changelog || [],
      userDismissed: userDismissed && !remote.critical,
      checkedAt: Date.now(),
      error: null,
    };

    // Cache result & timestamp
    await chrome.storage.local.set({
      [STORAGE_KEY_LAST_CHECK]: Date.now(),
      [STORAGE_KEY_RESULT]: result,
    });

    return result;

  } catch (err) {
    const result = {
      hasUpdate: false,
      error: err.message,
      checkedAt: Date.now(),
      currentVersion: chrome.runtime.getManifest().version,
    };
    await chrome.storage.local.set({ [STORAGE_KEY_LAST_CHECK]: Date.now(), [STORAGE_KEY_RESULT]: result });
    return result;
  }
}

// ─── Dismiss a Version ────────────────────────────────────────────────────────

async function dismissVersion(version) {
  await chrome.storage.local.set({ [STORAGE_KEY_DISMISSED]: version });
}

// ─── Download Update ZIP ──────────────────────────────────────────────────────

async function downloadUpdate(downloadUrl, version, onProgress = null) {
  const filename = `uk-listing-optimizer-v${version}.zip`;

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: downloadUrl,
        filename: filename,
        saveAs: true, // Cho user chọn nơi lưu
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }

        // Track download progress
        const listener = (delta) => {
          if (delta.id !== downloadId) return;

          if (delta.state?.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            resolve({ downloadId, filename });
          } else if (delta.state?.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(listener);
            reject(new Error('Download interrupted'));
          }

          if (delta.bytesReceived && delta.totalBytes && onProgress) {
            onProgress({
              received: delta.bytesReceived.current || 0,
              total: delta.totalBytes.current || 0,
            });
          }
        };

        chrome.downloads.onChanged.addListener(listener);
      }
    );
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

window.Updater = { checkForUpdate, dismissVersion, downloadUpdate, compareVersions };
