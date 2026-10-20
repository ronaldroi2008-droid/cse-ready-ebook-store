
const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
const WEBHOOK_SECRET = process.env.PAYMONGO_WEBHOOK_SECRET;
const SITE_URL = process.env.SITE_URL;
const PRODUCT_PRICE = Number(process.env.PRODUCT_PRICE || 14900);
const CURRENCY = (process.env.CURRENCY || "PHP").toUpperCase();

const ALLOWED_ORIGIN =
  "https://cse-ready-ebook-store.onrender.com";

// Basic configuration checks
if (!SECRET_KEY) {
  console.warn("Missing PAYMONGO_SECRET_KEY");
}

if (!SITE_URL) {
  console.warn("Missing SITE_URL");
}

if (!Number.isSafeInteger(PRODUCT_PRICE) || PRODUCT_PRICE <= 0) {
  throw new Error("PRODUCT_PRICE must be a positive integer in centavos.");
}

if (CURRENCY !== "PHP") {
  throw new Error("This store is configured for PHP only.");
}

// CORS: allow requests from the ebook landing page only.
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(origin === ALLOWED_ORIGIN ? 204 : 403);
  }

  next();
});

// Health check
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "cse-ready-paymongo-backend",
    mode: SECRET_KEY?.startsWith("sk_test_")
      ? "test"
      : "check-configuration"
  });
});

// Root endpoint
app.get("/", (_req, res) => {
  res.json({
    service: "CSE Ready PayMongo API",
    health: "/health"
  });
});

// Create PayMongo Checkout Session v2
app.post(
  "/api/create-checkout-session",
  express.json({ limit: "10kb" }),
  async (req, res) => {
    try {
      if (!SECRET_KEY || !SITE_URL) {
        return res.status(503).json({
          error: "Checkout is not configured."
        });
      }

      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();

      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

      if (!emailPattern.test(email) || email.length > 254) {
        return res.status(400).json({
          error: "Please provide a valid email address."
        });
      }

      const siteUrl = SITE_URL.replace(/\/+$/, "");

      const referenceNumber =
        `CSEREADY-${Date.now()}-${crypto
          .randomBytes(4)
          .toString("hex")
          .toUpperCase()}`;

      const payload = {
        data: {
          attributes: {
            line_items: [
              {
                name: "CSE Ready Workbook Bundle",
                amount: PRODUCT_PRICE,
                currency: CURRENCY,
                quantity: 1
              }
            ],
            payment_method_types: ["qrph"],
            success_url: `${siteUrl}/?payment=return`,
            cancel_url: `${siteUrl}/?payment=cancelled`,
            reference_number: referenceNumber,
            description:
              "CSE Ready Workbook Bundle - digital study materials"
          }
        }
      };

      const response = await fetch(
        "https://api.paymongo.com/v2/checkout_sessions",
        {
          method: "POST",
          headers: {
            Authorization:
              `Basic ${Buffer.from(`${SECRET_KEY}:`).toString("base64")}`,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify(payload)
        }
      );

      const result = await response.json();

      if (!response.ok) {
        // Do not return API details or secret values to the customer.
        console.error(
          "PayMongo checkout request failed:",
          response.status,
          JSON.stringify(result?.errors || [])
        );

        return res.status(502).json({
          error:
            "Unable to create checkout. Check PayMongo settings and server logs."
        });
      }

      const attributes = result?.data?.attributes;
      const checkoutUrl = attributes?.checkout_url;

      if (
        typeof checkoutUrl !== "string" ||
        !checkoutUrl.startsWith("https://checkout.paymongo.com/")
      ) {
        console.error("Unexpected PayMongo checkout response.");

        return res.status(502).json({
          error: "PayMongo did not return a valid checkout URL."
        });
      }

      // Email is accepted here for input validation.
      // This starter does not yet persist an order or deliver files.
      return res.status(201).json({
        checkoutUrl,
        checkoutSessionId: result.data.id,
        referenceNumber
      });
    } catch (error) {
      console.error("Checkout creation error:", error.message);

      return res.status(500).json({
        error: "An unexpected error occurred while creating checkout."
      });
    }
  }
);

// IMPORTANT: Register the webhook route before express.json().
// Signature verification requires the original, unmodified request body.
app.post(
  "/webhooks/paymongo",
  express.raw({ type: "application/json", limit: "1mb" }),
  (req, res) => {
    try {
      if (!WEBHOOK_SECRET) {
        console.error("Missing PAYMONGO_WEBHOOK_SECRET");

        return res.status(503).json({
          error: "Webhook is not configured."
        });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({
          error: "Expected a raw JSON request body."
        });
      }

      const signatureHeader =
        req.get("Paymongo-Signature") || "";

      const signatureParts = {};

      for (const part of signatureHeader.split(",")) {
        const index = part.indexOf("=");

        if (index > 0) {
          const key = part.slice(0, index).trim();
          const value = part.slice(index + 1).trim();
          signatureParts[key] = value;
        }
      }

      const timestamp = signatureParts.t;
      const receivedSignature = signatureParts.te;

      // This endpoint is configured for Test Mode.
      if (!timestamp || !receivedSignature) {
        return res.status(400).json({
          error: "Missing Test Mode webhook signature."
        });
      }

      // Reject stale webhook requests to reduce replay risk.
      const timestampNumber = Number(timestamp);
      const nowSeconds = Math.floor(Date.now() / 1000);

      if (
        !Number.isFinite(timestampNumber) ||
        Math.abs(nowSeconds - timestampNumber) > 300
      ) {
        return res.status(400).json({
          error: "Webhook timestamp is invalid or too old."
        });
      }

      const signedPayload =
        `${timestamp}.${req.body.toString("utf8")}`;

      const expectedSignature = crypto
        .createHmac("sha256", WEBHOOK_SECRET)
        .update(signedPayload)
        .digest("hex");

      if (
        !/^[a-f0-9]+$/i.test(receivedSignature) ||
        receivedSignature.length !== expectedSignature.length
      ) {
        return res.status(400).json({
          error: "Invalid webhook signature."
        });
      }

      const signatureMatches = crypto.timingSafeEqual(
        Buffer.from(receivedSignature, "hex"),
        Buffer.from(expectedSignature, "hex")
      );

      if (!signatureMatches) {
        return res.status(400).json({
          error: "Webhook signature verification failed."
        });
      }

      const event = JSON.parse(req.body.toString("utf8"));
      const eventType = event?.data?.attributes?.type;
      const eventData = event?.data?.attributes?.data;

      // Confirm that the webhook belongs to Test Mode.
      if (event?.data?.attributes?.livemode === true) {
        console.error("Live-mode event received by Test Mode endpoint.");

        return res.status(400).json({
          error: "Unexpected live-mode webhook."
        });
      }

      console.log("Verified PayMongo webhook:", {
        eventType,
        resourceId: eventData?.id,
        referenceNumber: eventData?.attributes?.reference_number
      });

      if (eventType === "checkout_session.payment.paid") {
        // TODO:
        // 1. Find the matching order in a persistent database.
        // 2. Verify the session ID, reference, amount, currency and status.
        // 3. Mark the order paid exactly once.
        // 4. Send the buyer a secure, expiring download link.
        //
        // Do NOT deliver an ebook based only on the success-page redirect.
        console.log(
          "Payment event verified. Ebook delivery is not implemented yet."
        );
      }

      // Acknowledge the verified webhook.
      return res.status(200).json({
        received: true
      });
    } catch (error) {
      console.error("Webhook processing error:", error.message);

      return res.status(400).json({
        error: "Invalid webhook request."
      });
    }
  }
);

// Parse JSON for regular API routes.
// Keep the raw-body webhook route above this middleware.
app.use(express.json({ limit: "10kb" }));

app.listen(PORT, () => {
  console.log(`CSE Ready PayMongo API listening on port ${PORT}`);
});
