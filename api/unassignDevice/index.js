const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    const deviceId = (req.query.deviceId || req.body?.deviceId || "").trim();
    if (!deviceId) {
      context.res = { status: 400, body: "Missing deviceId" };
      return;
    }

    const conn = process.env.AzureWebJobsStorage;
    const tableName = "DeviceTruckMap";
    const table = TableClient.fromConnectionString(conn, tableName);

    // IMPORTANT: use the same PartitionKey/RowKey scheme your app uses.
    // Common patterns:
    // PartitionKey: "Device", RowKey: deviceId
    const partitionKey = "Device";
    const rowKey = deviceId;

    // Read existing entity so we don’t accidentally create bad shapes
    const entity = await table.getEntity(partitionKey, rowKey);

    // Clear assignment
    entity.truckNumber = "";
    entity.assignedTruck = "";
    entity.isAssigned = false;
    entity.updatedAt = new Date().toISOString();

    // Merge update
    await table.updateEntity(entity, "Merge");

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, deviceId, message: "Device unassigned." },
    };
  } catch (err) {
    // If not found, return a friendly message
    if (err.statusCode === 404) {
      context.res = { status: 404, body: "Device not found in DeviceTruckMap" };
      return;
    }

    context.log.error(err);
    context.res = { status: 500, body: "Server error" };
  }
};