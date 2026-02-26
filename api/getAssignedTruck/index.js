const https = require('https');

module.exports = async function (context, req) {
  const driverName = req.query.driver;
  const SAMSARA_API_TOKEN = process.env.SAMSARA_API_TOKEN;
  if (!SAMSARA_API_TOKEN) {
    context.log("Missing SAMSARA_API_TOKEN");
    context.res = { status: 500, body: "Server misconfiguration" };
    return;
  }

  if (!driverName) {
    context.res = {
      status: 400,
      body: "Missing driver parameter"
    };
    return;
  }

  try {
    // Step 1: Get all drivers
    const driversData = await fetchFromSamsara("/fleet/drivers?limit=100", SAMSARA_API_TOKEN);
    const matchedDriver = driversData.data?.find(d =>
      d.name.toLowerCase().includes(driverName.toLowerCase())
    );

    if (!matchedDriver) {
      context.res = {
        status: 404,
        body: { error: "Driver not found" }
      };
      return;
    }

    context.log("Matched driver:", matchedDriver.name, matchedDriver.id);

    // Step 2: Get all HOS driver-vehicle assignments
    const assignmentsData = await fetchFromSamsara(
      "/fleet/driver-vehicle-assignments?filterBy=drivers&assignmentType=HOS",
      SAMSARA_API_TOKEN
    );

    const assignmentList = assignmentsData.data || [];
    context.log("Assignment count (HOS only):", assignmentList.length);

    // Filter for this specific driver
    const assignment = assignmentList.find(a =>
      a.driver?.id === matchedDriver.id && a.vehicle?.id
    );

    if (!assignment) {
      context.res = {
        status: 404,
        body: { error: "Driver not currently assigned to a vehicle" }
      };
      return;
    }

    const truckNumber = assignment.vehicle.externalIds?.assetId || assignment.vehicle.name || "Unknown";
    context.log("Assigned truckNumber:", truckNumber);

    context.res = {
      status: 200,
      body: { truckNumber }
    };
  } catch (error) {
    context.log("Error:", error.message || error);
    context.res = {
      status: 500,
      body: { error: "Internal server error" }
    };
  }
};

// Helper function to call Samsara API
function fetchFromSamsara(path, apiKey) {
  const options = {
    hostname: 'api.samsara.com',
    path,
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    }
  };

  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(new Error("Invalid JSON response from Samsara"));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}