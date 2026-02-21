const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

console.log("SUPABASE_URL:", SUPABASE_URL ? "Loaded" : "Missing");
console.log("SUPABASE_SERVICE_KEY:", SUPABASE_SERVICE_KEY ? "Loaded" : "Missing");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Temporary store for login flow
let currentUserId = null;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

// ================================
// STEP 1 — Start Zerodha Login
// ================================
app.get("/api/zerodha/login", async (req, res) => {
  const { user_id } = req.query;

  console.log("===== LOGIN ROUTE HIT =====");
  console.log("Received user_id:", user_id);

  if (!user_id) {
    return res.send("User ID missing");
  }

  currentUserId = user_id;

  // Fetch user's API key
  const { data: userData, error } = await supabase
    .from("users_extra")
    .select("*")
    .eq("id", user_id)
    .maybeSingle();

  console.log("Supabase fetch result:", userData);
  console.log("Supabase fetch error:", error);

  if (!userData) {
    return res.send("No row found in users_extra for this user.");
  }

  if (!userData.api_key) {
    return res.send("User API Key not found. Save API keys first.");
  }

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${userData.api_key}`;

  console.log("Redirecting to Zerodha:", loginUrl);

  res.redirect(loginUrl);
});

// ================================
// STEP 2 — Zerodha Callback
// ================================
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  console.log("===== CALLBACK ROUTE HIT =====");
  console.log("Received request_token:", request_token);
  console.log("Current stored user ID:", currentUserId);

  if (!request_token || !currentUserId) {
    return res.send("Missing request_token or user_id");
  }

  try {
    const { data: userData, error } = await supabase
      .from("users_extra")
      .select("*")
      .eq("id", currentUserId)
      .maybeSingle();

    console.log("User data from Supabase:", userData);
    console.log("Fetch error:", error);

    if (!userData?.api_key || !userData?.api_secret) {
      return res.send("API Key or Secret missing for user.");
    }

    const checksum = crypto
      .createHash("sha256")
      .update(
        userData.api_key +
          request_token +
          userData.api_secret
      )
      .digest("hex");

    console.log("Generated checksum:", checksum);

    const response = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: userData.api_key,
        request_token: request_token,
        checksum: checksum,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("Zerodha response:", response.data);

    const access_token = response.data.data.access_token;

    console.log("Access token received:", access_token);

    // Save token & mark connected
    const { error: updateError } = await supabase
      .from("users_extra")
      .update({
        access_token: access_token,
        broker_connected: true,
      })
      .eq("id", currentUserId);

    console.log("Update result error:", updateError);

    currentUserId = null;

    res.redirect("https://YOUR-FRONTEND-URL.vercel.app/dashboard");

  } catch (error) {
    console.error("Zerodha ERROR:", error.response?.data || error.message);
    res.status(500).send("Error generating access token");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
