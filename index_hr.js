const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('email-validator');
const bodyParser = require('body-parser');
const mammoth = require('mammoth'); // For converting .docx to HTML

const app = express();
const port = 8081;

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

// Email transporter (Outlook SMTP)
const transporter = nodemailer.createTransport({
  service: 'Outlook365',
  auth: {
    user: 'richa@saarathee.com', // Your email
    pass: 'P(455488459173'       // Your password or app password
  }
});

// Download sample CSV
app.get('/download-sample-csv', (req, res) => {
  const csvContent = "Email\nsample1@example.com\nsample2@example.com\nsample3@example.com";
  res.header('Content-Type', 'text/csv');
  res.attachment('sample.csv');
  res.send(csvContent);
});

// Home route - form for uploading files
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Send Bulk Emails</h1>
        <form action="/send-bulk-emails" method="post" enctype="multipart/form-data">
          <label for="csvFile">Upload CSV File (Emails):</label>
          <input type="file" name="csvFile" id="csvFile" required><br><br>

          <label for="docFile">Upload Word File (.docx) for Email Content:</label>
          <input type="file" name="docFile" id="docFile" accept=".docx" required><br><br>

          <label for="subject">Subject:</label><br>
          <input type="text" name="subject" id="subject" placeholder="Email Subject" required><br><br>

          <button type="submit">Send Emails</button>
        </form>
        <br>
        <a href="/download-sample-csv">Download Sample CSV</a>
      </body>
    </html>
  `);
});

// Handle the form POST request
app.post('/send-bulk-emails', upload.fields([{ name: 'csvFile' }, { name: 'docFile' }]), async (req, res) => {
  const subject = req.body.subject;
  const csvFilePath = req.files['csvFile'][0].path;
  const docFilePath = req.files['docFile'][0].path;

  // Convert Word doc (.docx) to HTML
  let content = '';
  try {
    const result = await mammoth.convertToHtml({ path: docFilePath }, {
      convertImage: mammoth.images.inline((element) => {
        return element.read("base64").then((imageBuffer) => {
          return {
            src: "data:" + element.contentType + ";base64," + imageBuffer
          };
        });
      })
    });
    content = result.value;
  } catch (err) {
    console.error("Error reading Word file:", err);
    return res.send("<h1>Failed to read Word file</h1>");
  }

  // Extract email addresses from CSV
  const emailAddresses = [];
  fs.createReadStream(csvFilePath)
    .pipe(csv())
    .on('data', (row) => {
      emailAddresses.push(row.Email);
    })
    .on('end', async () => {
      await sendEmailsSerially(subject, emailAddresses, content, res);

      // Clean up uploaded files
      fs.unlinkSync(csvFilePath);
      fs.unlinkSync(docFilePath);
    });
});

// Send emails one by one
async function sendEmailsSerially(subject, emailAddresses, content, res) {
  let emailCount = 0;
  let failedEmails = [];
  let notSentEmails = [];

  const senderName = "Richa Bansal";
  const senderEmail = "richa@saarathee.com";

  for (let i = 0; i < emailAddresses.length; i++) {
    const email = emailAddresses[i];

    if (!validator.validate(email)) {
      console.log('Invalid email skipped:', email);
      notSentEmails.push(email);
      continue;
    }

    const mailOptions = {
      from: `${senderName} <${senderEmail}>`,
      to: email,
      subject: subject,
      html: content
    };

    try {
      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log('Error sending to:', email);
            failedEmails.push(email);
            reject(error);
          } else {
            console.log('Email sent to:', email);
            emailCount++;
            resolve(info);
          }
        });
      });
    } catch (error) {
      // Already handled above
    }
  }

  res.send(`
    <h1>Bulk Email Process Complete</h1>
    <p>✅ Successfully sent ${emailCount} emails.</p>
    <p>❌ Failed to send to ${failedEmails.length} emails: ${failedEmails.join(', ')}</p>
    <p>⚠️ Invalid/skipped emails (${notSentEmails.length}): ${notSentEmails.join(', ')}</p>
  `);
}

// Start server
app.listen(port, () => {
  console.log(`🚀 Server started at: http://localhost:${port}`);
});
