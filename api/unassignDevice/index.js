const { TableClient } = require("@azure/data-tables");

module.exports = async function (context, req) {
  try {
    // ✅ your RowKey is the deviceInstallId GUID
    const deviceInstallId = (req.query.deviceInstallId || req.body?.deviceInstallId || "").trim();
    if (!deviceInstallId) {
      context.res = { status: 400, body: "Missing deviceInstallId" };
      return;
    }

    const conn = process.env.AzureWebJobsStorage;
    const table = TableClient.fromConnectionString(conn, "DeviceTruckMap");

    // ✅ must match your actual PartitionKey exactly (case-sensitive)
    const partitionKey = "DEVICE";
    const rowKey = deviceInstallId;
    context.log("unassignDevice lookup", { partitionKey, rowKey });

    const entity = await table.getEntity(partitionKey, rowKey);

    // ✅ clear assignment (keep schema simple)
    entity.truckNumber = "";
    entity.updatedAt = new Date().toISOString();

    await table.updateEntity(entity, "Merge");

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { ok: true, deviceInstallId, message: "Device unassigned." },
    };
  } catch (err) {
    if (err.statusCode === 404) {
      // Treat "not found" as already unassigned (prevents confusing errors)
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