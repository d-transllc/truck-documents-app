document.addEventListener('DOMContentLoaded', () => {
  const truckNumber = getTruckNumberFromURL();
  fetchDocumentsForTruck(truckNumber);
});

function getTruckNumberFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get('truck') || 'unknown';
}

function fetchDocumentsForTruck(truckNumber) {
  document.getElementById('documents').innerHTML = `<p>Loading documents for Truck ${truckNumber}...</p>`;

  // 🚧 Placeholder: Here you will connect to SharePoint later
  setTimeout(() => {
    document.getElementById('documents').innerHTML = `
      <div class="document">Document 1 for Truck ${truckNumber}</div>
      <div class="document">Document 2 for Truck ${truckNumber}</div>
    `;
  }, 1000);
}
