// ============================
// Config
// ============================
const API_BASE =
  location.hostname === "localhost"
    ? "http://localhost:7071/api"
    : "https://truckdocs-api.azurewebsites.net/api";

const DEVICE_ID_KEY = "truckdocs_device_install_id";

// ============================
// Small helpers
// ============================
function $(id) {
  return document.getElementById(id);
}

function setStatus(message) {
  const el = $("status") || $("status-text");
  if (el) el.textContent = message;
  console.log("[status]", message);
}

function showError(message) {
  console.error(message);
  alert(message);
}

async function readJsonOrText(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text || `HTTP ${res.status}` };
  }
}

function getOrCreateDeviceInstallId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    if (window.crypto?.randomUUID) {
      id = crypto.randomUUID();
    } else {
      id = `dev_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

// ============================
// Device -> Truck resolution (PIN enrollment)
// ============================
async function getTruckNumberForThisDevice() {
  const deviceInstallId = getOrCreateDeviceInstallId();

  // 1) Resolve
  const resolveRes = await fetch(`${API_BASE}/resolveDeviceTruck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceInstallId }),
  });

  const resolveData = await readJsonOrText(resolveRes);

  if (!resolveRes.ok) {
    throw new Error(resolveData?.error || `resolveDeviceTruck failed (${resolveRes.status})`);
  }

  if (resolveData?.status === "assigned" && resolveData?.truckNumber) {
    return resolveData.truckNumber;
  }

  // 2) Not assigned -> prompt for Truck + PIN
  const truckNumber = prompt("This tablet is not assigned.\nEnter Truck Number:");
  if (!truckNumber) throw new Error("Truck number required");

  const pin = prompt("Enter enrollment PIN:");
  if (!pin) throw new Error("PIN required");

  const assignRes = await fetch(`${API_BASE}/assignDeviceTruck`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deviceInstallId, truckNumber: truckNumber.trim(), pin: pin.trim() }),
  });

  const assignData = await readJsonOrText(assignRes);

  if (!assignRes.ok || assignData?.status !== "assigned") {
    throw new Error(assignData?.error || "Assignment failed");
  }

  return assignData.truckNumber || truckNumber.trim();
}

// ============================
// Fetch + Render Docs (no MSAL; API does Graph auth server-side)
// ============================
async function fetchTruckDocuments(truckNumber) {
  const container = $("documents") || $("docsContainer");
  if (container) container.innerHTML = "";
  setStatus(`Loading documents for Truck ${truckNumber}…`);

  const res = await fetch(`${API_BASE}/getTruckDocuments?truck=${encodeURIComponent(truckNumber)}`);
  const data = await readJsonOrText(res);

  if (!res.ok) {
    throw new Error(data?.error || `getTruckDocuments failed (${res.status})`);
  }

  const docs = Array.isArray(data) ? data : data?.documents || data?.value || data || [];
  renderDocuments(docs);

  setStatus(`Loaded ${docs.length} document(s) for Truck ${truckNumber}`);
}

function buildViewerUrl(url) {
  // Best-effort: hide some PDF UI in some viewers (browser dependent)
  // This does NOT guarantee no download UI in Safari/Chrome PDF viewers,
  // but it avoids adding any "download" behavior from your app.
  if (typeof url === "string" && url.toLowerCase().includes(".pdf")) {
    if (!url.includes("#")) return `${url}#toolbar=0&navpanes=0&scrollbar=0`;
  }
  return url;
}

function openInViewer(url, title, fallbackDownloadUrl) {
  if (!url && fallbackDownloadUrl) url = fallbackDownloadUrl;

  const modal = document.getElementById("viewerModal");
  const frame = document.getElementById("viewerFrame");
  const titleEl = document.getElementById("viewerTitle");
  const openNewTabBtn = document.getElementById("viewerOpenNewTab");

  if (!url) {
    alert("No viewable URL for this document.");
    return;
  }

  // Update UI
  if (titleEl) titleEl.textContent = title || "Document";
  if (openNewTabBtn) {
    openNewTabBtn.onclick = () => window.open(url, "_blank", "noopener,noreferrer");
  }

  // If we don't have modal elements, just open a new tab
  if (!modal || !frame) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }

  // Show modal
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  // Try iframe first
  frame.src = buildViewerUrl(url);

  // If iframe fails due to X-Frame-Options/CSP/attachment, user can still open new tab.
  // Some browsers won't fire a useful error event; so we just keep the "Open in new tab" available.
}

function closeViewer() {
  const modal = $("viewerModal");
  const frame = $("viewerFrame");
  if (!modal || !frame) return;

  frame.src = "about:blank";
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function renderDocuments(docs) {
  const container = $("documents") || $("docsContainer");
  if (!container) return;

  container.innerHTML = "";

  const empty = $("emptyState");
  if (!docs || docs.length === 0) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  docs.forEach((doc) => {
    const name = doc?.name || "Document";

    // ✅ NEW: Use your Azure Function "inline viewer" endpoint.
    // This should return the PDF bytes with:
    // Content-Disposition: inline
    const viewUrl = doc?.driveItemId
      ? `/api/viewTruckDocument?itemId=${encodeURIComponent(doc.driveItemId)}`
      : null;

    const card = document.createElement("div");
    card.className = "doc-card";

    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = name;

    const meta = document.createElement("div");
    meta.className = "doc-meta";
    meta.textContent = viewUrl ? "Ready" : "Missing driveItemId";

    const actions = document.createElement("div");
    actions.className = "doc-actions";

    if (viewUrl) {
      // Use an <a> so browsers treat it as a normal document navigation
      // (this avoids iframe/CSP issues and is the most reliable way to view PDFs)
      const openLink = document.createElement("a");
      openLink.className = "btn btn-primary";
      openLink.textContent = "Open";
      openLink.href = viewUrl;
      openLink.target = "_blank";
      openLink.rel = "noopener noreferrer";
      actions.appendChild(openLink);
    } else {
      const disabled = document.createElement("button");
      disabled.className = "btn";
      disabled.type = "button";
      disabled.textContent = "Open";
      disabled.disabled = true;
      actions.appendChild(disabled);
    }

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    container.appendChild(card);
  });
}

// ============================
// Button click
// ============================
async function handleButtonClick() {
  try {
    setStatus("Resolving this device’s truck assignment…");

    const truckNumber = await getTruckNumberForThisDevice();

    // Optional: show truck somewhere if you have an element
    const truckEl = $("truckNumber") || $("truckPill");
    if (truckEl) {
      truckEl.textContent = `Truck ${truckNumber}`;
      truckEl.style.display = "inline-flex";
    }

    await fetchTruckDocuments(truckNumber);
  } catch (err) {
    setStatus("Error.");
    showError(err?.message || String(err));
  }
}

// ============================
// DOM Ready wiring
// ============================
document.addEventListener("DOMContentLoaded", () => {
  // Use your existing button id
  const btn = $("signin-btn") || $("signInBtn") || $("loadDocsBtn");
  if (btn) {
    btn.addEventListener("click", handleButtonClick);
  } else {
    console.warn("No button found. Add an element with id='signin-btn' (or signInBtn).");
  }

  // Viewer close button
  $("viewerClose")?.addEventListener("click", closeViewer);

  // Escape closes viewer
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeViewer();
  });

  setStatus("Ready.");
});