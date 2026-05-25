// background.js - Service Worker (MV3)
'use strict';

const UPDATE_CHECK_URL =
  'https://raw.githubusercontent.com/viettq751987/UkExtension/main/update_manifest.json';
const CHECK_INTERVAL_MINUTES = 60 * 12;

// ─── Install ──────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.sync.get(['openrouterKey'], (d) => {
    if (!d.openrouterKey) {
      chrome.storage.sync.set({
        openrouterKey: '',
        defaultModel: 'deepseek/deepseek-chat',
        outputFolder: 'UKListing',
        exportMode: 'zip',
        updateCheckEnabled: true,
      });
    }
  });

  chrome.alarms.create('update_check', {
    delayInMinutes: 2,
    periodInMinutes: CHECK_INTERVAL_MINUTES,
  });

  if (details.reason === 'update') {
    chrome.storage.local.remove(['update_dismissed_version']);
    chrome.action.setBadgeText({ text: '' });
  }
});

// ─── Alarm ────────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'update_check') checkForUpdate();
});

// ─── Version Compare ──────────────────────────────────────────────────────────

function versionCompare(current, remote) {
  const c = current.split('.').map(Number);
  const r = remote.split('.').map(Number);
  for (let i = 0; i < Math.max(c.length, r.length); i++) {
    const cv = c[i] || 0, rv = r[i] || 0;
    if (rv > cv) return 1;
    if (cv > rv) return -1;
  }
  return 0;
}

// ─── Update Check ─────────────────────────────────────────────────────────────

async function checkForUpdate(force = false) {
  try {
    const settings = await chrome.storage.sync.get('updateCheckEnabled');
    if (settings.updateCheckEnabled === false && !force) return null;

    const res = await fetch(`${UPDATE_CHECK_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const remote = await res.json();
    const currentVersion = chrome.runtime.getManifest().version;
    const hasUpdate = versionCompare(currentVersion, remote.version) === 1;

    const result = {
      hasUpdate,
      critical: remote.critical || false,
      forceUpdate: remote.minVersion
        ? versionCompare(currentVersion, remote.minVersion) === 1
        : false,
      currentVersion,
      newVersion: remote.version,
      releaseDate: remote.releaseDate || '',
      downloadUrl: remote.downloadUrl || '',
      changelogUrl: remote.changelogUrl || '',
      changelog: remote.changelog || [],
      checkedAt: Date.now(),
      error: null,
    };

    await chrome.storage.local.set({ update_last_check: Date.now(), update_result: result });

    if (hasUpdate) {
      chrome.action.setBadgeText({ text: result.critical ? 'UPD!' : 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: result.critical ? '#ef4444' : '#f0c040' });
    }

    return result;
  } catch (err) {
    const r = { hasUpdate: false, error: err.message, checkedAt: Date.now() };
    await chrome.storage.local.set({ update_result: r });
    return r;
  }
}

// ─── Messages ─────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'INJECT_LIBS') {
    // Inject XLSX + JSZip into the active tab via chrome.scripting
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      const tab = tabs[0];
      if (!tab) { sendResponse({ ok: false, error: 'No active tab' }); return; }
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['lib/xlsx.min.js'],
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['lib/jszip.min.js'],
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    });
    return true;
  }
  if (msg.action === 'GET_SETTINGS') {
    chrome.storage.sync.get(['openrouterKey','defaultModel','outputFolder','exportMode','updateCheckEnabled'], sendResponse);
    return true;
  }
  if (msg.action === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(msg.settings, () => sendResponse({ ok: true }));
    return true;
  }
  if (msg.action === 'CHECK_UPDATE_NOW') {
    checkForUpdate(true).then((r) => sendResponse(r || { hasUpdate: false }));
    return true;
  }
  if (msg.action === 'GET_UPDATE_STATUS') {
    chrome.storage.local.get(['update_result','update_dismissed_version'], (data) => {
      const result = data.update_result || { hasUpdate: false, checkedAt: 0 };
      if (result.hasUpdate && data.update_dismissed_version === result.newVersion
          && !result.critical && !result.forceUpdate) {
        result.dismissed = true;
      }
      sendResponse(result);
    });
    return true;
  }
  if (msg.action === 'DISMISS_UPDATE') {
    chrome.storage.local.set({ update_dismissed_version: msg.version }, () => {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.action === 'DOWNLOAD_UPDATE') {
    chrome.downloads.download(
      { url: msg.url, filename: msg.filename || 'uk-listing-optimizer-update.zip', saveAs: true },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ ok: true, downloadId });
        }
      }
    );
    return true;
  }
  if (msg.action === 'DISMISS_UPDATE') {
    chrome.storage.local.set({ update_dismissed_version: msg.version }, () => {
      chrome.action.setBadgeText({ text: '' });
      sendResponse({ ok: true });
    });
    return true;
  }
  if (msg.action === 'CLEAR_BADGE') {
    chrome.action.setBadgeText({ text: '' });
    sendResponse({ ok: true });
    return true;
  }
  if (msg.action === 'OPEN_TAB') {
    chrome.tabs.create({ url: msg.url });
    return false;
  }
  if (msg.action === 'DOWNLOAD_FILE') {
    chrome.downloads.download({ url: msg.url, filename: msg.filename, saveAs: false },
      (id) => sendResponse({ downloadId: id }));
    return true;
  }
  if (msg.action === 'DOWNLOAD_FILE_URL') {
    // Folder mode: download dataURL as file into subfolder of Downloads
    chrome.downloads.download({
      url: msg.dataUrl,
      filename: msg.filename,  // e.g. "UKListing/B0ASIN_0525_1430/product.xlsx"
      saveAs: false,
      conflictAction: 'overwrite',
    }, (id) => {
      if (chrome.runtime.lastError) sendResponse({ ok: false, error: chrome.runtime.lastError.message });
      else sendResponse({ ok: true, downloadId: id });
    });
    return true;
  }
  if (msg.action === 'CONTENT_READY') return false;
});
