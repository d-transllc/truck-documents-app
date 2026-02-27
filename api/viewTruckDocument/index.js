module.exports = async function (context, req) {
  try {
    const itemId = (req.query.itemId || "").trim(); // this is the DRIVE ITEM ID (not list item id)
    if (!itemId) {
      context.res = { status: 400, body: "Missing itemId query parameter." };
      return;
    }

    const tenantId = process.env["GRAPH_TENANT_ID"];
    const clientId = process.env["GRAPH_CLIENT_ID"];
    const clientSecret = process.env["GRAPH_CLIENT_SECRET"];
    const siteId = process.env["GRAPH_SITE_ID"];
    const driveId = process.env["GRAPH_DRIVE_ID"];

    if (!tenantId || !clientId || !clientSecret || !siteId || !driveId) {
      context.res = { status: 500, body: "Server misconfiguration: missing Graph env vars." };
      return;
    }

    // 1) Get token
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
      const t = await tokenRes.text();
      throw new Error(`Token request failed: ${tokenRes.status} ${t}`);
    }

    const { access_token } = await tokenRes.json();

    // 2) Get driveItem metadata (name + mime)
    const metaRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}?select=name,file`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!metaRes.ok) {
      const t = await metaRes.text();
      throw new Error(`Drive item metadata failed: ${metaRes.status} ${t}`);
    }

    const meta = await metaRes.json();
    const fileName = meta?.name || "document.pdf";
    const mimeType = meta?.file?.mimeType || "application/pdf";

    // 3) Download content (Graph returns a 302 redirect to a temp URL)
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/sites/${siteId}/drives/${driveId}/items/${itemId}/content`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
        redirect: "manual"
      }
    );

    let fileRes = contentRes;

    // Follow redirect ourselves
    if (contentRes.status === 302 || contentRes.status === 301) {
      const location = contentRes.headers.get("location");
      if (!location) throw new Error("Missing redirect location from Graph content endpoint.");

      fileRes = await fetch(location);
    }

    if (!fileRes.ok) {
      const t = await fileRes.text();
      throw new Error(`File download failed: ${fileRes.status} ${t}`);
    }

    const ab = await fileRes.arrayBuffer();
    const buffer = Buffer.from(ab);

    // 4) Send INLINE so browser views instead of downloading
    context.res = {
      status: 200,
      isRaw: true,
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=0, must-revalidate"
      },
      body: buffer
    };
  } catch (err) {
    context.log.error("viewTruckDocument error:", err.message || err);
    context.res = { status: 500, body: `Internal Server Error: ${err.message || String(err)}` };
  }
};