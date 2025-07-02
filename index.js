const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('email-validator');
const bodyParser = require('body-parser');

// Create Express app
const app = express();
const port = 3000;

// Set up body parser for handling form data
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set up static folder for uploading files
app.use(express.static('uploads'));

// Set up multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Create a transporter using Outlook's SMTP server
const transporter = nodemailer.createTransport({
  service: 'Outlook365',
  auth: {
    user: 'inclusion.pwd@saarathee.com', // Your Outlook email address
    pass: 'S&412476630841' // Your Outlook email password (or app password if 2FA is enabled)
  }
});

// Dummy CSV to download (sample email list)
app.get('/download-sample-csv', (req, res) => {
  const csvContent = "Email\nsample1@example.com\nsample2@example.com\nsample3@example.com";
  res.header('Content-Type', 'text/csv');
  res.attachment('sample.csv');
  res.send(csvContent);
});

// Frontend to accept bulk emails and content
app.get('/', (req, res) => {
  res.send(`
    <html>
      <body>
        <h1>Send Bulk Emails</h1>
        <form action="/send-bulk-emails" method="post" enctype="multipart/form-data">
          <label for="csvFile">Upload CSV File (Emails):</label>
          <input type="file" name="csvFile" id="csvFile" required><br><br>
          
          <label for="subject">Subject:</label><br>
          <input type="text" name="subject" id="subject" placeholder="Email Subject" required><br><br>
          
          <label for="content">Email Content:</label><br>
          <textarea name="content" id="content" rows="10" cols="30" placeholder="Write your email content here..." required></textarea><br><br>
          
          <button type="submit">Send Emails</button>
        </form>
        <br>
        <a href="/download-sample-csv">Download Sample CSV</a>
      </body>
    </html>
  `);
});

// Endpoint to process bulk emails
app.post('/send-bulk-emails', upload.single('csvFile'), async (req, res) => {
  const subject = req.body.subject;
  let content = req.body.content;

  // Convert URLs to clickable links (using a regular expression)
  content = convertUrlsToLinks(content);

  // Wrap content with <pre> tag to preserve whitespace and indentation
  content = `<pre>${content}</pre>`;

  const filePath = req.file.path;
  const emailAddresses = [];

  // Parse the CSV file to extract email addresses
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
      emailAddresses.push(row.Email); // Assume column header is "Email"
    })
    .on('end', async () => {
      // Send emails serially, one by one
      await sendEmailsSerially(subject, emailAddresses, content, res);
    });
});

// Function to convert plain URLs to clickable links
function convertUrlsToLinks(text) {
  // Regex to match URLs
  const urlRegex = /(\b(https?|ftp|file):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/ig;
  
  // Replace URLs with anchor tags
  return text.replace(urlRegex, '<a href="$1" target="_blank">$1</a>');
}

// Function to send emails serially
async function sendEmailsSerially(subject, emailAddresses, content, res) {
  let emailCount = 0;
  let failedEmails = [];
  let notSentEmails = [];

  const senderName = "Tarun Singhal";  // Sender's name
  const senderEmail = "inclusion.pwd@saarathee.com";  // Sender's email address

  // Loop through email addresses and send email one by one (serial)
  for (let i = 0; i < emailAddresses.length; i++) {
    const email = emailAddresses[i];

    // Delay to simulate sending emails one at a time
    if (!validator.validate(email)) {
      console.log('Invalid email skipped:', email);

      notSentEmails.push(email); // Store invalid email
      continue; // Skip invalid email
    }

    let mailOptions = {
      from: `${senderName} <${senderEmail}>`,  // Include the sender's name
      to: email,
      subject: subject,
      html: content // Email content as HTML (supports rich-text)
    };

    try {
      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log('Error sending to:', email);
            failedEmails.push(email); // Add failed emails
            reject(error); // Reject on failure
          } else {
console.clear();             
console.log('Email sent to:', i+1);
            emailCount++;
            resolve(info); // Resolve on success
          }
        });
      });
}
catch(error){      
      // Handle any errors
    }
  }

  // Once all emails are processed, send the result back
  res.send(`
    <h1>Bulk Email Process Complete</h1>
    <p>Successfully sent ${emailCount} emails.</p>
    <p>Failed to send emails to ${failedEmails.length} addresses: ${failedEmails.join(', ')}</p>
    <p>Invalid email addresses (skipped): ${notSentEmails.length} addresses: ${notSentEmails.join(', ')}</p>
  `);
}
// Start the server
app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`);
});
