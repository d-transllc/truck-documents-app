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
    const response = await fetch(`https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/root/children`, {
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    const data = await response.json();

    // Filter documents by truck number
    const documents = data.value.filter(doc => doc.name.includes(truckNumber));

    renderDocuments(documents);
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
        const link = document.createElement('a');
        link.href = doc.webUrl;
        link.textContent = doc.name;
        link.target = '_blank';
        link.className = 'document';
        container.appendChild(link);
    });
}
