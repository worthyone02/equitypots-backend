const express = require("express");
const axios = require("axios");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("Backend Running");
});

// Zerodha callback
app.get("/api/zerodha/callback", async (req, res) => {
  const { request_token } = req.query;

  if (!request_token) {
    return res.send("No request token received");
  }

  try {
    // Here later we generate access token
    res.send("Request token received: " + request_token);
  } catch (error) {
    res.status(500).send("Error generating access token");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
