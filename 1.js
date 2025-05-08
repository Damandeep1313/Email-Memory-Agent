/*******************************************************
 * server.js — Batch Insert Unique Emails with MongoDB
 *******************************************************/
require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const sgMail = require("@sendgrid/mail");
sgMail.setApiKey(process.env.SENDGRID_API_KEY);



const app = express();
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  throw new Error("❌ MONGO_URI missing in .env");
}

app.use(bodyParser.json());

/*******************************************************
 * MONGOOSE SETUP
 *******************************************************/
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
const db = mongoose.connection;
db.on("error", console.error.bind(console, "❌ MongoDB connection error:"));
db.once("open", () => console.log("✅ MongoDB connected"));

/*******************************************************
 * SCHEMA
 *******************************************************/
const contactSchema = new mongoose.Schema(
  {
    user_id: String,
    conversation_id: String,
    name: { type: String, default: null },
    email: { type: String, required: true, unique: true },
    company: { type: String, default: null },
    created_at: { type: Date, default: Date.now },
  },
  { collection: "contacts" }
);

const Contact = mongoose.model("Contact", contactSchema);

// Data structure to store unique emails
let uniqueEmails = [];

/*******************************************************
 * ENDPOINT: POST /get-unique-emails (Batch Insert)
 *******************************************************/
app.post("/get-unique-emails", async (req, res) => {
  try {
    const { contacts } = req.body;
    const user_id = req.header("user_id");
    const conversation_id = req.header("conversation_id");

    if (!user_id || !conversation_id) {
      return res.status(400).json({ error: "Missing user_id or conversation_id in headers" });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: "Request must include an array of contacts" });
    }

    const incomingEmails = contacts.map(c => c.email);
    const existingDocs = await Contact.find({ email: { $in: incomingEmails } });
    const existingEmails = new Set(existingDocs.map(doc => doc.email));

    const newContacts = contacts
      .filter(c => !existingEmails.has(c.email))
      .map(c => ({
        ...c,
        user_id,
        conversation_id,
      }));

    // If no new contacts were added (all are duplicates)
    if (newContacts.length === 0) {
      return res.status(200).json({
        message: "These emails already exist.",
      });
    }

    const inserted = await Contact.insertMany(newContacts, { ordered: false });

    const responseData = inserted.map(({ name, email, company }) => ({ name, email, company }));

    // Store the unique emails in the data structure
    uniqueEmails = [...uniqueEmails, ...responseData.map(c => c.email)];

    console.log(responseData);
    return res.status(201).json({
      message: `Unique emails are: ${responseData.map(c => c.email).join(", ")}`,
      inserted: responseData,
    });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(201).json([]);
    }
    console.error("❌ Error in /get-unique-emails:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});




app.post("/send-email", async (req, res) => {
    console.log(req.body);
    const { subject, text } = req.body;
  
    if (!subject || !text) {
      return res
        .status(400)
        .send({ error: "Missing required fields: subject, text" });
    }
  
    try {
      if (uniqueEmails.length === 0) {
        return res.status(400).send({ error: "No unique emails to send to." });
      }
  
      await Promise.all(
        uniqueEmails.map((email) => {
          const msg = {
            to: email.toLowerCase(),
            from: "on-demand <info@on-demand.io>",
            subject: subject,
            text: text,
            html: `${text}`,
          };
          return sgMail.send(msg); // Ensure it returns the promise
        })
      );
  
      return res.status(200).json({
        message: `Email has been sent successfully to the provided ${uniqueEmails.length} emails.`,
      });
    } catch (error) {
      res.status(500).send({
        success: false,
        message: "Error sending email",
        error: error.message,
      });
    }
  });







/*******************************************************
 * START SERVER
 *******************************************************/
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
