module.exports = async function (context, myTimer) {
  const SAMSARA_API_TOKEN = process.env["SAMSARA_API_TOKEN"];
  const GRAPH_CLIENT_ID = process.env["GRAPH_CLIENT_ID"];
  const GRAPH_CLIENT_SECRET = process.env["GRAPH_CLIENT_SECRET"];
  const GRAPH_TENANT_ID = process.env["GRAPH_TENANT_ID"];
  const FUNCTION_HOST = process.env["FUNCTION_HOST"];
  const TRUCKDOCS_USER_ID = process.env["TRUCKDOCS_USER_ID"];
  const TEST_DRIVER_NAME = "Test Driver";

  const now = new Date();
  const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
  const url = `https://api.samsara.com/fleet/driver-vehicle-assignments?startTime=${encodeURIComponent(fiveMinutesAgo)}&filterBy=drivers&assignmentType=HOS`;

  context.log("📡 Polling Samsara for driver-vehicle HOS assignments...");

  try {
    // Step 1: Fetch driver-truck assignments from Samsara
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${SAMSARA_API_TOKEN}` }
    });

    const result = await response.json();
    const assignments = result.data || [];

    context.log(`✅ Found ${assignments.length} HOS assignments`);

    // Step 2: Get Graph access token
    const tokenRes = await fetch(`https://login.microsoftonline.com/${GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GRAPH_CLIENT_ID,
        client_secret: GRAPH_CLIENT_SECRET,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    });

    const graphAccessToken = (await tokenRes.json()).access_token;

    // Step 3: Resolve Test Driver's email from M365
    let testDriverEmail = null;
    try {
      const searchRes = await fetch(
        `https://graph.microsoft.com/v1.0/users?$search="displayName:${encodeURIComponent(TEST_DRIVER_NAME)}"`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${graphAccessToken}`,
            ConsistencyLevel: "eventual"
          }
        }
      );
      const result = await searchRes.json();
      if (result.value?.length > 0) {
        testDriverEmail = result.value[0].mail || result.value[0].userPrincipalName;
        testDriverEmail = testDriverEmail.toLowerCase();
        context.log(`📧 Test Driver email resolved: ${testDriverEmail}`);
      } else {
        context.log("⚠️ Test Driver not found in Microsoft 365.");
      }
    } catch (err) {
      context.log.error(`❌ Failed to resolve Test Driver email: ${err.message}`);
    }

    // Step 4: Find Test Driver's current truck assignment
    let assignedTruckId = null;
    for (const assignment of assignments) {
      const truckId = assignment.vehicle?.name;
      const driverName = assignment.driver?.name;
      if (!truckId || !driverName || truckId.startsWith("RT-") || truckId.startsWith("VT-")) continue;
      if (driverName === TEST_DRIVER_NAME) {
        assignedTruckId = truckId;
        context.log(`✅ Test Driver currently assigned to: ${assignedTruckId}`);
        break;
      }
    }

    // Step 5: Loop through all folders and clean up permissions
    const folderListRes = await fetch(
      `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/root:/TruckDocs:/children`,
      {
        headers: { Authorization: `Bearer ${graphAccessToken}` }
      }
    );
    const folders = folderListRes.ok ? (await folderListRes.json()).value : [];

    for (const folder of folders) {
      const truckId = folder.name;

      // List permissions for the folder
      const permsRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/items/${folder.id}/permissions`,
        { headers: { Authorization: `Bearer ${graphAccessToken}` } }
      );
      const permissions = (await permsRes.json()).value;

      for (const perm of permissions) {
        const sharedWith = perm.grantedToV2?.user?.email?.toLowerCase();

        // ❌ Unshare if Test Driver has access but is no longer assigned to this truck
        if (sharedWith === testDriverEmail && truckId !== assignedTruckId) {
          const delRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/items/${folder.id}/permissions/${perm.id}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${graphAccessToken}` }
            }
          );
          if (delRes.ok) {
            context.log(`❌ Unshared /TruckDocs/${truckId} from ${sharedWith}`);
          } else {
            const errText = await delRes.text();
            context.log.error(`⚠️ Failed to unshare ${truckId} from ${sharedWith}: ${delRes.status} ${errText}`);
          }
        }
      }

      // ✅ If this is the assigned truck, upload and ensure shared
      if (truckId === assignedTruckId && testDriverEmail) {
        const docsRes = await fetch(`${FUNCTION_HOST}/api/getTruckDocuments?truck=${encodeURIComponent(truckId)}`);
        const docs = await docsRes.json();

        const folderRes = await fetch(
          `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/root:/TruckDocs/${truckId}:/children`,
          { headers: { Authorization: `Bearer ${graphAccessToken}` } }
        );
        const existingFiles = folderRes.ok ? (await folderRes.json()).value : [];

        for (const doc of docs) {
          const match = existingFiles.find(f => f.name === doc.name);
          if (match) continue;

          try {
            const fileRes = await fetch(`https://graph.microsoft.com/v1.0${doc.downloadPath}`, {
              headers: { Authorization: `Bearer ${graphAccessToken}` }
            });
            const buffer = await fileRes.arrayBuffer();

            await fetch(
              `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/root:/TruckDocs/${truckId}/${encodeURIComponent(doc.name)}:/content`,
              {
                method: "PUT",
                headers: {
                  Authorization: `Bearer ${graphAccessToken}`,
                  "Content-Type": "application/octet-stream"
                },
                body: buffer
              }
            );
            context.log(`✅ Uploaded ${doc.name} for Truck ${truckId}`);
          } catch (err) {
            context.log.error(`❌ Upload failed for ${doc.name}: ${err.message}`);
          }
        }

        // Share with Test Driver if not already shared
        const permsCheck = await fetch(
          `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/root:/TruckDocs/${truckId}:/permissions`,
          { headers: { Authorization: `Bearer ${graphAccessToken}` } }
        );
        const perms = (await permsCheck.json()).value;
        const alreadyShared = perms.some(p =>
          p.grantedToV2?.user?.email?.toLowerCase() === testDriverEmail
        );

        if (!alreadyShared) {
          const shareRes = await fetch(
            `https://graph.microsoft.com/v1.0/users/${TRUCKDOCS_USER_ID}/drive/root:/TruckDocs/${truckId}:/invite`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${graphAccessToken}`,
                "Content-Type": "application/json"
              },
              body: JSON.stringify({
                recipients: [{ email: testDriverEmail }],
                requireSignIn: true,
                sendInvitation: false,
                roles: ["read"]
              })
            }
          );

          if (shareRes.ok) {
            context.log(`✅ Shared /TruckDocs/${truckId} with ${testDriverEmail}`);
          } else {
            const errText = await shareRes.text();
            context.log.error(`❌ Share failed: ${shareRes.status} ${errText}`);
          }
        }
      }
    }
  } catch (err) {
    context.log.error(`🔥 Function error: ${err.message}`);
  }
};
