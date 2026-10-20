const express = require("express");
const crypto = require("crypto");
const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL;
const PRODUCT_PRICE = Number(process.env.PRODUCT_PRICE || 14900);
const CURRENCY = (process.env.CURRENCY || "PHP").toUpperCase();

app.get("/health", (_req, res) => res.json({ ok: true, service: "cse-ready-paymongo-backend" }));

app.post("/api/create-checkout-session", express.json(), async (req, res) => {
  try {
    if (!SECRET_KEY || !SITE_URL) return res.status(500).json({ error: "Checkout is not configured yet." });
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) return res.status(400).json({ error: "Please provide a valid email address." });

    const payload = { data: { attributes: {
      billing: { email },
      send_email_receipt: false,
      show_description: true,
      show_line_items: true,
      description: "CSE Ready Workbook Bundle",
      line_items: [{ currency: CURRENCY, amount: PRODUCT_PRICE, name: "CSE Ready Workbook Bundle", quantity: 1, description: "Digital study workbook and printable worksheets" }],
      payment_method_types: ["qrph"],
      success_url: `${SITE_URL.replace(/\\/$/, "")}/?payment=return`,
      cancel_url: `${SITE_URL.replace(/\\/$/, "")}/?payment=cancelled`,
      reference_number: `CSEREADY-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`
    } } };

    const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
      method: "POST",
      headers: { Authorization: `Basic ${Buffer.from(`${SECRET_KEY}:`).toString("base64")}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      console.error("PayMongo checkout error:", JSON.stringify(result));
      return res.status(502).json({ error: "PayMongo could not create checkout. Check backend logs and payment-method settings." });
    }
    const attributes = result?.data?.attributes || {};
    if (!attributes.checkout_url) return res.status(502).json({ error: "PayMongo did not return a checkout URL." });
    return res.json({ checkoutUrl: attributes.checkout_url, checkoutSessionId: result.data.id, referenceNumber: attributes.reference_number });
  } catch (error) {
    console.error("Create checkout error:", error);
    return res.status(500).json({ error: "Unexpected server error while creating checkout." });
  }
});

// Configure this endpoint in PayMongo Test Mode webhooks.
app.post("/webhooks/paymongo", express.raw({ type: "application/json" }), (req, res) => {
  try {
    if (!WEBHOOK_SECRET) return res.status(500).send("Webhook is not configured.");
    const header = req.get("Paymongo-Signature") || "";
    const parts = Object.fromEntries(header.split(",").map(part => {
      const i = part.indexOf("=");
      return i < 0 ? [part, ""] : [part.slice(0, i), part.slice(i + 1)];
    }));
    const timestamp = parts.t;
    const signature = parts.te; // Test mode signature
    if (!timestamp || !signature) return res.status(400).send("Missing test webhook signature.");
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(`${timestamp}.${req.body.toString("utf8")}`).digest("hex");
    const got = Buffer.from(signature, "hex"), want = Buffer.from(expected, "hex");
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return res.status(400).send("Invalid webhook signature.");
    const event = JSON.parse(req.body.toString("utf8"));
    console.log("Verified PayMongo webhook event:", event?.data?.attributes?.type, event?.data?.attributes?.data?.id);
    // This starter does not yet persist orders or send ebook files.
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("Webhook processing error:", error);
    return res.status(400).send("Invalid webhook payload.");
  }
});
app.listen(PORT, () => console.log(`PayMongo backend listening on ${PORT}`));
