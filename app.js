// ============================
// Config
// ============================
const API_BASE =
  location.hostname === "localhost"
    ? "http://localhost:7071/api"
    : "https://truckdocs-api.azurewebsites.net/api";

// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: "68d4740b-7284-4cd5-a815-9bcb595700dc",
    authority: "https://login.microsoftonline.com/e3443973-820a-4d4d-aafd-79c72a25a260",
    redirectUri: "https://d-transllc.github.io/truck-documents-app/",
  },
};
const msalInstance = new msal.PublicClientApplication(msalConfig);

// SharePoint Info
const siteId =
  "dtranslogistics.sharepoint.com,9674680e-afb2-4657-9c35-eeaef132d0ae,a6bbfa8f-3556-4a16-a42b-9d61c176aeea";
const driveId = "b!Dmh0lrKvV0acNe6u8TLQro_6u6ZWNRZKpCudYcF2ruoGU9HaWtzKSqyoi4uMNCzf";

// Storage keys
const DEVICE_ID_KEY = "truckdocs_device_install_id";

// ============================
// Tiny UI helpers (safe on missing elements)
// ============================
const $ = (id) => document.getElementById(id);

function setStatus(message, meta = "") {
  const statusEl = $("status");
  const metaEl = $("statusMeta");

  // Fallback to old UI if you haven't updated HTML yet
  const legacyContainer = $("documents");

  if (statusEl) statusEl.textContent = message;
  if (metaEl) metaEl.textContent = meta;

  // Optional: keep legacy container informative on load
  if (!statusEl && legacyContainer && message) {
    // only write status into legacy container if it is currently empty
    if (!legacyContainer.innerHTML || legacyContainer.innerHTML.trim() === "") {
      legacyContainer.innerHTML = `<p>${escapeHtml(message)}</p>`;
    }
  }
}

function showToast(msg) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => {
    el.style.display = "none";
  }, 2500);
}

function setTruckPill(truckNumber) {
  const pill = $("truckPill");
  if (!pill) return;
  pill.style.display = "inline-flex";
  pill.textContent = `Truck ${truckNumber}`;
}

function setEmptyStateVisible(visible) {
  const empty = $("emptyState");
  if (empty) empty.style.display = visible ? "block" : "none";
}

function openEnrollModal() {
  const modal = $("enrollModal");
  if (!modal) return;
  clearEnrollError();
  modal.style.display = "grid";
  const truckInput = $("truckInput");
  if (truckInput) {
    truckInput.value = truckInput.value || "";
    truckInput.focus();
  }
}

function closeEnrollModal() {
  const modal = $("enrollModal");
  if (!modal) return;
  modal.style.display = "none";
}

function setEnrollError(msg) {
  const err = $("enrollError");
  if (!err) return;
  err.textContent = msg;
  err.style.display = "block";
}

function clearEnrollError() {
  const err = $("enrollError");
  if (!err) return;
  err.textContent = "";
  err.style.display = "none";
}

function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// ============================
// Device ID + networking helpers
// ============================
function getOrCreateDeviceInstallId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    // crypto.randomUUID exists in modern browsers
    if (window.crypto?.randomUUID) {
      id = window.crypto.randomUUID();
    } else {
      // fallback
      id = `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

async function readJsonOrText(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}

async function postJson(path, bodyObj) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bodyObj),
  });
  const data = await readJsonOrText(res);
  return { res, data };
}

// ============================
// Enrollment flow (modal based)
// ============================
async function getTruckNumberForThisTablet() {
  const deviceInstallId = getOrCreateDeviceInstallId();

  setStatus("Checking device assignment…");
  const { res: resolveRes, data: resolveData } = await postJson("/resolveDeviceTruck", {
    deviceInstallId,
  });

  if (!resolveRes.ok) {
    throw new Error(resolveData?.error || `resolveDeviceTruck failed (${resolveRes.status})`);
  }

  if (resolveData?.status === "assigned" && resolveData?.truckNumber) {
    return resolveData.truckNumber;
  }

  // Not assigned yet → use modal (if present) or fallback prompts
  if (!$("enrollModal")) {
    // Legacy fallback: prompts
    const truckNumber = prompt("This tablet is not assigned. Enter Truck Number:");
    if (!truckNumber) throw new Error("Truck number required");
    const pin = prompt("Enter enrollment PIN:");
    if (!pin) throw new Error("PIN required");

    const { res: assignRes, data: assignData } = await postJson("/assignDeviceTruck", {
      deviceInstallId,
      truckNumber,
      pin,
    });

    if (!assignRes.ok || assignData?.status !== "assigned") {
      throw new Error(assignData?.error || "Assignment failed");
    }
    return assignData.truckNumber;
  }

  // Modal-based enrollment:
  window.__pendingEnroll = { deviceInstallId };
  window.__enrolledTruckNumber = null;

  setStatus("This device is not assigned.", "Enter truck number and PIN to continue.");
  openEnrollModal();

  // Wait until the modal submit sets __enrolledTruckNumber
  await new Promise((resolve) => {
    const t = setInterval(() => {
      if (window.__enrolledTruckNumber) {
        clearInterval(t);
        resolve();
      }
    }, 150);
  });

  return window.__enrolledTruckNumber;
}

async function handleEnrollSubmit() {
  try {
    clearEnrollError();

    const deviceInstallId = window.__pendingEnroll?.deviceInstallId || getOrCreateDeviceInstallId();
    const truckNumber = ($("truckInput")?.value || "").trim();
    const pin = ($("pinInput")?.value || "").trim();

    if (!truckNumber) return setEnrollError("Truck number is required.");
    if (!pin) return setEnrollError("PIN is required.");

    setStatus("Assigning device…");

    const { res: assignRes, data: assignData } = await postJson("/assignDeviceTruck", {
      deviceInstallId,
      truckNumber,
      pin,
    });

    if (!assignRes.ok || assignData?.status !== "assigned") {
      return setEnrollError(assignData?.error || "Assignment failed.");
    }

    window.__enrolledTruckNumber = assignData.truckNumber || truckNumber;

    closeEnrollModal();
    showToast(`Assigned to Truck ${window.__enrolledTruckNumber}`);
    setStatus("Assigned successfully.", `Truck ${window.__enrolledTruckNumber}`);
  } catch (e) {
    setEnrollError(e?.message || "Assignment failed.");
  }
}

// ============================
// Auth + SharePoint fetch
// ============================
async function signIn() {
  try {
    setStatus("Signing in…");

    const loginResponse = await msalInstance.loginPopup({
      scopes: ["Sites.Read.All", "User.Read"],
    });

    const account = loginResponse.account;
    msalInstance.setActiveAccount(account);

    const tokenResponse = await msalInstance.acquireTokenSilent({
      scopes: ["Sites.Read.All", "User.Read"],
      account,
    });

    const accessToken = tokenResponse.accessToken;

    // Resolve truck from device
    const truckNumber = await getTruckNumberForThisTablet();
    if (!truckNumber || truckNumber === "Unknown") {
      setStatus("Could not resolve truck assignment.");
      showToast("Could not resolve truck assignment.");
      return;
    }

    setTruckPill(truckNumber);

    await fetchTruckDocuments(truckNumber, accessToken);
  } catch (error) {
    console.error("Login failed:", error);
    setStatus("Login failed.", "Check console or try again.");
    showToast("Login failed.");
  }
}

async function fetchTruckDocuments(truckNumber, accessToken) {
  setStatus(`Loading documents…`, `Truck ${truckNumber}`);

  // New UI container (grid)
  const grid = $("docsContainer");
  // Legacy container (list)
  const legacy = $("documents");

  if (grid) grid.innerHTML = "";
  if (legacy) legacy.innerHTML = `<p>Loading documents for truck ${escapeHtml(truckNumber)}...</p>`;
  setEmptyStateVisible(false);

  try {
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/list/items?expand=fields`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Graph error:", errText);
      const msg = `Error loading documents (HTTP ${response.status})`;
      setStatus(msg);
      if (legacy) legacy.innerHTML = `<p style="color: red;">${escapeHtml(msg)}</p>`;
      showToast("Error loading documents.");
      return;
    }

    const data = await response.json();

    const filteredDocs =
      data.value?.filter((doc) => {
        const assetField = doc.fields?.Asset_x0020_ID;
        const forAllAssets = doc.fields?.For_x0020_All_x0020_Assets === true;

        const matchesTruck =
          assetField === truckNumber ||
          assetField?.LookupValue === truckNumber ||
          assetField?.LookupId == truckNumber ||
          (Array.isArray(assetField) &&
            assetField.some(
              (entry) => entry.LookupValue === truckNumber || entry.LookupId == truckNumber
            ));

        return matchesTruck || forAllAssets;
      }) || [];

    renderDocuments(filteredDocs);
    setStatus("Documents loaded.", `Truck ${truckNumber} • ${filteredDocs.length} document(s)`);

    // Cache PDFs for offline
    await cacheDocuments(filteredDocs, accessToken);
  } catch (err) {
    console.error("Error loading documents:", err);
    setStatus("Error loading documents.");
    if (legacy) legacy.innerHTML = `<p style="color: red;">Error loading documents.</p>`;
    showToast("Error loading documents.");
  }
}

// ============================
// Rendering (modern cards + legacy fallback)
// ============================
function renderDocuments(docs) {
  const grid = $("docsContainer");
  const legacy = $("documents");

  // If modern UI exists, prefer it
  if (grid) {
    grid.innerHTML = "";
    setEmptyStateVisible(!docs || docs.length === 0);

    if (!docs || docs.length === 0) return;

    docs.forEach((doc) => {
      const fileName = doc.fields?.FileLeafRef || doc.name || "Document";
      const isPdf = String(fileName).toLowerCase().endsWith(".pdf");

      const card = document.createElement("div");
      card.className = "doc-card";

      const title = document.createElement("div");
      title.className = "doc-title";
      title.textContent = fileName;

      const meta = document.createElement("div");
      meta.className = "doc-meta";
      meta.textContent = doc.fields?.For_x0020_All_x0020_Assets ? "All Trucks" : "Assigned Truck";

      const actions = document.createElement("div");
      actions.className = "doc-actions";

      // Open button (online)
      if (doc.webUrl) {
        const openBtn = document.createElement("a");
        openBtn.className = "btn";
        openBtn.target = "_blank";
        openBtn.rel = "noopener";
        openBtn.href = doc.webUrl;
        openBtn.textContent = isPdf ? "Open PDF" : "Open";
        actions.appendChild(openBtn);
      }

      // Offline open (cached)
      if (doc.cachedBlob) {
        const offlineBtn = document.createElement("a");
        offlineBtn.className = "btn";
        offlineBtn.target = "_blank";
        offlineBtn.rel = "noopener";
        offlineBtn.href = URL.createObjectURL(doc.cachedBlob);
        offlineBtn.textContent = "Open Offline";
        actions.appendChild(offlineBtn);
      }

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(actions);
      grid.appendChild(card);
    });

    // Also clear legacy container if present
    if (legacy) legacy.innerHTML = "";
    return;
  }

  // Legacy fallback rendering (your original style)
  if (legacy) {
    legacy.innerHTML = "";

    if (!docs || docs.length === 0) {
      legacy.innerHTML = "<p>No documents found for this truck.</p>";
      return;
    }

    docs.forEach((doc) => {
      const link = document.createElement("a");
      link.className = "document";
      link.target = "_blank";

      if (doc.webUrl) {
        link.href = doc.webUrl;
        link.textContent = doc.fields?.FileLeafRef || "Document";
      } else if (doc.cachedBlob) {
        link.href = URL.createObjectURL(doc.cachedBlob);
        link.textContent = doc.name || "Offline Document";
      }

      legacy.appendChild(link);
    });
  }
}

// ============================
// Offline caching (PDFs)
// ============================
async function cacheDocuments(documents, accessToken) {
  try {
    const db = await openDB();
    const tx = db.transaction("docs", "readwrite");
    const store = tx.objectStore("docs");
    await store.clear();

    for (const doc of documents) {
      const fileUrl = doc.webUrl;
      const fileName = doc.fields?.FileLeafRef;

      if (fileUrl && fileName && String(fileName).toLowerCase().endsWith(".pdf")) {
        try {
          // NOTE: doc.webUrl may not always accept Authorization header.
          // If this ever fails, we can switch to Graph driveItem content download.
          const fileRes = await fetch(fileUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const blob = await fileRes.blob();
          await store.put({ name: fileName, cachedBlob: blob });
        } catch {
          console.warn("Failed to cache:", fileName);
        }
      }
    }

    await tx.done;
    db.close();
  } catch (e) {
    console.warn("Caching skipped:", e?.message || e);
  }
}

async function loadCachedDocuments() {
  setStatus("Offline mode.", "Loading cached documents…");

  const db = await openDB();
  const tx = db.transaction("docs", "readonly");
  const store = tx.objectStore("docs");
  const cached = await store.getAll();

  const docs = cached.map((d) => ({
    name: d.name,
    cachedBlob: d.cachedBlob,
  }));

  renderDocuments(docs);
  setStatus("Offline documents loaded.", `${docs.length} cached PDF(s)`);
  db.close();
}

async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("truckDocs", 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("docs")) {
        db.createObjectStore("docs", { keyPath: "name" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ============================
// DOM Ready wiring
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // Offline banner (legacy)
  const banner = $("offline-banner");
  const updateBanner = () => {
    if (banner) banner.style.display = navigator.onLine ? "none" : "block";
  };
  updateBanner();
  window.addEventListener("online", updateBanner);
  window.addEventListener("offline", updateBanner);

  // Sign-in button (new + legacy)
  const signInBtn = $("signInBtn") || $("signin-btn");
  if (signInBtn) {
    signInBtn.addEventListener("click", async () => {
      try {
        // if offline -> show cached docs
        if (!navigator.onLine) return loadCachedDocuments();

        // Clear legacy container for nicer UX
        const legacy = $("documents");
        if (legacy) legacy.innerHTML = "";

        await signIn();
      } catch (e) {
        console.error(e);
        showToast("Something went wrong.");
      }
    });
  }

  // Enrollment modal wiring (if present)
  if ($("enrollModal")) {
    const closeBtn = $("enrollClose");
    if (closeBtn) closeBtn.addEventListener("click", closeEnrollModal);

    const backdrop = document.querySelector("#enrollModal .modal-backdrop");
    if (backdrop) backdrop.addEventListener("click", closeEnrollModal);

    const submitBtn = $("enrollSubmit");
    if (submitBtn) submitBtn.addEventListener("click", handleEnrollSubmit);

    // Enter key submits
    const pinInput = $("pinInput");
    if (pinInput) {
      pinInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") handleEnrollSubmit();
      });
    }
  }

  setStatus("Ready.");
});