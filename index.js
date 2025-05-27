const express = require("express");
const axios = require("axios");
const cors = require("cors");
const bodyParser = require("body-parser");
const { Signature, WebApi } = require("smile-identity-core");
const smileIdentityCore = require("smile-identity-core");
const Utilities = smileIdentityCore.Utilities;

const app = express();

app.use(express.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const PARTNER_ID = "6329";
const API_KEY = "dbdfd875-5b8f-4734-8fa7-9b414a2048d6";
const BASE_URL = "https://testapi.smileidentity.com"; // Sandbox
const CALLBACK_URL = "https://e13e-105-113-107-184.ngrok-free.app/callback";
const COMPANY_NAME = "Vargent Africa";
const DATA_PRIVACY_POLICY_URL = "https://www.vargent.africa/privacy.html";
const LOGO_URL = "https://www.vargent.africa/img/vargent-logo.svg";
const SID_SERVER = 0; // 0 for sandbox, 1 for live

// Initialize Smile ID SDK
const signatureConnection = new Signature(PARTNER_ID, API_KEY);
const webApiConnection = new WebApi(
  PARTNER_ID,
  CALLBACK_URL,
  API_KEY,
  SID_SERVER
);

const utilities_connection = new Utilities(PARTNER_ID, API_KEY, SID_SERVER);

// In-memory storage (replace with MongoDB, PostgreSQL, etc.)
const jobStorage = new Map();
const verificationResults = new Map();

app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.post("/initiate-smilelink", async (req, res) => {
  try {
    console.log("Initiating smilelink");
    const { user_id } = req.body;
    // const user_id = "user-" + Date.now();
    console.log("user id: ", user_id);
    if (!user_id) {
      return res.status(400).json({ error: "user_id is required" });
    }

    const timestamp = new Date().toISOString();
    const { signature } = signatureConnection.generate_signature(timestamp);
    const job_id = `job-${Date.now()}`;
    console.log("user id: ", user_id, " job id: ", job_id);
    const expires_at = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const response = await axios.post(
      `${BASE_URL}/v1/smile_links`,
      {
        partner_id: PARTNER_ID,
        signature,
        timestamp,
        name: "Verification Link",
        company_name: COMPANY_NAME,
        id_types: [
          {
            country: "NG",
            id_type: "NIN_V2",
            verification_method: "biometric_kyc",
          },
          {
            country: "NG",
            id_type: "BVN",
            verification_method: "biometric_kyc",
          },
          {
            country: "NG",
            id_type: "PASSPORT",
            verification_method: "doc_verification",
          },
        ],
        callback_url: CALLBACK_URL,
        data_privacy_policy_url: DATA_PRIVACY_POLICY_URL,
        logo_url: LOGO_URL,
        is_single_use: true,
        user_id,
        partner_params: {
          user_id: user_id.toString(),
          job_id: job_id.toString(),
          job_type: "5",
        },
        expires_at,
        // redirect_url:
        //   "https://189zln6v-5173.uks1.devtunnels.ms/account/activate",
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    console.log("response from smile id: ", response.data);

    const { link: url, ref_id: job_id_from_response } = response.data;
    const final_job_id = job_id_from_response || job_id;

    await saveJobId({ user_id, job_id: final_job_id });

    res.json({ url, job_id: final_job_id, user_id: user_id });
  } catch (error) {
    console.error(
      "Error generating SmileLink:",
      error.response?.data,
      error.response?.status,
      error.response?.headers
    );
    res.status(error.response?.status || 500).json({
      error: "Failed to initiate verification",
      details: error.response?.data?.message || error.message,
    });
  }
});

app.post("/callback", async (req, res) => {
  try {
    const { job_id, result_code, result_text } = req.body;
    if (!job_id || !result_code) {
      console.error("Invalid callback data:", req.body);
      return res.status(400).json({ error: "Invalid callback data" });
    }

    console.log("Callback received:", { job_id, result_code, result_text });

    await saveVerificationResult({
      job_id,
      result_code,
      result_text,
      timestamp: new Date().toISOString(),
    });

    res.status(200).json({ message: "Callback received" });
  } catch (error) {
    console.error("Error processing callback:", error.message);
    res.status(500).json({ error: "Failed to process callback" });
  }
});

app.post("/status", async (req, res) => {
  try {
    const data = req.body;

    console.log("data from trying to see: ", data);

    // console.log("Job id gotten bacl: ", jobId);
    // const result = await getVerificationResult(jobId);
    // if (result) {
    //   return res.json(result);
    // }

    const timestamp = new Date().toISOString();
    const { signature } = signatureConnection.generate_signature(timestamp);

    const response = await axios.post(
      `${BASE_URL}/v1/job_status`,
      {
        partner_id: PARTNER_ID,
        timestamp,
        signature,
        user_id: data?.userId,
        job_id: data?.jobId,
        image_links: false,
        history: false,
      },
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const responseData = response.data;
    const { result_code, result_text } = responseData;
    console.log("New Response from job status: ", response.data);

    // await saveVerificationResult({
    //   job_id: "job-1747845452428",
    //   result_code,
    //   result_text,
    //   timestamp: new Date().toISOString(),
    // });

    res.json(responseData);
  } catch (error) {
    console.error(
      "Error fetching job status:",
      error.response?.data,
      error.response?.status
    );
    res.status(error.response?.status || 500).json({
      error: "Failed to fetch status",
      details: error.response?.data?.message || error.message,
    });
  }
});

async function saveJobId({ user_id, job_id }) {
  jobStorage.set(user_id, { job_id, created_at: new Date().toISOString() });
  console.log(`Stored: user_id=${user_id}, job_id=${job_id}`);
}

async function saveVerificationResult({
  job_id,
  result_code,
  result_text,
  timestamp,
}) {
  verificationResults.set(job_id, { result_code, result_text, timestamp });
  console.log(`Stored result: job_id=${job_id}, result_code=${result_code}`);
}

async function getVerificationResult(job_id) {
  return verificationResults.get(job_id) || null;
}

app.get("/job-id/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const jobData = jobStorage.get(userId);
    if (jobData) {
      res.json({ job_id: jobData.job_id });
    } else {
      res.status(404).json({ error: "No verification job found" });
    }
  } catch (error) {
    console.error("Error fetching job ID:", error.message);
    res.status(500).json({ error: "Failed to fetch job ID" });
  }
});

// app.listen(3000, () => console.log("Server running on port 3000"));

module.exports = app;
