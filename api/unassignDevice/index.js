// Polyfill global crypto for Azure SDK in Functions runtime
const nodeCrypto = require("crypto");
global.crypto = global.crypto || nodeCrypto.webcrypto;

const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  // Declare outside try so catch blocks can reference it safely
  let deviceInstallId = "";

  try {
    // RowKey is the deviceInstallId GUID
    deviceInstallId = (req.query.deviceInstallId || req.body?.deviceInstallId || "").trim();
    if (!deviceInstallId) {
      context.res = { status: 400, body: "Missing deviceInstallId" };
      return;
    }

    // Keep env var usage consistent with assignDeviceTruck / resolveDeviceTruck
    const conn = process.env.DEVICE_MAP_STORAGE_CONNECTION || process.env.AzureWebJobsStorage;
    const tableName = process.env.DEVICE_MAP_TABLE || "DeviceTruckMap";
    if (!conn) {
      context.res = { status: 500, body: "Missing DEVICE_MAP_STORAGE_CONNECTION (or AzureWebJobsStorage)" };
      return;
    }

    const table = TableClient.fromConnectionString(conn, tableName);

    const partitionKey = "DEVICE";
    const rowKey = deviceInstallId;
    context.log("unassignDevice lookup", { partitionKey, rowKey });

    const entity = await table.getEntity(partitionKey, rowKey);

    // Clear assignment
    entity.truckNumber = "";
    entity.updatedAt = new Date().toISOString();

    await table.updateEntity(entity, "Merge");

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, deviceInstallId, message: "Device unassigned." },
    };
  } catch (err) {
    if (err?.statusCode === 404) {
      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: { ok: true, deviceInstallId, message: "Device was not assigned." },
      };
      return;
    }

    context.log.error(err);
    context.res = { status: 500, body: "Server error" };
  }
};