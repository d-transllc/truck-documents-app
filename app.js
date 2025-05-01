// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: '68d4740b-7284-4cd5-a815-9bcb595700dc',
    authority: 'https://login.microsoftonline.com/e3443973-820a-4d4d-aafd-79c72a25a260',
    redirectUri: window.location.origin
  }
};

const msalInstance = new msal.PublicClientApplication(msalConfig);

// SharePoint Site and Drive Info
const siteId = 'dtranslogistics.sharepoint.com,9674680e-afb2-4657-9c35-eeaef132d0ae,a6bbfa8f-3556-4a16-a42b-9d61c176aeea';
const driveId = 'b!Dmh0lrKvV0acNe6u8TLQro_6u6ZWNRZKpCudYcF2ruoGU9HaWtzKSqyoi4uMNCzf';

// DOM Ready
document.addEventListener('DOMContentLoaded', () => {
  const signInButton = document.getElementById('signin-btn');

  signInButton.addEventListener('click', async () => {
    console.log("Sign in button clicked");
    await signIn();
  });
});

// Microsoft Sign-In
async function signIn() {
  try {
    console.log("Launching MSAL login popup...");

    const loginResponse = await msalInstance.loginPopup({
      scopes: ["Sites.Read.All", "User.Read"]
    });

    console.log("Login success:", loginResponse);

    const account = loginResponse.account;
    msalInstance.setActiveAccount(account);

    const tokenResponse = await msalInstance.acquireTokenSilent({
      scopes: ["Sites.Read.All", "User.Read"],
      account: account
    });

    const accessToken = tokenResponse.accessToken;

    // Extract user's full name
    const fullName = account.name;
    console.log("Signed in as:", fullName);

    const truckNumber = await getTruckFromDriver(fullName);

    if (!truckNumber || truckNumber === "Unknown") {
      alert("Could not find your assigned truck.");
      return;
    }

    fetchTruckDocuments(truckNumber, accessToken);
  } catch (error) {
    console.error("Login failed:", error);
  }
}

// Azure Function to get assigned truck
async function getTruckFromDriver(driverName) {
  try {
    const response = await fetch(`https://truckdocs-api.azurewebsites.net/api/getAssignedTruck?driver=${encodeURIComponent(driverName)}`);
    const data = await response.json();

    console.log("Truck lookup raw response:", data);
    return data.truckNumber;
  } catch (error) {
    console.error("Error fetching truck assignment:", error);
    return null;
  }
}

// Fetch SharePoint documents
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

		const filteredDocs = data.value?.filter(doc => {
		  const assetField = doc.fields?.Asset_x0020_ID;
		  const forAllAssets = doc.fields?.ForAllAssets;

		  const matchesTruck = (
			assetField === truckNumber ||
			assetField?.LookupValue === truckNumber ||
			assetField?.LookupId == truckNumber ||
			(
			  Array.isArray(assetField) &&
			  assetField.some(entry =>
				entry.LookupValue === truckNumber || entry.LookupId == truckNumber
			  )
			)
		  );

  const isForAllAssets = forAllAssets === "Yes";

  return matchesTruck || isForAllAssets;
}) || [];

    renderDocuments(filteredDocs);
  } catch (err) {
    console.error("Error fetching or parsing documents:", err);
    documentsContainer.innerHTML = `<p style="color: red;">Error loading documents.</p>`;
  }
}

// Render documents
function renderDocuments(documents) {
  const container = document.getElementById('documents');
  container.innerHTML = '';

  if (documents.length === 0) {
    container.innerHTML = '<p>No documents found for this truck.</p>';
    return;
  }

  documents.forEach(doc => {
    const file = doc.webUrl;
    const name = doc.fields?.FileLeafRef || 'Unnamed Document';

    const link = document.createElement('a');
    link.href = file;
    link.textContent = name;
    link.target = '_blank';
    link.className = 'document';
    container.appendChild(link);
  });
}
