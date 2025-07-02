const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('email-validator');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

const transporter = nodemailer.createTransport({
  service: 'Outlook365',
  auth: {
    user: 'inclusion.pwd@saarathee.com', // Replace with your real email
    pass: 'S&412476630841'              // Use app password if 2FA is on
  }
});

const jobStatus = {};

app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Bulk Email Sender</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f2f2f2;
          padding: 30px;
        }
        form {
          background: #fff;
          padding: 20px;
          border-radius: 8px;
          max-width: 600px;
          margin-bottom: 30px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        label {
          font-weight: bold;
          margin-top: 10px;
          display: block;
        }
        input, textarea {
          width: 100%;
          padding: 8px;
          margin-top: 5px;
          margin-bottom: 15px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        button {
          padding: 10px 15px;
          background-color: #0078D7;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        #status {
          background-color: #e6f7ff;
          border-left: 5px solid #1890ff;
          padding: 15px;
          margin-top: 20px;
          white-space: pre-wrap;
        }
      </style>
    </head>
    <body>
      <h2>Send Bulk Emails</h2>
      <form id="emailForm" enctype="multipart/form-data">
        <label for="csvFile">Upload CSV (with "Email" column):</label>
        <input type="file" id="csvFile" name="csvFile" required>

        <label for="subject">Subject:</label>
        <input type="text" id="subject" name="subject" required>

        <label for="content">Email Content:</label>
        <textarea id="content" name="content" rows="8" required></textarea>

        <button type="submit">Send Emails</button>
      </form>

      <a href="/download-sample-csv" target="_blank">Download Sample CSV</a>

      <div id="status" style="display:none;"></div>
      <button id="refreshBtn" style="display:none;">Refresh Status</button>

      <script>
        let jobId = null;

        document.getElementById('emailForm').addEventListener('submit', async function (e) {
          e.preventDefault();
          const formData = new FormData(this);
          const res = await fetch('/send-bulk-emails', { method: 'POST', body: formData });
          const data = await res.json();
          jobId = data.jobId;
          document.getElementById('status').style.display = 'block';
          document.getElementById('status').innerText = 'Sending started...';
          document.getElementById('refreshBtn').style.display = 'inline-block';
        });

        document.getElementById('refreshBtn').addEventListener('click', async () => {
          if (!jobId) return;
          const res = await fetch('/email-status?jobId=' + jobId);
          const status = await res.json();
          document.getElementById('status').innerText = 
            'Sent: ' + status.sent + '\\n' +
            'Failed: ' + status.failed.length + '\\n' +
            'Invalid: ' + status.invalid.length + '\\n' +
            'Total: ' + status.total + '\\n' +
            'Completed: ' + (status.completed ? 'Yes' : 'No');
        });
      </script>
    </body>
    </html>
  `);
});

app.get('/download-sample-csv', (req, res) => {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sample.csv"');
  res.send('Email\nexample1@example.com\nexample2@example.com');
});

app.post('/send-bulk-emails', upload.single('csvFile'), (req, res) => {
  const subject = req.body.subject;
  const rawContent = req.body.content;
  const content = `<pre>${convertUrlsToLinks(rawContent)}</pre>`;
  const jobId = uuidv4();
  const filePath = req.file.path;

  const emails = [];
  jobStatus[jobId] = {
    sent: 0,
    failed: [],
    invalid: [],
    total: 0,
    completed: false
  };

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
      if (row.Email) emails.push(row.Email.trim());
    })
    .on('end', () => {
      jobStatus[jobId].total = emails.length;
      sendEmails(subject, emails, content, jobId);
      res.json({ jobId });
    });
});

function convertUrlsToLinks(text) {
  const regex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
  return text.replace(regex, '<a href="$1" target="_blank">$1</a>');
}

async function sendEmails(subject, emailList, content, jobId) {
  const sender = "Tarun Singhal <inclusion.pwd@saarathee.com>";
  for (const email of emailList) {
    if (!validator.validate(email)) {
      jobStatus[jobId].invalid.push(email);
      continue;
    }

    const mailOptions = {
      from: sender,
      to: email,
      subject,
      html: content
    };

    try {
      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            jobStatus[jobId].failed.push(email);
            return reject(error);
          }
          jobStatus[jobId].sent++;
          resolve(info);
        });
      });
    } catch (err) {
      console.error(`Failed to send to ${email}:`, err.message);
    }
  }

  jobStatus[jobId].completed = true;
}

app.get('/email-status', (req, res) => {
  const jobId = req.query.jobId;
  if (!jobStatus[jobId]) {
    return res.status(404).json({ error: 'Invalid job ID' });
  }
  res.json(jobStatus[jobId]);
});

app.listen(port, () => {
  console.log(`✅ Server started at http://localhost:${port}`);
});
