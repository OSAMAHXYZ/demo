/** Shared browser store: Admin Push → Live Sales Report */
(function (global) {
  const DB_NAME = "toyota_report_sheet_v1";
  const DB_VERSION = 1;
  const STORE = "kv";
  const WORKBOOK_KEY = "workbook_files_v1";
  const DATA_PUSH_KEY = "toyota_admin_workbook_push_v1";
  const TARGETS_KEY = "toyota_admin_employee_targets_v1";
  const TARGETS_PUSH_KEY = "toyota_admin_employee_targets_push_v1";
  const ACCESSORIES_SETTLED_KEY = "toyota_admin_accessories_settled_v1";
  const ACCESSORIES_SETTLED_PUSH_KEY = "toyota_admin_accessories_settled_push_v1";
  const WORKING_DAYS_KEY = "toyota_admin_working_days_v1";
  const WORKING_DAYS_PUSH_KEY = "toyota_admin_working_days_push_v1";
  const CHANNEL = "toyota_targets_live";

  const SLOT_IDS = ["backorder", "rtl", "central", "sales", "cancelled", "accessories"];

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  function idbGet(key) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readonly");
          const req = tx.objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        })
    );
  }

  function idbSet(key, value) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  function idbDelete(key) {
    return openDb().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        })
    );
  }

  /**
   * @param {Record<string, { name: string, buffer: ArrayBuffer }|null>} filesBySlot
   */
  async function saveWorkbookFiles(filesBySlot) {
    const files = {};
    SLOT_IDS.forEach((id) => {
      const f = filesBySlot[id];
      if (f && f.buffer) {
        files[id] = { name: f.name || id, buffer: f.buffer, size: f.buffer.byteLength };
      }
    });
    const stamp = {
      at: Date.now(),
      slots: Object.keys(files),
      hasSales: !!files.sales,
      hasCancelled: !!files.cancelled,
    };
    await idbSet(WORKBOOK_KEY, { at: stamp.at, files });
    localStorage.setItem(DATA_PUSH_KEY, JSON.stringify(stamp));
    return stamp;
  }

  async function loadWorkbookFiles() {
    const payload = await idbGet(WORKBOOK_KEY);
    if (!payload || !payload.files) return null;
    return payload;
  }

  async function clearWorkbookFiles() {
    await idbDelete(WORKBOOK_KEY);
    localStorage.removeItem(DATA_PUSH_KEY);
  }

  function readDataPushStamp() {
    try {
      return JSON.parse(localStorage.getItem(DATA_PUSH_KEY) || "{}");
    } catch {
      return {};
    }
  }

  function broadcast(message) {
    if (!("BroadcastChannel" in global)) return;
    try {
      const bc = new BroadcastChannel(CHANNEL);
      bc.postMessage(message);
      bc.close();
    } catch {
      /* ignore */
    }
  }

  global.ReportSheetStore = {
    SLOT_IDS,
    WORKBOOK_KEY,
    DATA_PUSH_KEY,
    TARGETS_KEY,
    TARGETS_PUSH_KEY,
    ACCESSORIES_SETTLED_KEY,
    ACCESSORIES_SETTLED_PUSH_KEY,
    WORKING_DAYS_KEY,
    WORKING_DAYS_PUSH_KEY,
    CHANNEL,
    saveWorkbookFiles,
    loadWorkbookFiles,
    clearWorkbookFiles,
    readDataPushStamp,
    broadcast,
  };
})(typeof window !== "undefined" ? window : globalThis);
