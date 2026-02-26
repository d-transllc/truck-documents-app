// Polyfill global crypto for Azure SDK in Functions runtime
const nodeCrypto = require("crypto");
global.crypto = global.crypto || nodeCrypto.webcrypto;

const { TableClient } = require("@azure/data-tables");

// Env vars needed:
// DEVICE_MAP_STORAGE_CONNECTION (storage connection string)
// DEVICE_MAP_TABLE (e.g. "DeviceTruckMap")

module.exports = async function (context, req) {
  try {
    const { deviceInstallId } = req.body || {};
    if (!deviceInstallId) {
      context.res = { status: 400, body: { error: "Missing deviceInstallId" } };
      return;
    }

    const conn = process.env.DEVICE_MAP_STORAGE_CONNECTION;
    const tableName = process.env.DEVICE_MAP_TABLE || "DeviceTruckMap";
    if (!conn) {
      context.res = { status: 500, body: { error: "Missing DEVICE_MAP_STORAGE_CONNECTION" } };
      return;
    }

    const client = TableClient.fromConnectionString(conn, tableName);

    // PartitionKey "DEVICE" keeps it simple
    try {
      const entity = await client.getEntity("DEVICE", deviceInstallId);
      context.res = { status: 200, body: { status: "assigned", truckNumber: entity.truckNumber } };
    } catch (err) {
      // Not found
      context.res = { status: 200, body: { status: "unassigned" } };
    }
  } catch (err) {
    context.log("resolveDeviceTruck error:", err);
    context.res = { status: 500, body: { error: "Internal server error" } };
  }
};