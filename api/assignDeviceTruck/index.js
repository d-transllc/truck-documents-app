// Polyfill global crypto for Azure SDK in Functions runtime
const nodeCrypto = require("crypto");
global.crypto = global.crypto || nodeCrypto.webcrypto;

const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const { deviceInstallId, truckNumber, pin } = req.body || {};

    if (!deviceInstallId || !truckNumber) {
      context.res = { status: 400, body: { error: "Missing deviceInstallId or truckNumber" } };
      return;
    }

    // Enrollment PIN removed — do not require pin
    // (You can keep DEVICE_ENROLL_PIN in settings; it will simply be ignored.)

    const conn = process.env.DEVICE_MAP_STORAGE_CONNECTION;
    const tableName = process.env.DEVICE_MAP_TABLE || "DeviceTruckMap";
    if (!conn) {
      context.res = { status: 500, body: { error: "Missing DEVICE_MAP_STORAGE_CONNECTION" } };
      return;
    }

    const client = TableClient.fromConnectionString(conn, tableName);

    // Upsert mapping
    await client.upsertEntity(
      {
        partitionKey: "DEVICE",
        rowKey: deviceInstallId,
        truckNumber: String(truckNumber),
        updatedAt: new Date().toISOString()
      },
      "Replace"
    );

    context.res = { status: 200, body: { status: "assigned", truckNumber: String(truckNumber) } };
  } catch (err) {
    context.log("assignDeviceTruck error:", err);
    context.res = { status: 500, body: { error: "Internal server error" } };
  }
};