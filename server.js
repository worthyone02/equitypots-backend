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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Temporary store for active login flow (MVP safe for now)
let currentUserId = null;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

// STEP 1 — Start Zerodha login
app.get("/api/zerodha/login", async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.send("User ID missing");
  }

  currentUserId = user_id;

  // Fetch user's API key
  const { data: userData } = await supabase
    .from("users_extra")
    .select("api_key")
    .eq("id", user_id)
    .single();

  if (!userData?.api_key) {
    return res.send("User API Key not found. Save API keys first.");
  }

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${userData.api_key}`;

  res.redirect(loginUrl);
});

// STEP 2 — Zerodha callback
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  if (!request_token || !currentUserId) {
    return res.send("Missing request_token or user_id");
  }

  try {
    // Fetch user's API key & secret
    const { data: userData } = await supabase
      .from("users_extra")
      .select("api_key, api_secret")
      .eq("id", currentUserId)
      .single();

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

    const access_token = response.data.data.access_token;

    // Save access token & mark connected
    await supabase.from("users_extra").upsert({
      id: currentUserId,
      access_token: access_token,
      broker_connected: true,
    });

    currentUserId = null;

    res.redirect("https://YOUR-FRONTEND-URL.vercel.app/dashboard");

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).send("Error generating access token");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
