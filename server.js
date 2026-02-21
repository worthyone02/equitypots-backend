const express = require("express");
const axios = require("axios");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const API_KEY = process.env.ZERODHA_API_KEY;
const API_SECRET = process.env.ZERODHA_API_SECRET;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

// Step 1: Redirect user to Zerodha login
app.get("/api/zerodha/login", (req, res) => {
  console.log("API_KEY at login route:", API_KEY);

  const loginUrl = `https://kite.zerodha.com/connect/login?v=3&api_key=${API_KEY}`;
  res.redirect(loginUrl);
});

// Step 2: Callback from Zerodha
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  console.log("Received request_token:", request_token);
  console.log("API_KEY:", API_KEY);
  console.log("API_SECRET:", API_SECRET);

  if (!request_token) {
    return res.send("No request token received");
  }

  if (!API_KEY || !API_SECRET) {
    return res.send("API_KEY or API_SECRET is undefined. Check Render Environment Variables.");
  }

  try {
    const checksum = crypto
      .createHash("sha256")
      .update(API_KEY + request_token + API_SECRET)
      .digest("hex");

    console.log("Generated checksum:", checksum);

    const response = await axios.post(
      "https://api.kite.trade/session/token",
      new URLSearchParams({
        api_key: API_KEY,
        request_token: request_token,
        checksum: checksum,
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );

    console.log("Full Zerodha response:", response.data);

    const access_token = response.data.data.access_token;

    res.send("Access Token Generated: " + access_token);

  } catch (error) {
    console.error("Zerodha Error:", error.response?.data || error.message);
    res.status(500).send("Error generating access token");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
