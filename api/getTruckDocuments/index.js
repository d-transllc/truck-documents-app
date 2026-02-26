module.exports = async function (context, req) {
  try {
    const truckNumber = req.query.truck;
    if (!truckNumber) {
      context.res = { status: 400, body: "Missing truck query parameter." };
      return;
    }

    const tenantId = process.env["GRAPH_TENANT_ID"];
    const clientId = process.env["GRAPH_CLIENT_ID"];
    const clientSecret = process.env["GRAPH_CLIENT_SECRET"];
    const siteId = process.env["GRAPH_SITE_ID"];
    const driveId = process.env["GRAPH_DRIVE_ID"];

    context.log("🔐 Requesting Graph token...");

    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials"
      })
    });


    if (!tokenRes.ok) {
      const errorText = await tokenRes.text();
      throw new Error(`Token request failed: ${tokenRes.status} ${errorText}`);
    }

    const tokenJson = await tokenRes.json();
    const accessToken = tokenJson.access_token;

    context.log("📥 Token acquired. Querying SharePoint...");

    const itemsRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/list/items?expand=fields`,
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    );

    if (!itemsRes.ok) {
      const errText = await itemsRes.text();
      throw new Error(`Graph API error: ${itemsRes.status} ${errText}`);
    }

    const items = (await itemsRes.json()).value || [];

    const matchingDocs = items.filter(doc => {
      const fields = doc.fields || {};
      const asset = fields.Asset_x0020_ID;
      const isGlobal = fields.For_x0020_All_x0020_Assets === true;

      const matchesTruck =
        asset === truckNumber ||
        asset?.LookupValue === truckNumber ||
        asset?.LookupId == truckNumber ||
        (Array.isArray(asset) &&
          asset.some(entry => entry.LookupValue === truckNumber || entry.LookupId == truckNumber));

      return isGlobal || matchesTruck;
    });

    context.log(`📄 Found ${matchingDocs.length} documents for truck ${truckNumber}`);

    context.res = {
    status: 200,
    headers: { "Content-Type": "application/json" },
    body: await Promise.all(
        matchingDocs.map(async doc => {
        // Get drive item ID using list item ID
        const itemId = doc.id;

        const driveItemRes = await fetch(
            `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/list/items/${itemId}/driveItem`,
            {
            headers: { Authorization: `Bearer ${accessToken}` }
            }
        );

        if (!driveItemRes.ok) {
            context.log.error(`❌ Failed to resolve driveItem for ${doc.fields?.FileLeafRef}`);
            return null;
        }

        const driveItem = await driveItemRes.json();

        return {
            name: doc.fields?.FileLeafRef,
            downloadPath: `/drives/${driveId}/items/${driveItem.id}/content`
        };
        })
    ).then(results => results.filter(r => r !== null))
    };


  } catch (err) {
    context.log.error("🔥 Function error:", err.message);
    context.res = {
      status: 500,
      body: `Internal Server Error: ${err.message}`
    };
  }
};
