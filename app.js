// MSAL Configuration
const msalConfig = {
    auth: {
        clientId: '68d4740b-7284-4cd5-a815-9bcb595700dc', // 👈 Replace this
        authority: 'https://login.microsoftonline.com/e3443973-820a-4d4d-aafd-79c72a25a260', // 👈 Replace this
        redirectUri: window.location.origin
    }
};

const msalInstance = new msal.PublicClientApplication(msalConfig);

// Your SharePoint Site and Drive info
const siteId = 'ff34a865-1114-4f76-93b3-45b3aec4d2f3,23c86a65-87e3-4faa-93b6-2437e77952b2';   // 👈 Replace this
const driveId = 'b!Zag0_xQRdk-Ts0WzrsTS82VqyCPjh6pPk7YkN-d5UrIrYIF-HAxgRYPmSOFM6jJZ'; // 👈 Replace this

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
    const signInButton = document.getElementById('signin-btn');
    signInButton.addEventListener('click', async () => {
        const driverName = document.getElementById('driver-name').value.trim();
        if (!driverName) {
            alert("Please enter your name.");
            return;
        }

        const truckNumber = await getTruckFromDriver(driverName);
        if (!truckNumber) {
            alert("Could not find your assigned truck.");
            return;
        }

        const accessToken = await signIn(); // MSAL
        if (accessToken) {
            fetchTruckDocuments(truckNumber, accessToken);
        }
    });
});

// On page load
document.addEventListener('DOMContentLoaded', async () => {
    const truckNumber = getTruckNumberFromURL();
    const accessToken = await signIn();
    if (accessToken) {
        fetchTruckDocuments(truckNumber, accessToken);
    }
});

// Helper: Get Truck Number from URL
function getTruckNumberFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('truck') || 'unknown';
}

// Calls your backend, which talks to Samsara
async function getTruckFromDriver(driverName) {
    try {
        const response = await fetch(`https://truckdocs-api.azurewebsites.net/api/getAssignedTruck?driver=${encodeURIComponent(driverName)}`);
        const data = await response.json();
        return data.truckNumber; // Make sure your backend returns { truckNumber: "1577" }
    } catch (error) {
        console.error("Error fetching truck assignment:", error);
        return null;
    }
}

// MSAL Sign-In
async function signIn() {
    try {
        const loginResponse = await msalInstance.loginPopup({
            scopes: ["Sites.Read.All"]
        });
        console.log("Login Success", loginResponse);
        const account = loginResponse.account;
        msalInstance.setActiveAccount(account);

        const tokenResponse = await msalInstance.acquireTokenSilent({
            scopes: ["Sites.Read.All"],
            account: account
        });

        return tokenResponse.accessToken;
    } catch (error) {
        console.error("Login Failed", error);
        return null;
    }
}

// Fetch Truck Documents from SharePoint
async function fetchTruckDocuments(truckNumber, accessToken) {
    const documentsContainer = document.getElementById('documents');
    documentsContainer.innerHTML = `<p>Loading documents for truck ${truckNumber}...</p>`;

    try {
        const url = `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/list/items?expand=fields`;
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        console.log("Fetch status:", response.status); // ✅ NEW

        const data = await response.json();

        // ✅ Debug
        if (!data || !data.value) {
            console.warn("Graph returned no value property:", data);
        } else {
            console.log("Raw Graph response:", JSON.stringify(data.value, null, 2));
        }

        const filteredDocs = data.value?.filter(doc => {
            const field = doc.fields?.Asset_x0020_ID;
            if (!field) return false;

            if (Array.isArray(field)) {
                return field.some(entry =>
                    entry.LookupValue === truckNumber || entry.LookupId == truckNumber
                );
            }

            return field === truckNumber || field?.LookupValue === truckNumber || field?.LookupId == truckNumber;
        }) || [];

        renderDocuments(filteredDocs);
    } catch (err) {
        console.error("Error fetching or parsing documents:", err);
        documentsContainer.innerHTML = `<p style="color: red;">Error loading documents.</p>`;
    }
}

// Display Documents
function renderDocuments(documents) {
    const container = document.getElementById('documents');
    container.innerHTML = '';

    if (documents.length === 0) {
        container.innerHTML = '<p>No documents found for this truck.</p>';
        return;
    }

    documents.forEach(doc => {
        const file = doc.webUrl; // webUrl of the file
        const name = doc.fields?.FileLeafRef || 'Unnamed Document';

        const link = document.createElement('a');
        link.href = file;
        link.textContent = name;
        link.target = '_blank';
        link.className = 'document';
        container.appendChild(link);
    });
}
