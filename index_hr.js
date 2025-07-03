const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('email-validator');
const bodyParser = require('body-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 8000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('uploads'));

const upload = multer({ dest: 'uploads/' });

const jobStatus = {};

app.get('/', (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Bulk Email Sender</title>
      <style>
        body { font-family: Arial; background: #f0f2f5; padding: 20px; }
        form { background: #fff; padding: 20px; border-radius: 6px; max-width: 500px; margin: auto; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
        label, input, textarea { display: block; width: 100%; margin-bottom: 10px; }
        input, textarea { padding: 8px; border: 1px solid #ccc; border-radius: 4px; }
        button { padding: 10px; background: #0078D7; color: white; border: none; border-radius: 4px; cursor: pointer; }
        #logoutBtn { background: #F44336; margin-top: 10px; }
      </style>
    </head>
    <body>

      <div id="loginPage" style="display:none;">
        <h2>Login</h2>
        <form id="loginForm">
          <label>Email:</label>
          <input type="email" id="loginEmail" required>
          <label>Password:</label>
          <input type="password" id="loginPassword" required>
          <label>Name:</label>
          <input type="text" id="loginName" required>
          <button type="submit">Login</button>
        </form>
      </div>

      <div id="emailPage" style="display:none;">
        <h2>Send Bulk Emails</h2>
        <form id="emailForm" enctype="multipart/form-data">
          <label>CSV File (Email column):</label>
          <input type="file" name="csvFile" required>

          <label>Subject:</label>
          <input type="text" name="subject" required>

          <label>Content:</label>
          <textarea name="content" rows="6" required></textarea>

          <button type="submit">Send Emails</button>
          <button type="button" id="pauseBtn" style="display:none;">Pause</button>
          <button type="button" id="resumeBtn" style="display:none;">Resume</button>
          <button type="button" id="stopBtn" style="display:none;">Stop</button>
        </form>

        <a href="/download-sample-csv" target="_blank">Download Sample CSV</a>

        <div id="status" style="margin-top: 20px;"></div>
        <button id="refreshBtn" style="display:none;">Refresh Status</button>
        <button id="logoutBtn">Logout</button>
      </div>

      <script>
        let jobId = null;

        function showLogin() {
          document.getElementById('loginPage').style.display = 'block';
          document.getElementById('emailPage').style.display = 'none';
        }

        function showEmailPage() {
          document.getElementById('loginPage').style.display = 'none';
          document.getElementById('emailPage').style.display = 'block';
        }

        if (localStorage.getItem('emailCredentials')) {
          showEmailPage();
        } else {
          showLogin();
        }

        document.getElementById('loginForm').addEventListener('submit', function(e) {
          e.preventDefault();
          const creds = {
            email: document.getElementById('loginEmail').value,
            password: document.getElementById('loginPassword').value,
            name: document.getElementById('loginName').value
          };
          localStorage.setItem('emailCredentials', JSON.stringify(creds));
          showEmailPage();
        });

        document.getElementById('logoutBtn').addEventListener('click', () => {
          localStorage.removeItem('emailCredentials');
          location.reload();
        });

        document.getElementById('emailForm').addEventListener('submit', async function (e) {
          e.preventDefault();
          const formData = new FormData(this);
          const creds = JSON.parse(localStorage.getItem('emailCredentials'));
          formData.append('senderEmail', creds.email);
          formData.append('senderPassword', creds.password);
          formData.append('senderName', creds.name);

          const res = await fetch('/send-bulk-emails', { method: 'POST', body: formData });
          const data = await res.json();
          jobId = data.jobId;

          document.getElementById('status').innerText = 'Sending started...';
          document.getElementById('pauseBtn').style.display = 'inline-block';
          document.getElementById('stopBtn').style.display = 'inline-block';
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

        async function controlJob(action) {
          if (!jobId) return;
          await fetch('/email-control', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ jobId, action })
          });

          if (action === 'pause') {
            document.getElementById('pauseBtn').style.display = 'none';
            document.getElementById('resumeBtn').style.display = 'inline-block';
          } else if (action === 'resume') {
            document.getElementById('resumeBtn').style.display = 'none';
            document.getElementById('pauseBtn').style.display = 'inline-block';
          } else if (action === 'stop') {
            document.getElementById('pauseBtn').disabled = true;
            document.getElementById('resumeBtn').disabled = true;
            document.getElementById('stopBtn').disabled = true;
          }
        }

        document.getElementById('pauseBtn').addEventListener('click', () => controlJob('pause'));
        document.getElementById('resumeBtn').addEventListener('click', () => controlJob('resume'));
        document.getElementById('stopBtn').addEventListener('click', () => controlJob('stop'));
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
  const senderEmail = req.body.senderEmail;
  const senderPassword = req.body.senderPassword;
  const senderName = req.body.senderName;

  const content = `<pre>${convertUrlsToLinks(rawContent)}</pre>`;
  const jobId = uuidv4();
  const filePath = req.file.path;

  const emails = [];
  jobStatus[jobId] = {
    sent: 0,
    failed: [],
    invalid: [],
    total: 0,
    completed: false,
    paused: false,
    stopped: false
  };

  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
      if (row.Email) emails.push(row.Email.trim());
    })
    .on('end', () => {
      jobStatus[jobId].total = emails.length;

      const dynamicTransporter = nodemailer.createTransport({
        service: 'Outlook365',
        auth: {
          user: senderEmail,
          pass: senderPassword
        }
      });

      sendEmails(subject, emails, content, jobId, dynamicTransporter, `${senderName} <${senderEmail}>`);
      res.json({ jobId });
    });
});

app.post('/email-control', (req, res) => {
  const { jobId, action } = req.body;
  const job = jobStatus[jobId];
  if (!job) return res.status(404).json({ error: 'Invalid job ID' });

  if (action === 'pause') job.paused = true;
  else if (action === 'resume') job.paused = false;
  else if (action === 'stop') job.stopped = true;

  res.json({ message: `Job ${action}d.` });
});

function convertUrlsToLinks(text) {
  const regex = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
  return text.replace(regex, '<a href="$1" target="_blank">$1</a>');
}

async function sendEmails(subject, emailList, content, jobId, transporter, sender) {
  for (const email of emailList) {
    if (jobStatus[jobId].stopped) break;

    while (jobStatus[jobId].paused) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

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
