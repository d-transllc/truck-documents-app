// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: '68d4740b-7284-4cd5-a815-9bcb595700dc',
    authority: 'https://login.microsoftonline.com/e3443973-820a-4d4d-aafd-79c72a25a260',
    redirectUri: 'https://d-transllc.github.io/truck-documents-app/'
  }
};
const msalInstance = new msal.PublicClientApplication(msalConfig);

// SharePoint Info
const siteId = 'dtranslogistics.sharepoint.com,9674680e-afb2-4657-9c35-eeaef132d0ae,a6bbfa8f-3556-4a16-a42b-9d61c176aeea';
const driveId = 'b!Dmh0lrKvV0acNe6u8TLQro_6u6ZWNRZKpCudYcF2ruoGU9HaWtzKSqyoi4uMNCzf';

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('offline-banner');
  const updateBanner = () => banner.style.display = navigator.onLine ? 'none' : 'block';
  updateBanner();
  window.addEventListener('online', updateBanner);
  window.addEventListener('offline', updateBanner);

  document.getElementById('signin-btn').addEventListener('click', async () => {
    if (!navigator.onLine) {
      loadCachedDocuments();
    } else {
      await signIn();
    }
  });
});

// Microsoft Sign-In
async function signIn() {
  try {
    const loginResponse = await msalInstance.loginPopup({
      scopes: ["Sites.Read.All", "User.Read"]
    });

    const account = loginResponse.account;
    msalInstance.setActiveAccount(account);

    const tokenResponse = await msalInstance.acquireTokenSilent({
      scopes: ["Sites.Read.All", "User.Read"],
      account
    });

    const accessToken = tokenResponse.accessToken;
    const fullName = account.name;

    const truckNumber = await getTruckFromDriver(fullName);
    if (!truckNumber || truckNumber === "Unknown") {
      alert("Could not find your assigned truck.");
      return;
    }

    fetchTruckDocuments(truckNumber, accessToken);
  } catch (error) {
    console.error("Login failed:", error);
    alert("Login failed. Check console for details.");
  }
}

// Azure Function: Get truck from driver name
async function getTruckFromDriver(driverName) {
  try {
    const response = await fetch(`https://truckdocs-api.azurewebsites.net/api/getAssignedTruck?driver=${encodeURIComponent(driverName)}`);
    const data = await response.json();
    return data.truckNumber;
  } catch (error) {
    console.error("Truck lookup error:", error);
    return null;
  }
}

// Fetch from SharePoint + cache
async function fetchTruckDocuments(truckNumber, accessToken) {
  const container = document.getElementById('documents');
  container.innerHTML = `<p>Loading documents for truck ${truckNumber}...</p>`;

  try {
    const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/list/items?expand=fields`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Graph error:", errText);
      container.innerHTML = `<p style="color: red;">Error loading documents (HTTP ${response.status})</p>`;
      return;
    }

    const data = await response.json();
    const filteredDocs = data.value?.filter(doc => {
      const assetField = doc.fields?.Asset_x0020_ID;
      const forAllAssets = doc.fields?.For_x0020_All_x0020_Assets === true;

      const matchesTruck = (
        assetField === truckNumber ||
        assetField?.LookupValue === truckNumber ||
        assetField?.LookupId == truckNumber ||
        (Array.isArray(assetField) &&
          assetField.some(entry => entry.LookupValue === truckNumber || entry.LookupId == truckNumber))
      );

      return matchesTruck || forAllAssets;
    }) || [];

    renderDocuments(filteredDocs);
    await cacheDocuments(filteredDocs, accessToken);
  } catch (err) {
    console.error("Error loading documents:", err);
    container.innerHTML = `<p style="color: red;">Error loading documents.</p>`;
  }
}

// Render documents
function renderDocuments(docs) {
  const container = document.getElementById('documents');
  container.innerHTML = '';

  if (docs.length === 0) {
    container.innerHTML = '<p>No documents found for this truck.</p>';
    return;
  }

  docs.forEach(doc => {
    const link = document.createElement('a');
    link.className = 'document';
    link.target = '_blank';

    if (doc.webUrl) {
      link.href = doc.webUrl;
      link.textContent = doc.fields?.FileLeafRef || 'Document';
    } else if (doc.cachedBlob) {
      link.href = URL.createObjectURL(doc.cachedBlob);
      link.textContent = doc.name || 'Offline Document';
    }

    container.appendChild(link);
  });
}

// Cache to IndexedDB
async function cacheDocuments(documents, accessToken) {
  const db = await openDB();
  const tx = db.transaction('docs', 'readwrite');
  const store = tx.objectStore('docs');
  await store.clear();

  for (const doc of documents) {
    const fileUrl = doc.webUrl;
    const fileName = doc.fields?.FileLeafRef;
    if (fileUrl?.endsWith('.pdf')) {
      try {
        const fileRes = await fetch(fileUrl, {
          headers: { Authorization: `Bearer ${accessToken}` }
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
}

// Load from cache
async function loadCachedDocuments() {
  const db = await openDB();
  const tx = db.transaction('docs', 'readonly');
  const store = tx.objectStore('docs');
  const cached = await store.getAll();
  renderDocuments(cached.map(doc => ({
    name: doc.name,
    cachedBlob: doc.cachedBlob
  })));
  db.close();
}

// IndexedDB helper
async function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('truckDocs', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('docs')) {
        db.createObjectStore('docs', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
