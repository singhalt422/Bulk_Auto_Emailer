const express = require('express');
const nodemailer = require('nodemailer');
const multer = require('multer');
const fs = require('fs');
const csv = require('csv-parser');
const validator = require('email-validator');
const bodyParser = require('body-parser');
const path = require('path');

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
    pass: 'S&412476630841ap' // Your Outlook email password (or app password if 2FA is enabled)
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
          
          <label for="content">First Content:</label><br>
          <textarea name="content" id="content" rows="10" cols="30" placeholder="Write your first email content here..." required></textarea><br><br>
          
          <label for="image">Upload Image:</label><br>
          <input type="file" name="image" id="image" accept="image/*"><br><br>
          
          <label for="secondContent">Second Content:</label><br>
          <textarea name="secondContent" id="secondContent" rows="10" cols="30" placeholder="Write your second email content here..." required></textarea><br><br>
          
          <button type="submit">Send Emails</button>
        </form>
        <br>
        <a href="/download-sample-csv">Download Sample CSV</a>
      </body>
    </html>
  `);
});

// Endpoint to process bulk emails
app.post('/send-bulk-emails', upload.fields([{ name: 'csvFile' }, { name: 'image' }]), async (req, res) => {
  const subject = req.body.subject;
  let firstContent = req.body.content;
  let secondContent = req.body.secondContent;

  // Convert URLs to clickable links (using a regular expression)
  firstContent = convertUrlsToLinks(firstContent);
  secondContent = convertUrlsToLinks(secondContent);

  // Wrap content with <pre> tag to preserve whitespace and indentation
  firstContent = `<pre>${firstContent}</pre>`;
  secondContent = `<pre>${secondContent}</pre>`;

  const filePath = req.files.csvFile[0].path;
  const emailAddresses = [];

  // Parse the CSV file to extract email addresses
  fs.createReadStream(filePath)
    .pipe(csv())
    .on('data', (row) => {
      emailAddresses.push(row.Email); // Assume column header is "Email"
    })
    .on('end', async () => {
      // Check if image is uploaded
      let imagePath = null;
      let imageCid = null;
      if (req.files.image) {
        imagePath = req.files.image[0].path;
        imageCid = 'unique_cid_for_image'; // This is the Content-ID for embedding the image in the body
        firstContent += `<br><img src="cid:${imageCid}" />`; // Add the image to the body after the first content
      }

      // Send emails serially, one by one
      await sendEmailsSerially(subject, emailAddresses, firstContent, secondContent, imagePath, imageCid, res);
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
async function sendEmailsSerially(subject, emailAddresses, firstContent, secondContent, imagePath, imageCid, res) {
  let emailCount = 0;
  let failedEmails = [];
  let notSentEmails = [];

  const senderName = "Tarun Singhal";  // Sender's name
  const senderEmail = "inclusion.pwd@saarathee.com";  // Sender's email address

  // Loop through email addresses and send email one by one (serial)
  for (let i = 0; i < emailAddresses.length; i++) {
    const email = emailAddresses[i];

    // Delay to simulate sending emails one at a time
    await new Promise(resolve => setTimeout(resolve, 10)); // Delay of 2 seconds between each email

    if (!validator.validate(email)) {
      console.log('Invalid email skipped:', email);

      notSentEmails.push(email); // Store invalid email
      continue; // Skip invalid email
    }

    // Prepare mail options
    let mailOptions = {
      from: `${senderName} <${senderEmail}>`,  // Include the sender's name
      to: email,
      subject: subject,
      html: firstContent + `<br><br>` + secondContent, // Combine both content sections
      attachments: []
    };

    // Attach image if provided
    if (imagePath && imageCid) {
      mailOptions.attachments.push({
        filename: path.basename(imagePath),
        path: imagePath,
        cid: imageCid  // Content ID for embedding the image
      });
    }

    try {
      await new Promise((resolve, reject) => {
        transporter.sendMail(mailOptions, (error, info) => {
          if (error) {
            console.log('Error sending to:', email);
            failedEmails.push(email); // Add failed emails
            reject(error); // Reject on failure
          } else {
            console.clear();            
            console.log('Email sent to:', i + 1);
            emailCount++;
            resolve(info); // Resolve on success
          }
        });
      });
    } catch (error) {
      // Handle any errors
      console.log('Error:', error);
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
